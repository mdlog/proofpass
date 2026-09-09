import { describe, expect, it } from "vitest";
import { IssuerStatus } from "@compact/proofpass";
import { availableSteps, callsOf, connectProofPass, credentialCommitmentFor, fetchLedgerSnapshot, lastCredentialDraft, ledgerReadBlocker, rememberCredentialDraft, deriveIssuerId, expirySecondsFromNow, freshNonce, PRIVATE_STATE_ID, readLedgerSnapshot, resolveHolderSecret, walletEndpoints } from "./proofpassContract";

/**
 * `localSecretKey()` is both the authority secret (via `assertAuthority`) and
 * the holder secret (via `credentialCommitment` inside `proveEligibility`), so
 * the two roles need separate private states. These cover the values that cross
 * between them; the submissions themselves need a node and a wallet.
 */

const fakeStore = () => {
  const held = new Map<string, string>();
  return { getItem: (key: string) => held.get(key) ?? null, setItem: (key: string, value: string) => void held.set(key, value), held };
};

describe("role separation", () => {
  it("keeps the holder's private state apart from the authority's", () => {
    expect(PRIVATE_STATE_ID.holder).not.toBe(PRIVATE_STATE_ID.authority);
  });

  it("generates a holder secret of the 32 bytes the circuit expects", () => {
    expect(resolveHolderSecret(fakeStore()).secret).toHaveLength(32);
  });

  it("keeps the same holder secret, or an issued credential can never be proved", () => {
    const store = fakeStore();
    expect(resolveHolderSecret(store).hex).toBe(resolveHolderSecret(store).hex);
  });

  it("does not store the holder secret where the authority secret lives", () => {
    const store = fakeStore();
    resolveHolderSecret(store);
    expect([...store.held.keys()]).not.toContain("proofpass:authority-secret");
  });
});

describe("deriveIssuerId", () => {
  it("is the 32 bytes the contract's Bytes<32> parameter needs", async () => {
    expect(await deriveIssuerId("northstar-academy")).toHaveLength(32);
  });

  it("is stable, because the issuer must be found again after a reload", async () => {
    expect([...(await deriveIssuerId("northstar"))]).toEqual([...(await deriveIssuerId("northstar"))]);
  });

  it("separates issuers, so registering one does not register another", async () => {
    expect([...(await deriveIssuerId("northstar"))]).not.toEqual([...(await deriveIssuerId("southstar"))]);
  });
});

describe("credentialCommitmentFor", () => {
  const issuer = Uint8Array.from({ length: 32 }, (_, i) => i);
  const secret = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
  const base = () => credentialCommitmentFor(issuer, 1_800_000_000n, secret);

  it("produces the 32 bytes the vault stores", () => {
    expect(base()).toHaveLength(32);
  });

  it("binds the issuer, so a credential cannot be replayed against another", () => {
    const other = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    expect([...credentialCommitmentFor(other, 1_800_000_000n, secret)]).not.toEqual([...base()]);
  });

  it("binds the expiry, so a longer validity than the one issued cannot be claimed", () => {
    expect([...credentialCommitmentFor(issuer, 1_900_000_000n, secret)]).not.toEqual([...base()]);
  });

  it("binds the holder's secret, which is what proving knowledge means", () => {
    const other = Uint8Array.from({ length: 32 }, () => 7);
    expect([...credentialCommitmentFor(issuer, 1_800_000_000n, other)]).not.toEqual([...base()]);
  });
});

describe("presentation values", () => {
  it("expresses expiry in seconds, which is what blockTimeLessThan compares", () => {
    const at = new Date("2026-09-09T00:00:00.000Z");
    expect(expirySecondsFromNow(3600, at)).toBe(BigInt(Math.floor(at.getTime() / 1000) + 3600));
  });

  it("gives a fresh nonce each time, since the ledger accepts each exactly once", () => {
    expect([...freshNonce()]).not.toEqual([...freshNonce()]);
    expect(freshNonce()).toHaveLength(32);
  });
});

/**
 * The panel reports what the chain says after every step, so the mapping from
 * the generated `Ledger` reader to something renderable is worth its own tests —
 * a successful transaction is not evidence that state changed.
 */
const ISSUER_HEX = "aa".repeat(32);
const OTHER_ISSUER_HEX = "bb".repeat(32);
const COMMITMENT_HEX = "cc".repeat(32);

const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));

