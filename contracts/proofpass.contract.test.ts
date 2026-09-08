import * as rt from "@midnight-ntwrk/compact-runtime";
import { describe, expect, it } from "vitest";
import { Contract, IssuerStatus, ledger, pureCircuits, type Witnesses } from "@compact/proofpass";

/**
 * Off-chain simulation of contracts/proofpass.compact — the unit tests
 * ARCHITECTURE §14 requires (status transition, revocation authorization,
 * policy allow-list, expiry validation, nonce uniqueness, disclosure result).
 *
 * No proof server, node, or indexer: @midnight-ntwrk/compact-runtime executes
 * the circuits in-process, so the whole file runs in well under a second.
 */

type PrivateState = { secret: Uint8Array };

const witnesses: Witnesses<PrivateState> = {
  localSecretKey: ({ privateState }) => [privateState, privateState.secret],
};

const AUTHORITY = new Uint8Array(32).fill(7);
const INTRUDER = new Uint8Array(32).fill(9);
const ISSUER = new Uint8Array(32).fill(1);
const OTHER_ISSUER = new Uint8Array(32).fill(2);
const NOW = 1_800_000_000;
const EXPIRES = BigInt(NOW + 3600);
const nonce = (fill: number) => new Uint8Array(32).fill(fill);

/**
 * Block time is pinned explicitly: `createCircuitContext` otherwise defaults to
 * the wall clock, which would make every expiry assertion time-dependent.
 */
function sim(secret = AUTHORITY, at = NOW) {
  const contract = new Contract<PrivateState>(witnesses);
  const coinPublicKey = "ab".repeat(32);
  const init = contract.initialState(rt.createConstructorContext<PrivateState>({ secret }, coinPublicKey));
  let ctx = rt.createCircuitContext<PrivateState>(
    rt.sampleContractAddress(), coinPublicKey,
    init.currentContractState, init.currentPrivateState,
    undefined, undefined, at,
  );

  return {
    state: () => ledger(ctx.currentQueryContext.state),
    /** A throwing circuit leaves `ctx` untouched — state only advances on success. */
    call(name: string, ...args: unknown[]) {
      const result = (contract.impureCircuits as Record<string, Function>)[name](ctx, ...args);
      ctx = result.context;
      return result;
    },
    /** Run the next call as somebody else's wallet. */
    as(other: Uint8Array) {
      ctx = { ...ctx, currentPrivateState: { secret: other } };
    },
    setTime(seconds: number) {
      ctx.currentQueryContext.block = { ...ctx.currentQueryContext.block, secondsSinceEpoch: BigInt(seconds) };
    },
  };
}

function issuedCredential() {
  const s = sim();
  s.call("registerIssuer", ISSUER);
  const commitment = pureCircuits.credentialCommitment(ISSUER, EXPIRES, AUTHORITY);
  s.call("issueCredential", ISSUER, commitment);
  return { s, commitment };
}

describe("policy allow-list — issuer registry (§8.1)", () => {
  it("binds the authority to the deployer's secret", () => {
    expect(sim().state().authority).toEqual(pureCircuits.authorityKey(AUTHORITY));
  });

  it("registers an issuer as active and refuses a duplicate", () => {
    const s = sim();
    s.call("registerIssuer", ISSUER);
    expect(s.state().issuers.lookup(ISSUER)).toBe(IssuerStatus.ACTIVE);
    expect(() => s.call("registerIssuer", ISSUER)).toThrow(/already registered/);
  });

  it("refuses to issue for an issuer that was never registered", () => {
    const s = sim();
    const commitment = pureCircuits.credentialCommitment(OTHER_ISSUER, EXPIRES, AUTHORITY);
    expect(() => s.call("issueCredential", OTHER_ISSUER, commitment)).toThrow(/not registered/);
  });

  it("stops a revoked issuer from issuing or backing a proof", () => {
    const { s, commitment } = issuedCredential();
    s.call("revokeIssuer", ISSUER);
    expect(s.state().issuers.lookup(ISSUER)).toBe(IssuerStatus.REVOKED);
    expect(() => s.call("issueCredential", ISSUER, pureCircuits.credentialCommitment(ISSUER, EXPIRES + 1n, AUTHORITY)))
      .toThrow(/may no longer issue/);
    expect(() => s.call("proveEligibility", ISSUER, EXPIRES, nonce(0x10))).toThrow(/Issuer is not active/);
    expect(commitment).toBeDefined();
  });
});

