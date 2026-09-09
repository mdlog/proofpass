import type { WalletConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { fromHex, toHex } from "@midnight-ntwrk/compact-runtime";
import { dappConnectorProofProvider } from "@midnight-ntwrk/midnight-js-dapp-connector-proof-provider";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { readableMessage } from "./describeError";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { CostModel, Transaction } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import type { FinalizedTransaction, TransactionId } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import type { MidnightProvider, UnboundTransaction, WalletProvider } from "@midnight-ntwrk/midnight-js-types";

/**
 * Bridges the Midnight DApp Connector to the provider interfaces Midnight.js
 * expects (ARCHITECTURE §18: the wallet keeps custody, the app only prepares).
 *
 * The two look mismatched at first glance but are the same object in different
 * clothes. Midnight.js passes a ledger `Transaction`; the connector takes a
 * serialised one. The connector's own documentation names the exact types:
 * `balanceUnsealedTransaction` expects `Transaction<SignatureEnabled, Proof,
 * PreBinding>` — that is `UnboundTransaction` — and `submitTransaction` expects
 * `Transaction<SignatureEnabled, Proof, Binding>`, which is
 * `FinalizedTransaction`. So the bridge is a change of representation, not a
 * change of meaning.
 */

/** Only the parts of the connected wallet this bridge actually touches. */
export type WalletBridgeApi = Pick<
  WalletConnectedAPI,
  "balanceUnsealedTransaction" | "submitTransaction" | "getShieldedAddresses" | "getConfiguration" | "getProvingProvider" | "getDustBalance"
>;

/**
 * Deserialising a balanced transaction needs the real ledger WASM, so it is
 * injected: the bridge itself is plain data-shuffling and stays unit-testable.
 */
export type BridgeDeps = {
  deserializeFinalized: (raw: Uint8Array) => FinalizedTransaction;
  encode: (bytes: Uint8Array) => string;
  decode: (text: string) => Uint8Array;
};

export const defaultBridgeDeps: BridgeDeps = {
  // The marker triple names the type parameters of the transaction being read
  // back: signed, proven, and cryptographically bound.
  deserializeFinalized: (raw) => Transaction.deserialize("signature", "proof", "binding", raw),
  encode: toHex,
  decode: fromHex,
};

export function createWalletBridge(api: WalletBridgeApi, deps: BridgeDeps = defaultBridgeDeps) {
  const walletProvider = (shielded: { shieldedCoinPublicKey: string; shieldedEncryptionPublicKey: string }): WalletProvider => ({
    async balanceTx(tx: UnboundTransaction) {
      const { tx: balanced } = await api.balanceUnsealedTransaction(deps.encode(tx.serialize()), { payFees: true });
      return deps.deserializeFinalized(deps.decode(balanced));
    },
    getCoinPublicKey: () => shielded.shieldedCoinPublicKey,
    getEncryptionPublicKey: () => shielded.shieldedEncryptionPublicKey,
  });

  const midnightProvider: MidnightProvider = {
    // `submitTransaction` resolves to void, but the id never needed to come
    // from the wallet: the transaction carries its own identifiers.
    async submitTx(tx: FinalizedTransaction): Promise<TransactionId> {
      await api.submitTransaction(deps.encode(tx.serialize()));
      return tx.identifiers()[0] ?? tx.transactionHash();
    },
  };

  return { walletProvider, midnightProvider };
}

export type ProviderBundleOptions = {
  /** Where `pnpm contracts:build` publishes `keys/` and `zkir/`. */
  zkAssetsBaseUrl?: string;
  /** Overridable so the resolution can be tested without a browser. */
  origin?: string;
};

/** Where `pnpm contracts:build` publishes `keys/` and `zkir/`. */
export const DEFAULT_ZK_ASSETS_PATH = "/compact/proofpass";

/**
 * FetchZkConfigProvider calls `new URL(baseURL)` with no base, so a path like
 * "/compact/proofpass" throws `TypeError: Invalid URL`. Anything relative is
 * resolved against the page origin before it ever reaches the provider.
 */
export function resolveAssetsBaseUrl(input?: string, origin?: string): string {
  const candidate = input?.trim() || DEFAULT_ZK_ASSETS_PATH;
  try {
    return new URL(candidate).toString().replace(/\/$/, "");
  } catch {
    const base = origin ?? (typeof location === "undefined" ? undefined : location.origin);
    if (!base) throw new Error(`Cannot resolve "${candidate}" without an origin; pass an absolute zkAssetsBaseUrl.`);
    return new URL(candidate, base).toString().replace(/\/$/, "");
  }
}

/**
 * A {@link FetchZkConfigProvider} that remembers why a read failed.
 *
 * Midnight.js reads the compiled ZK assets inside an Effect, and every failure
 * is reported as `ZKConfigurationReadError: Failed to read verifier key for
 * <tag>#<circuit>`. The reason underneath — a 404, an SPA fallback page, a
 * request the browser refused — never reaches the caller, so a failed deploy
 * names the symptom and nothing else. Keeping the first one lets it say what
 * actually broke, and the console gets the whole error either way.
 */
export class ReportingZkConfigProvider extends FetchZkConfigProvider<string> {
  /** The first read that failed, phrased for an operator. */
  firstFailure?: string;

  /**
   * The provider calls its fetch as `this.fetchFunc(...)`, and cross-fetch's
   * default is `window.fetch` unbound — so the browser sees `this` as the
   * provider and refuses with "Failed to execute 'fetch' on 'Window': Illegal
   * invocation". Node's fetch ignores `this`, which is why only a browser ever
   * hit it. Calling the host's fetch plainly, at call time, sidesteps both.
   */
  constructor(baseURL: string, fetchFunc: typeof fetch = (input, init) => fetch(input, init)) {
    super(baseURL, fetchFunc);
  }

  private async keepReason<T>(asset: string, circuitId: string, read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      const reason = `${asset} for ${circuitId}: ${readableMessage(error, "the request failed")}`;
      this.firstFailure ??= reason;
      console.error(`[ProofPass] ZK asset unreadable — ${reason}`, error);
      throw error;
    }
  }

  override getVerifierKey(circuitId: string) {
    return this.keepReason("verifier key", circuitId, () => super.getVerifierKey(circuitId));
  }

  override getProverKey(circuitId: string) {
    return this.keepReason("prover key", circuitId, () => super.getProverKey(circuitId));
  }

  override getZKIR(circuitId: string) {
    return this.keepReason("zkir", circuitId, () => super.getZKIR(circuitId));
  }
}

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

