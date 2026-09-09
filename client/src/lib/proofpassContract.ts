import { ledger, pureCircuits } from "@compact/proofpass";
import { findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import { bytesToHex, hexToBytes } from "./hex";

/**
 * Calling the deployed ProofPass contract.
 *
 * `localSecretKey()` does double duty: `assertAuthority()` hashes it into the
 * registry authority, and `proveEligibility` derives the credential commitment
 * from it as the *holder's* secret. One private state cannot be both, so the two
 * roles keep separate secrets under separate private state ids, and the holder
 * hands the issuer only a commitment — never the secret behind it.
 */

export type ContractRole = "authority" | "holder";

export const PRIVATE_STATE_ID: Record<ContractRole, string> = {
  authority: "proofpass",
  holder: "proofpass:holder",
};

const HOLDER_STORAGE_KEY = "proofpass:holder-secret";

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

export type RoleSecret = { secret: Uint8Array; hex: string };

/**
 * The holder's secret. Generated once and kept: a credential is a commitment
 * over it, so losing it makes every credential already issued unprovable.
 */
export function resolveHolderSecret(store: KeyValueStore = localStorage): RoleSecret {
  const stored = store.getItem(HOLDER_STORAGE_KEY);
  if (stored) {
    const secret = hexToBytes(stored);
    if (secret.length !== 32) throw new Error(`Stored holder secret must be 32 bytes of hex, got ${secret.length}.`);
    return { secret, hex: stored };
  }
  const generated = crypto.getRandomValues(new Uint8Array(32));
  const hex = bytesToHex(generated);
  store.setItem(HOLDER_STORAGE_KEY, hex);
  return { secret: generated, hex };
}

/**
 * The issuer's on-chain identifier. ARCHITECTURE §6 classifies it as public —
 * it is what verifiers look up — so a digest of the slug serves: stable across
 * reloads, distinct per issuer, and needing no column of its own.
 */
export async function deriveIssuerId(slug: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(`proofpass:issuer:${slug}`);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
}

/** `kernel.blockTimeLessThan` compares seconds since the epoch, and is strict. */
export function expirySecondsFromNow(seconds: number, now: Date = new Date()): bigint {
  return BigInt(Math.floor(now.getTime() / 1000) + seconds);
}

/**
 * The value the holder computes and the issuer publishes. `proveEligibility`
 * recomputes it from the holder's own secret, so the three inputs must match
 * exactly what was issued.
 */
export function credentialCommitmentFor(issuerId: Uint8Array, expiresAt: bigint, secret: Uint8Array): Uint8Array {
  return pureCircuits.credentialCommitment(issuerId, expiresAt, secret);
}

/** The ledger accepts each presentation nonce exactly once. */
export function freshNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export type IssuerStatusName = "UNREGISTERED" | "ACTIVE" | "REVOKED";

/** Declaration order of `IssuerStatus` in contracts/proofpass.compact. */
const ISSUER_STATUS_NAMES: IssuerStatusName[] = ["UNREGISTERED", "ACTIVE", "REVOKED"];

export type LedgerSnapshot = {
  authority: string;
  issuers: { id: string; status: IssuerStatusName }[];
  credentials: string[];
  revokedCredentials: string[];
  spentNonces: number;
  acceptedProofs: bigint;
};

/** The generated reader, flattened into hex the UI can render and compare. */
type LedgerReader = {
  issuers: Iterable<[Uint8Array, number]>;
  credentials: Iterable<Uint8Array>;
  revokedCredentials: Iterable<Uint8Array>;
  spentNonces: Iterable<Uint8Array>;
  acceptedProofs: bigint;
  authority: Uint8Array;
};

export function readLedgerSnapshot(ledger: LedgerReader): LedgerSnapshot {
  return {
    authority: bytesToHex(ledger.authority),
    issuers: [...ledger.issuers].map(([id, status]) => ({ id: bytesToHex(id), status: ISSUER_STATUS_NAMES[status] ?? "UNREGISTERED" })),
    credentials: [...ledger.credentials].map(bytesToHex),
    revokedCredentials: [...ledger.revokedCredentials].map(bytesToHex),
    spentNonces: [...ledger.spentNonces].length,
    acceptedProofs: ledger.acceptedProofs,
  };
}

export type WorkflowStep = "register" | "issue" | "prove" | "revoke";
export type StepAvailability = { ready: boolean; reason?: string };
export type WorkflowContext = { issuerId: string; commitment: string; expiresAt: bigint };

/**
 * Which steps the ledger currently allows.
 *
 * These mirror the contract's own asserts, in the contract's own words. They
 * exist to keep a deploy from spending DUST on a transaction that is certain to
 * fail — never to stand in for the assert, which remains the only authority.
 */
export function availableSteps(snapshot: LedgerSnapshot, context: WorkflowContext, now: Date = new Date()): Record<WorkflowStep, StepAvailability> {
  const issuer = snapshot.issuers.find((entry) => entry.id === context.issuerId);
  const issued = snapshot.credentials.includes(context.commitment);
  const revoked = snapshot.revokedCredentials.includes(context.commitment);
  const expired = BigInt(Math.floor(now.getTime() / 1000)) >= context.expiresAt;

  const issuerActive = (): string | undefined => {
    if (!issuer) return "Issuer is not registered";
    if (issuer.status !== "ACTIVE") return "Issuer may no longer issue credentials";
    return undefined;
  };

  const no = (reason: string): StepAvailability => ({ ready: false, reason });
  const yes: StepAvailability = { ready: true };

  return {
    register: issuer ? no("Issuer is already registered") : yes,
    issue: (() => {
      const blocked = issuerActive();
      if (blocked) return no(blocked);
      if (revoked) return no("Credential was revoked and cannot be reissued");
      return issued ? no("Credential is already issued") : yes;
    })(),
    prove: (() => {
      const blocked = issuerActive();
      if (blocked) return no(blocked);
      if (revoked) return no("Credential has been revoked");
      if (!issued) return no("No such credential for this issuer and expiry");
      return expired ? no("Credential has expired") : yes;
    })(),
    revoke: issued ? yes : no("Credential is not issued"),
  };
}

/**
 * The contract handle, its ledger reader and the compiled contract are the three
 * things that need a built artifact and a live indexer. Injecting them keeps the
 * wiring above testable, the same way `defaultBridgeDeps` does for the wallet.
 */
export type ContractDeps = {
  find: (providers: unknown, options: Record<string, unknown>) => Promise<FoundProofPass>;
  ledgerOf: (state: unknown) => LedgerReader;
  compiledContract: () => Promise<unknown>;
};

export type FoundProofPass = { callTx: Record<string, (...args: never[]) => Promise<unknown>> };

/**
 * The compiled contract both deploy and every call need. The witness hands the
 * circuit whichever secret the connected private state holds, which is what lets
 * one contract serve the authority and the holder without either seeing the
 * other's key.
 */
export async function buildProofPassContract(): Promise<unknown> {
  const generated = await import("@compact/proofpass") as { Contract?: unknown; __artifactMissing?: boolean };
  if (generated.__artifactMissing || !generated.Contract) {
    throw new Error("Generated Compact module is missing. Run `pnpm contracts:build` first.");
  }
  const builder = CompiledContract as unknown as {
    make: (tag: string, ctor: unknown) => unknown;
    withWitnesses: (self: unknown, witnesses: unknown) => unknown;
    withCompiledFileAssets: (self: unknown, path: string) => unknown;
  };
  let compiled = builder.make("proofpass", generated.Contract);
  compiled = builder.withWitnesses(compiled, {
    localSecretKey: ({ privateState }: { privateState: { secret: Uint8Array } }): [{ secret: Uint8Array }, Uint8Array] => [privateState, privateState.secret],
  });
  // Relative: the ZK config provider resolves it against its own base URL.
  compiled = builder.withCompiledFileAssets(compiled, "");
  return compiled;
}

export const defaultContractDeps: ContractDeps = {
  find: (providers, options) => findDeployedContract(providers as never, options as never) as unknown as Promise<FoundProofPass>,
  ledgerOf: (state) => ledger(state as never) as unknown as LedgerReader,
  compiledContract: buildProofPassContract,
};

/**
 * Reconnects to an already deployed contract as one role. Each role gets its own
 * private state, and its secret is written there on every connect so the store
 * cannot drift from the secrets this browser actually holds.
 */
export async function connectProofPass(
  providers: unknown,
  contractAddress: string,
  role: ContractRole,
  secret: Uint8Array,
  deps: ContractDeps = defaultContractDeps,
): Promise<FoundProofPass> {
  return deps.find(providers, {
    compiledContract: await deps.compiledContract(),
    contractAddress,
    privateStateId: PRIVATE_STATE_ID[role],
    initialPrivateState: { secret },
  });
}

/** What the chain currently says, or null for an address it has never seen. */
export async function fetchLedgerSnapshot(
  providers: { publicDataProvider: { queryContractState: (address: string) => Promise<{ data: unknown } | null> } },
  contractAddress: string,
  deps: ContractDeps = defaultContractDeps,
): Promise<LedgerSnapshot | null> {
  const state = await providers.publicDataProvider.queryContractState(contractAddress);
  return state ? readLedgerSnapshot(deps.ledgerOf(state.data)) : null;
}

/**
 * The five circuits, typed. Both `issueCredential` and `proveEligibility` take
 * more than one Bytes<32>, which would swap silently through the untyped
 * `callTx` — this is the one place their order is written down.
 */
export type ProofPassCalls = {
  registerIssuer(issuerId: Uint8Array): Promise<unknown>;
  revokeIssuer(issuerId: Uint8Array): Promise<unknown>;
  issueCredential(issuerId: Uint8Array, commitment: Uint8Array): Promise<unknown>;
  revokeCredential(commitment: Uint8Array): Promise<unknown>;
  proveEligibility(issuerId: Uint8Array, expiresAt: bigint, nonce: Uint8Array): Promise<unknown>;
};

export function callsOf(contract: FoundProofPass): ProofPassCalls {
  const call = (circuit: string, ...args: unknown[]) => contract.callTx[circuit](...(args as never[]));
  return {
    registerIssuer: (issuerId) => call("registerIssuer", issuerId),
    revokeIssuer: (issuerId) => call("revokeIssuer", issuerId),
    issueCredential: (issuerId, commitment) => call("issueCredential", issuerId, commitment),
    revokeCredential: (commitment) => call("revokeCredential", commitment),
    proveEligibility: (issuerId, expiresAt, nonce) => call("proveEligibility", issuerId, expiresAt, nonce),
  };
}

const CREDENTIAL_DRAFT_KEY = "proofpass:credential-draft";

export type CredentialDraft = { slug: string; expiresAt: bigint };

/**
 * The issuer and the holder must agree on the expiry exactly: the commitment
 * binds it, and `proveEligibility` recomputes the commitment from the expiry the
 * holder passes. Recomputing "an hour from now" on a later render would strand
 * the credential already on chain, so what was issued is what is kept.
 */
export function rememberCredentialDraft(draft: CredentialDraft, store: KeyValueStore = localStorage): void {
  try {
    store.setItem(CREDENTIAL_DRAFT_KEY, JSON.stringify({ slug: draft.slug, expiresAt: draft.expiresAt.toString() }));
  } catch {
    // Storage unavailable; the panel keeps the draft in memory for this session.
  }
}

export function lastCredentialDraft(store: KeyValueStore = localStorage): CredentialDraft | null {
  try {
    const raw = store.getItem(CREDENTIAL_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { slug?: string; expiresAt?: string };
    if (!parsed.slug || !parsed.expiresAt) return null;
    return { slug: parsed.slug, expiresAt: BigInt(parsed.expiresAt) };
  } catch {
    return null;
  }
}

/**
 * Why the ledger cannot be read yet, or null when it can.
 *
 * The wallet session lives in memory only, so a reload drops it while the
 * contract address — kept in localStorage — survives. A disabled button alone
 * makes that look like a page that does not respond.
 */
export function ledgerReadBlocker(walletConnected: boolean, contractAddress: string): string | null {
  if (!walletConnected) return "Connect a Midnight wallet first — every provider comes from it, and the session does not survive a reload.";
  if (!contractAddress.trim()) return "Enter the address of a deployed contract, or deploy one from the Issuer workspace — its address is kept from there.";
  return null;
}

export type WalletConfiguration = { networkId?: string; indexerUri?: string; proverServerUri?: string; substrateNodeUri?: string };

/**
 * The endpoints the wallet reports, for showing.
 *
 * Every one of them comes from `getConfiguration()` and none were visible
 * anywhere, so a proof that fails with "Failed to fetch" gave no way to tell
 * which host went unanswered. A missing field is said out loud rather than
 * rendered as a blank row, because "the wallet did not report a prover" and
 * "the prover is unreachable" call for different fixes.
 */
export function walletEndpoints(configuration?: WalletConfiguration): { label: string; value: string }[] {
  const value = (raw?: string) => raw?.trim() || "not reported";
  return [
    { label: "Network", value: value(configuration?.networkId) },
    { label: "Prover", value: value(configuration?.proverServerUri) },
    { label: "Indexer", value: value(configuration?.indexerUri) },
    { label: "Node", value: value(configuration?.substrateNodeUri) },
  ];
}
