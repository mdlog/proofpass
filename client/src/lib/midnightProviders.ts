import type { WalletConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { fromHex, toHex } from "@midnight-ntwrk/compact-runtime";
import { dappConnectorProofProvider } from "@midnight-ntwrk/midnight-js-dapp-connector-proof-provider";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
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
 * Assembles the full provider set from a connected wallet. Every endpoint comes
 * from the wallet itself — indexer, prover and node URIs are all in
 * `getConfiguration()` — so nothing here hardcodes a network.
 */
export async function buildMidnightProviders(api: WalletBridgeApi, options: ProviderBundleOptions = {}) {
  const configuration = await api.getConfiguration();
  // Midnight.js keeps the network as global state; addresses are encoded against it.
  setNetworkId(configuration.networkId);

  const zkConfigProvider = new FetchZkConfigProvider<string>(resolveAssetsBaseUrl(options.zkAssetsBaseUrl, options.origin));
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
    walletProvider: walletProvider(shielded),
    midnightProvider,
  };
}