function fakeLedger(options: { issuers?: [string, number][]; credentials?: string[]; revoked?: string[]; nonces?: string[]; accepted?: bigint; authority?: string } = {}) {
  const setOf = (items: string[] = []) => ({
    isEmpty: () => items.length === 0,
    size: () => BigInt(items.length),
    member: (elem: Uint8Array) => items.includes([...elem].map((b) => b.toString(16).padStart(2, "0")).join("")),
    [Symbol.iterator]: () => items.map(bytes)[Symbol.iterator](),
  });
  const entries = options.issuers ?? [];
  return {
    issuers: {
      isEmpty: () => entries.length === 0,
      size: () => BigInt(entries.length),
      member: () => false,
      lookup: () => 0,
      [Symbol.iterator]: () => entries.map(([hex, status]) => [bytes(hex), status] as [Uint8Array, number])[Symbol.iterator](),
    },
    credentials: setOf(options.credentials),
    revokedCredentials: setOf(options.revoked),
    spentNonces: setOf(options.nonces),
    acceptedProofs: options.accepted ?? 0n,
    authority: bytes(options.authority ?? "dd".repeat(32)),
  };
}

describe("readLedgerSnapshot", () => {
  it("reports an empty registry as empty rather than as an error", () => {
    const snapshot = readLedgerSnapshot(fakeLedger() as never);
    expect(snapshot.issuers).toEqual([]);
    expect(snapshot.credentials).toEqual([]);
    expect(snapshot.acceptedProofs).toBe(0n);
  });

  it("names issuer statuses the way the contract's enum does", () => {
    const snapshot = readLedgerSnapshot(fakeLedger({ issuers: [[ISSUER_HEX, IssuerStatus.ACTIVE], [OTHER_ISSUER_HEX, IssuerStatus.REVOKED]] }) as never);
    expect(snapshot.issuers).toEqual([{ id: ISSUER_HEX, status: "ACTIVE" }, { id: OTHER_ISSUER_HEX, status: "REVOKED" }]);
  });

  it("carries commitments and counters through as hex the UI can show", () => {
    const snapshot = readLedgerSnapshot(fakeLedger({ credentials: [COMMITMENT_HEX], revoked: [], accepted: 3n }) as never);
    expect(snapshot.credentials).toEqual([COMMITMENT_HEX]);
    expect(snapshot.acceptedProofs).toBe(3n);
  });
});

describe("availableSteps", () => {
  const at = new Date("2026-09-09T00:00:00.000Z");
  const context = { issuerId: ISSUER_HEX, commitment: COMMITMENT_HEX, expiresAt: BigInt(Math.floor(at.getTime() / 1000) + 3600) };
  const steps = (options: Parameters<typeof fakeLedger>[0], now = at) => availableSteps(readLedgerSnapshot(fakeLedger(options) as never), context, now);

  it("offers registration first and nothing that depends on it", () => {
    const s = steps({});
    expect(s.register.ready).toBe(true);
    expect(s.issue.ready).toBe(false);
    expect(s.prove.ready).toBe(false);
  });

  it("refuses to register twice, which the contract would reject anyway", () => {
    expect(steps({ issuers: [[ISSUER_HEX, IssuerStatus.ACTIVE]] }).register).toMatchObject({ ready: false, reason: expect.stringMatching(/already registered/i) });
  });

  it("opens issuing once the issuer is active on chain", () => {
    expect(steps({ issuers: [[ISSUER_HEX, IssuerStatus.ACTIVE]] }).issue.ready).toBe(true);
  });

  it("closes issuing for a revoked issuer", () => {
    expect(steps({ issuers: [[ISSUER_HEX, IssuerStatus.REVOKED]] }).issue).toMatchObject({ ready: false, reason: expect.stringMatching(/no longer issue/i) });
  });

  it("opens proving and revoking only once the commitment is in the vault", () => {
    const s = steps({ issuers: [[ISSUER_HEX, IssuerStatus.ACTIVE]], credentials: [COMMITMENT_HEX] });
    expect(s.prove.ready).toBe(true);
    expect(s.revoke.ready).toBe(true);
    expect(s.issue).toMatchObject({ ready: false, reason: expect.stringMatching(/already issued/i) });
  });

  it("closes proving once the credential is revoked", () => {
    const s = steps({ issuers: [[ISSUER_HEX, IssuerStatus.ACTIVE]], revoked: [COMMITMENT_HEX] });
    expect(s.prove).toMatchObject({ ready: false, reason: expect.stringMatching(/revoked/i) });
  });

  it("closes proving after the deadline, because blockTimeLessThan is strict", () => {
    const s = steps({ issuers: [[ISSUER_HEX, IssuerStatus.ACTIVE]], credentials: [COMMITMENT_HEX] }, new Date("2026-09-09T02:00:00.000Z"));
    expect(s.prove).toMatchObject({ ready: false, reason: expect.stringMatching(/expired/i) });
  });
});