describe("revocation authorization (§8.3)", () => {
  it("refuses registry writes from anyone but the authority", () => {
    const s = sim();
    s.as(INTRUDER);
    expect(() => s.call("registerIssuer", ISSUER)).toThrow(/not the registry authority/);
  });

  it("refuses issue and revoke from a non-authority", () => {
    const { s, commitment } = issuedCredential();
    s.as(INTRUDER);
    expect(() => s.call("issueCredential", ISSUER, pureCircuits.credentialCommitment(ISSUER, EXPIRES + 1n, AUTHORITY)))
      .toThrow(/not the registry authority/);
    expect(() => s.call("revokeCredential", commitment)).toThrow(/not the registry authority/);
  });

  it("leaves the ledger untouched when a call is rejected", () => {
    const s = sim();
    s.as(INTRUDER);
    expect(() => s.call("registerIssuer", ISSUER)).toThrow();
    expect(s.state().issuers.member(ISSUER)).toBe(false);
  });
});

describe("credential status transition (§9)", () => {
  it("moves a credential out of the vault and into revocation, one way", () => {
    const { s, commitment } = issuedCredential();
    expect(s.state().credentials.member(commitment)).toBe(true);

    s.call("revokeCredential", commitment);
    expect(s.state().credentials.member(commitment)).toBe(false);
    expect(s.state().revokedCredentials.member(commitment)).toBe(true);

    expect(() => s.call("issueCredential", ISSUER, commitment)).toThrow(/revoked and cannot be reissued/);
  });

  it("refuses to revoke a credential that was never issued", () => {
    const s = sim();
    s.call("registerIssuer", ISSUER);
    expect(() => s.call("revokeCredential", pureCircuits.credentialCommitment(ISSUER, EXPIRES, AUTHORITY)))
      .toThrow(/not issued/);
  });

  /**
   * Regression: `revokeCredential` removes the commitment from `credentials`, so
   * a membership assert placed ahead of the revocation assert fired first and
   * told a revoked holder the credential had never existed.
   */
  it("tells a revoked holder the credential was revoked, not that it never existed", () => {
    const { s, commitment } = issuedCredential();
    s.call("revokeCredential", commitment);
    expect(() => s.call("proveEligibility", ISSUER, EXPIRES, nonce(0x20)))
      .toThrow(/Credential has been revoked/);
  });
});

describe("expiry validation (§8.4)", () => {
  it("accepts a proof before the deadline and rejects it once reached", () => {
    const { s } = issuedCredential();
    s.setTime(Number(EXPIRES) - 1);
    s.call("proveEligibility", ISSUER, EXPIRES, nonce(0x30));
    expect(s.state().acceptedProofs).toBe(1n);

    // kernel.blockTimeLessThan is strict, so the deadline itself is already too late.
    s.setTime(Number(EXPIRES));
    expect(() => s.call("proveEligibility", ISSUER, EXPIRES, nonce(0x31))).toThrow(/expired/);

    s.setTime(Number(EXPIRES) + 86_400);
    expect(() => s.call("proveEligibility", ISSUER, EXPIRES, nonce(0x32))).toThrow(/expired/);
  });
});

describe("nonce uniqueness — replay mitigation (§11)", () => {
  it("burns a presentation nonce after one use", () => {
    const { s } = issuedCredential();
    s.call("proveEligibility", ISSUER, EXPIRES, nonce(0x40));
    expect(s.state().spentNonces.member(nonce(0x40))).toBe(true);
    expect(() => s.call("proveEligibility", ISSUER, EXPIRES, nonce(0x40))).toThrow(/nonce was already used/);
  });

  it("still accepts a fresh nonce for the same credential", () => {
    const { s } = issuedCredential();
    s.call("proveEligibility", ISSUER, EXPIRES, nonce(0x41));
    s.call("proveEligibility", ISSUER, EXPIRES, nonce(0x42));
    expect(s.state().acceptedProofs).toBe(2n);
  });

  it("refuses a proof from someone who does not know the secret", () => {
    const { s } = issuedCredential();
    s.as(INTRUDER);
    expect(() => s.call("proveEligibility", ISSUER, EXPIRES, nonce(0x43))).toThrow(/No such credential/);
  });
});

describe("disclosure result (§6, §11)", () => {
  it("keeps the holder's secret out of everything the chain sees", () => {
    const { s } = issuedCredential();
    const result = s.call("proveEligibility", ISSUER, EXPIRES, nonce(0x50));

    const asHex = (_key: string, value: unknown) =>
      value instanceof Uint8Array ? Buffer.from(value).toString("hex")
        : typeof value === "bigint" ? value.toString()
        : value;
    const publicView = JSON.stringify({ input: result.proofData.input, transcript: result.proofData.publicTranscript }, asHex);
    const privateView = JSON.stringify(result.proofData.privateTranscriptOutputs, asHex);

    const secretHex = Buffer.from(AUTHORITY).toString("hex");
    const commitmentHex = Buffer.from(pureCircuits.credentialCommitment(ISSUER, EXPIRES, AUTHORITY)).toString("hex");

    expect(privateView).toContain(secretHex);
    expect(publicView).not.toContain(secretHex);
    // The commitment is public verification metadata by design (ARCHITECTURE §6).
    expect(publicView).toContain(commitmentHex);
  });
});
