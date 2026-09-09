import { describe, expect, it, vi } from "vitest";
import { createWalletBridge, DEFAULT_ZK_ASSETS_PATH, resolveAssetsBaseUrl, type BridgeDeps, type WalletBridgeApi } from "./midnightProviders";

/**
 * The bridge is pure representation-shuffling between Midnight.js and the DApp
 * Connector, so it is tested without the ledger WASM: `deserializeFinalized` is
 * the one piece that needs it, and it is injected.
 */

const SHIELDED = { shieldedCoinPublicKey: "mn_shield-cpk_preview1abc", shieldedEncryptionPublicKey: "mn_shield-epk_preview1def" };

const tx = (bytes: number[], identifiers: string[] = [], hash = "hash-fallback") => ({
  serialize: () => Uint8Array.from(bytes),
  identifiers: () => identifiers,
  transactionHash: () => hash,
}) as any;

function harness(overrides: Partial<WalletBridgeApi> = {}) {
  const calls: Record<string, unknown[]> = { balance: [], submit: [] };
  const api = {
    balanceUnsealedTransaction: vi.fn(async (serialized: string, options?: { payFees?: boolean }) => {
      calls.balance.push({ serialized, options });
      return { tx: "ba1a" };
    }),
    submitTransaction: vi.fn(async (serialized: string) => { calls.submit.push(serialized); }),
    getShieldedAddresses: vi.fn(async () => SHIELDED),
    ...overrides,
  } as unknown as WalletBridgeApi;

  const deserialized = tx([9, 9]);
  const deps: BridgeDeps = {
    // Stands in for Transaction.deserialize("signature","proof","binding", raw).
    deserializeFinalized: vi.fn(() => deserialized),
    encode: (bytes) => [...bytes].map(b => b.toString(16).padStart(2, "0")).join(""),
    decode: (text) => Uint8Array.from(text.match(/../g)!.map(h => parseInt(h, 16))),
  };
  return { api, deps, calls, deserialized };
}

describe("walletProvider.balanceTx", () => {
  it("hands the wallet a serialised unbound transaction and asks it to pay fees", async () => {
    const { api, deps, calls } = harness();
    const { walletProvider } = createWalletBridge(api, deps);
    await walletProvider(SHIELDED).balanceTx(tx([0xde, 0xad]));
    expect(calls.balance).toEqual([{ serialized: "dead", options: { payFees: true } }]);
  });

  it("reads the balanced transaction back as a ledger object", async () => {
    const { api, deps, deserialized } = harness();
    const { walletProvider } = createWalletBridge(api, deps);
    const result = await walletProvider(SHIELDED).balanceTx(tx([1]));
    expect(deps.deserializeFinalized).toHaveBeenCalledWith(Uint8Array.from([0xba, 0x1a]));
    expect(result).toBe(deserialized);
  });

  it("surfaces a wallet refusal rather than swallowing it", async () => {
    const { deps } = harness();
    const api = { balanceUnsealedTransaction: async () => { throw new Error("Access to wallet api denied"); } } as unknown as WalletBridgeApi;
    const { walletProvider } = createWalletBridge(api, deps);
    await expect(walletProvider(SHIELDED).balanceTx(tx([1]))).rejects.toThrow(/denied/);
  });

  it("exposes the shielded keys the wallet reported", () => {
    const { api, deps } = harness();
    const provider = createWalletBridge(api, deps).walletProvider(SHIELDED);
    expect(provider.getCoinPublicKey()).toBe(SHIELDED.shieldedCoinPublicKey);
    expect(provider.getEncryptionPublicKey()).toBe(SHIELDED.shieldedEncryptionPublicKey);
  });
});

describe("midnightProvider.submitTx", () => {
  it("submits the serialised finalized transaction", async () => {
    const { api, deps, calls } = harness();
    const { midnightProvider } = createWalletBridge(api, deps);
    await midnightProvider.submitTx(tx([0xbe, 0xef], ["id-1"]));
    expect(calls.submit).toEqual(["beef"]);
  });

  // submitTransaction resolves to void; the id comes off the transaction itself.
  it("returns the transaction's own identifier even though the wallet returns nothing", async () => {
    const { api, deps } = harness();
    const { midnightProvider } = createWalletBridge(api, deps);
    await expect(midnightProvider.submitTx(tx([1], ["id-1", "id-2"]))).resolves.toBe("id-1");
  });

  it("falls back to the transaction hash when it carries no identifiers", async () => {
    const { api, deps } = harness();
    const { midnightProvider } = createWalletBridge(api, deps);
    await expect(midnightProvider.submitTx(tx([1], [], "0xhash"))).resolves.toBe("0xhash");
  });

  it("does not report an id when the wallet rejected the submission", async () => {
    const { deps } = harness();
    const api = { submitTransaction: async () => { throw new Error("insufficient DUST"); } } as unknown as WalletBridgeApi;
    const { midnightProvider } = createWalletBridge(api, deps);
    await expect(midnightProvider.submitTx(tx([1], ["id-1"]))).rejects.toThrow(/DUST/);
  });
});

/**
 * Regression: the ZK asset base was passed through as "/compact/proofpass", and
 * FetchZkConfigProvider calls `new URL(baseURL)` with no base — so deployment
 * died with "Failed to construct 'URL': Invalid URL" before it reached the
 * wallet. A Node probe had passed because it was handed an absolute URL.
 */
describe("resolveAssetsBaseUrl", () => {
  it("makes the default path absolute against the page origin", () => {
    expect(resolveAssetsBaseUrl(undefined, "http://localhost:3010")).toBe("http://localhost:3010/compact/proofpass");
  });

  it("resolves any relative path the caller passes", () => {
    expect(resolveAssetsBaseUrl("/assets/zk", "https://proofpass.example")).toBe("https://proofpass.example/assets/zk");
  });

  it("leaves an absolute URL alone", () => {
    expect(resolveAssetsBaseUrl("https://cdn.example/zk", "http://localhost:3010")).toBe("https://cdn.example/zk");
  });

  it("produces something new URL() accepts on its own, which is the whole point", () => {
    expect(() => new URL(resolveAssetsBaseUrl(undefined, "http://localhost:3010"))).not.toThrow();
    expect(() => new URL(DEFAULT_ZK_ASSETS_PATH)).toThrow(/Invalid URL/);
  });

  it("says what is missing rather than throwing a bare URL error", () => {
    expect(() => resolveAssetsBaseUrl("/compact/proofpass", "")).toThrow(/absolute zkAssetsBaseUrl/);
  });
});