/**
 * The submissions themselves need a node and a wallet, so what is worth pinning
 * here is the wiring around them: that each role reaches its own private state,
 * and that an address the indexer has never seen reports as absent rather than
 * throwing.
 */
describe("connectProofPass", () => {
  const ADDRESS = "0200deadbeef";
  const secret = Uint8Array.from({ length: 32 }, () => 9);

  const spyDeps = () => {
    const calls: { providers: unknown; options: Record<string, unknown> }[] = [];
    return {
      calls,
      deps: {
        find: async (providers: unknown, options: Record<string, unknown>) => {
          calls.push({ providers, options });
          return { callTx: {} } as never;
        },
        ledgerOf: () => { throw new Error("not used here"); },
        compiledContract: async () => "compiled",
      },
    };
  };

  it("reaches the authority's private state when acting as the authority", async () => {
    const { calls, deps } = spyDeps();
    await connectProofPass({}, ADDRESS, "authority", secret, deps as never);
    expect(calls[0].options.privateStateId).toBe(PRIVATE_STATE_ID.authority);
  });

  it("reaches the holder's private state when proving, which is a different secret", async () => {
    const { calls, deps } = spyDeps();
    await connectProofPass({}, ADDRESS, "holder", secret, deps as never);
    expect(calls[0].options.privateStateId).toBe(PRIVATE_STATE_ID.holder);
  });

  it("seeds the role's own secret, so the witness returns the right one", async () => {
    const { calls, deps } = spyDeps();
    await connectProofPass({}, ADDRESS, "holder", secret, deps as never);
    expect(calls[0].options.initialPrivateState).toEqual({ secret });
  });

  it("connects to the address given, not to a fresh deploy", async () => {
    const { calls, deps } = spyDeps();
    await connectProofPass({}, ADDRESS, "authority", secret, deps as never);
    expect(calls[0].options.contractAddress).toBe(ADDRESS);
  });
});

describe("fetchLedgerSnapshot", () => {
  it("reports absent rather than throwing when the indexer has no such contract", async () => {
    const deps = { find: async () => ({ callTx: {} }) as never, ledgerOf: () => { throw new Error("should not be read"); }, compiledContract: async () => "compiled" };
    const providers = { publicDataProvider: { queryContractState: async () => null } };
    expect(await fetchLedgerSnapshot(providers as never, "0200missing", deps as never)).toBeNull();
  });

  it("reads the state the indexer returns through the generated ledger reader", async () => {
    const deps = {
      find: async () => ({ callTx: {} }) as never,
      ledgerOf: () => fakeLedger({ issuers: [[ISSUER_HEX, IssuerStatus.ACTIVE]], accepted: 2n }) as never,
      compiledContract: async () => "compiled",
    };
    const providers = { publicDataProvider: { queryContractState: async () => ({ data: "state" }) } };
    const snapshot = await fetchLedgerSnapshot(providers as never, "0200abc", deps as never);
    expect(snapshot).toMatchObject({ acceptedProofs: 2n, issuers: [{ id: ISSUER_HEX, status: "ACTIVE" }] });
  });
});

/**
 * Argument order is the one thing a thin wrapper can still get wrong, and both
 * `issueCredential` and `proveEligibility` take same-shaped Bytes<32> values
 * that would swap silently.
 */
describe("callsOf", () => {
  const recorder = () => {
    const seen: { circuit: string; args: unknown[] }[] = [];
    const callTx = new Proxy({}, { get: (_t, circuit: string) => (...args: unknown[]) => { seen.push({ circuit, args }); return Promise.resolve("tx"); } });
    return { seen, calls: callsOf({ callTx } as never) };
  };
  const issuerId = Uint8Array.from({ length: 32 }, () => 1);
  const commitment = Uint8Array.from({ length: 32 }, () => 2);
  const nonce = Uint8Array.from({ length: 32 }, () => 3);

  it("registers an issuer by id", async () => {
    const { seen, calls } = recorder();
    await calls.registerIssuer(issuerId);
    expect(seen).toEqual([{ circuit: "registerIssuer", args: [issuerId] }]);
  });

  it("issues with the issuer first and the commitment second, never the reverse", async () => {
    const { seen, calls } = recorder();
    await calls.issueCredential(issuerId, commitment);
    expect(seen[0]).toEqual({ circuit: "issueCredential", args: [issuerId, commitment] });
  });

  it("revokes by commitment alone, as the contract takes it", async () => {
    const { seen, calls } = recorder();
    await calls.revokeCredential(commitment);
    expect(seen[0]).toEqual({ circuit: "revokeCredential", args: [commitment] });
  });

  it("proves with issuer, expiry and nonce in that order", async () => {
    const { seen, calls } = recorder();
    await calls.proveEligibility(issuerId, 1_800_000_000n, nonce);
    expect(seen[0]).toEqual({ circuit: "proveEligibility", args: [issuerId, 1_800_000_000n, nonce] });
  });
});