const PRIVATE_STATE_PASSWORD_KEY = "proofpass:private-state-password";

const PASSWORD_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.~!@#$%^&*";

/**
 * The strength policy `levelPrivateStateProvider` applies to the password on
 * every read and write, mirrored here so a password is never handed over that
 * it will reject. Its own errors state the rules: at least 16 characters, three
 * of the four character classes, no more than three identical characters in a
 * row, and no four characters running in sequence.
 */
function satisfiesPasswordPolicy(password: string): boolean {
  if (password.length < 16) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((cls) => cls.test(password)).length;
  if (classes < 3) return false;
  if (/(.)\1{3,}/.test(password)) return false;
  const lower = password.toLowerCase();
  for (let at = 0; at + 3 < lower.length; at += 1) {
    const steps = [1, 2, 3].map((n) => lower.charCodeAt(at + n) - lower.charCodeAt(at + n - 1));
    if (steps.every((step) => step === 1) || steps.every((step) => step === -1)) return false;
  }
  return true;
}

function generatePassword(): string {
  // Random draws land outside the policy only rarely, so rejection sampling is
  // simpler than steering the generator and keeps every character random.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]).join("");
    if (satisfiesPasswordPolicy(candidate)) return candidate;
  }
  throw new Error("Could not generate a private state password that satisfies the storage policy.");
}

/**
 * The password the private state store is encrypted with.
 *
 * `levelPrivateStateProvider` refuses to build without one and enforces a
 * minimum strength, but a browser dApp has no passphrase to ask the user for.
 * A generated secret is what there is: it keeps the IndexedDB contents from
 * being readable by eye, while living in the same localStorage as the authority
 * secret — so it raises no bar that localStorage does not already set. A
 * deployment that needs more should take a real passphrase from the operator.
 *
 * A rejected password is replaced rather than kept: an earlier build stored 32
 * random bytes as hex, which is only two character classes, and the policy runs
 * on every read and write — so nothing was ever stored under it to orphan.
 */
export function resolvePrivateStatePassword(store: KeyValueStore = localStorage): string {
  const stored = store.getItem(PRIVATE_STATE_PASSWORD_KEY);
  if (stored && satisfiesPasswordPolicy(stored)) return stored;
  const generated = generatePassword();
  store.setItem(PRIVATE_STATE_PASSWORD_KEY, generated);
  return generated;
}

/**
 * Where Midnight.js keeps the private state and the contract's signing key.
 *
 * `submitDeployTx` writes all three — contract address, initial private state,
 * signing key — *after* the transaction is submitted, so a missing provider
 * does not stop a deploy: it loses the record of one that already happened.
 * The store is scoped to the wallet account, which is what keeps two wallets in
 * the same browser from reading each other's state.
 */
export function createPrivateStateProvider(accountId: string, store?: KeyValueStore) {
  return levelPrivateStateProvider({
    accountId,
    privateStoragePasswordProvider: () => resolvePrivateStatePassword(store),
  });
}

/**
 * Assembles the full provider set from a connected wallet. Every endpoint comes
 * from the wallet itself — indexer, prover and node URIs are all in
 * `getConfiguration()` — so nothing here hardcodes a network.
 */
export async function buildMidnightProviders(api: WalletBridgeApi, options: ProviderBundleOptions = {}) {
  // Proving happens in the wallet, never here (ARCHITECTURE §18), so a connector
  // that predates `getProvingProvider` cannot deploy at all. Unguarded it fails
  // deep in the SDK as "api.getProvingProvider is not a function", which reads
  // like an app bug rather than an out-of-date wallet.
  if (typeof api.getProvingProvider !== "function") {
    throw new Error("This wallet cannot prove: it does not expose getProvingProvider, which version 4 of the Midnight DApp Connector API requires. Update the wallet extension to a build that implements it.");
  }

  const configuration = await api.getConfiguration();
  // Midnight.js keeps the network as global state; addresses are encoded against it.
  setNetworkId(configuration.networkId);

  const zkConfigProvider = new ReportingZkConfigProvider(resolveAssetsBaseUrl(options.zkAssetsBaseUrl, options.origin));
  const [proofProvider, shielded] = await Promise.all([
    dappConnectorProofProvider(api, zkConfigProvider, CostModel.initialCostModel()),
    api.getShieldedAddresses(),
  ]);

  const { walletProvider, midnightProvider } = createWalletBridge(api);

  return {
    configuration,
    zkConfigProvider,
    proofProvider,
    publicDataProvider: indexerPublicDataProvider(configuration.indexerUri, configuration.indexerWsUri),
    privateStateProvider: createPrivateStateProvider(shielded.shieldedCoinPublicKey),
    walletProvider: walletProvider(shielded),
    midnightProvider,
  };
}