/**
 * The commitment binds the expiry, and `proveEligibility` recomputes it from the
 * expiry the holder passes. Recomputing "now + an hour" on a later render would
 * produce a different commitment and strand the credential already on chain, so
 * the value issued has to be the value kept.
 */
describe("credential draft", () => {
  const store = () => {
    const held = new Map<string, string>();
    return { getItem: (key: string) => held.get(key) ?? null, setItem: (key: string, value: string) => void held.set(key, value), held };
  };

  it("reads back the exact expiry that was issued", () => {
    const kept = store();
    rememberCredentialDraft({ slug: "northstar", expiresAt: 1_800_000_000n }, kept);
    expect(lastCredentialDraft(kept)).toEqual({ slug: "northstar", expiresAt: 1_800_000_000n });
  });

  it("survives the JSON round trip a bigint does not make on its own", () => {
    const kept = store();
    rememberCredentialDraft({ slug: "s", expiresAt: 9_007_199_254_740_993n }, kept);
    expect(lastCredentialDraft(kept)?.expiresAt).toBe(9_007_199_254_740_993n);
  });

  it("reports nothing rather than throwing when no credential was drafted", () => {
    expect(lastCredentialDraft(store())).toBeNull();
  });

  it("ignores a corrupt draft instead of failing the whole panel", () => {
    const kept = store();
    kept.setItem("proofpass:credential-draft", "{not json");
    expect(lastCredentialDraft(kept)).toBeNull();
  });
});

/**
 * The wallet session does not survive a reload, so a panel that only greys the
 * button out leaves the operator clicking a control that will never respond.
 */
describe("ledgerReadBlocker", () => {
  it("asks for the wallet first, since every provider comes from it", () => {
    expect(ledgerReadBlocker(false, "0200abc")).toMatch(/wallet/i);
  });

  it("says the session is gone rather than implying the wallet was never connected", () => {
    expect(ledgerReadBlocker(false, "0200abc")).toMatch(/reload|reconnect/i);
  });

  it("asks for an address once the wallet is there", () => {
    expect(ledgerReadBlocker(true, "   ")).toMatch(/address/i);
  });

  it("says where an address comes from, since an empty field is otherwise a dead end", () => {
    expect(ledgerReadBlocker(true, "")).toMatch(/issuer workspace/i);
  });

  it("blocks on the wallet before the address, which is the order they are fixed in", () => {
    expect(ledgerReadBlocker(false, "")).toMatch(/wallet/i);
  });

  it("reports nothing to fix when both are present", () => {
    expect(ledgerReadBlocker(true, "0200abc")).toBeNull();
  });
});

/**
 * Every endpoint comes from the wallet, and none of them were visible anywhere.
 * When proving fails with "Failed to fetch" there is no way to tell which host
 * was not reached — the prover, the indexer, or the node.
 */
describe("walletEndpoints", () => {
  const full = { networkId: "preprod", indexerUri: "https://indexer.example/api", proverServerUri: "http://127.0.0.1:6300", substrateNodeUri: "wss://node.example" };

  it("reports the prover, which is what proving fails against", () => {
    expect(walletEndpoints(full)).toContainEqual({ label: "Prover", value: "http://127.0.0.1:6300" });
  });

  it("reports the indexer and the node alongside it", () => {
    const labels = walletEndpoints(full).map((entry) => entry.label);
    expect(labels).toEqual(expect.arrayContaining(["Indexer", "Node", "Network"]));
  });

  it("says a field was not reported rather than showing an empty row", () => {
    expect(walletEndpoints({ networkId: "preprod" })).toContainEqual({ label: "Prover", value: "not reported" });
  });

  it("still lists every endpoint when the wallet gave no configuration at all", () => {
    expect(walletEndpoints(undefined)).toHaveLength(4);
  });
});
