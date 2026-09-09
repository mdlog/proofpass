import { describe, expect, it, vi } from "vitest";
import { buildMidnightProviders, createPrivateStateProvider, createWalletBridge, DEFAULT_ZK_ASSETS_PATH, ReportingZkConfigProvider, resolveAssetsBaseUrl, resolvePrivateStatePassword, resolveProofServerUri, type BridgeDeps, type WalletBridgeApi } from "./midnightProviders";

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

/**
 * Midnight.js reads the ZK assets inside an Effect, and every failure comes back
 * as `ZKConfigurationReadError: Failed to read verifier key for <tag>#<circuit>`.
 * The reason underneath — a 404, an SPA fallback page, a request the browser
 * refused — is dropped, so a deploy failure names the symptom and nothing else.
 */
describe("ReportingZkConfigProvider", () => {
  const BASE = "http://localhost:3010/compact/proofpass";
  const respondWith = (body: BodyInit | null, init: ResponseInit) => async () => new Response(body, init);

  it("keeps the reason a failed read gives, which Midnight.js would drop", async () => {
    const provider = new ReportingZkConfigProvider(BASE, respondWith(null, { status: 404, statusText: "Not Found" }));
    await expect(provider.getVerifierKey("registerIssuer")).rejects.toThrow();
    expect(provider.firstFailure).toMatch(/verifier key for registerIssuer/);
    expect(provider.firstFailure).toMatch(/404/);
  });

  it("names the URL it tried, so a wrong base is obvious", async () => {
    const provider = new ReportingZkConfigProvider(BASE, respondWith(null, { status: 404, statusText: "Not Found" }));
    await expect(provider.getVerifierKey("registerIssuer")).rejects.toThrow();
    expect(provider.firstFailure).toContain(`${BASE}/keys/registerIssuer.verifier`);
  });

  it("recognises an SPA fallback page rather than reporting a bare parse failure", async () => {
    const provider = new ReportingZkConfigProvider(BASE, respondWith("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(provider.getProverKey("issueCredential")).rejects.toThrow();
    expect(provider.firstFailure).toMatch(/prover key for issueCredential/);
    expect(provider.firstFailure).toMatch(/text\/html/);
  });

  it("keeps a request the browser refused outright", async () => {
    const provider = new ReportingZkConfigProvider(BASE, async () => { throw new TypeError("Failed to fetch"); });
    await expect(provider.getZKIR("proveEligibility")).rejects.toThrow();
    expect(provider.firstFailure).toMatch(/zkir for proveEligibility: Failed to fetch/);
  });

  it("keeps the first failure, not the last, because all five circuits read at once", async () => {
    let call = 0;
    const provider = new ReportingZkConfigProvider(BASE, async () => new Response(null, { status: ++call === 1 ? 404 : 500, statusText: call === 1 ? "Not Found" : "Server Error" }));
    await expect(provider.getVerifierKey("registerIssuer")).rejects.toThrow();
    await expect(provider.getVerifierKey("revokeIssuer")).rejects.toThrow();
    expect(provider.firstFailure).toMatch(/registerIssuer/);
    expect(provider.firstFailure).not.toMatch(/revokeIssuer/);
  });

  it("passes a successful read through untouched and records nothing", async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const provider = new ReportingZkConfigProvider(BASE, respondWith(bytes, { status: 200, headers: { "content-type": "application/octet-stream" } }));
    expect([...(await provider.getVerifierKey("registerIssuer"))]).toEqual([1, 2, 3, 4]);
    expect(provider.firstFailure).toBeUndefined();
  });
});

/**
 * Proving happens in the wallet (ARCHITECTURE §18), so a connector that predates
 * `getProvingProvider` cannot deploy at all. Without a guard that surfaces as
 * "api.getProvingProvider is not a function" from inside the SDK, which reads
 * like an app bug rather than an out-of-date wallet.
 */
describe("buildMidnightProviders wallet capabilities", () => {
  it("names the missing capability rather than failing inside the SDK", async () => {
    await expect(buildMidnightProviders({} as unknown as WalletBridgeApi, { proofServerUri: "" })).rejects.toThrow(/getProvingProvider/);
  });

  it("says which connector version requires it, so the fix is to update the wallet", async () => {
    await expect(buildMidnightProviders({} as unknown as WalletBridgeApi, { proofServerUri: "" })).rejects.toThrow(/DApp Connector/);
  });

  /**
   * The hosted preprod prover sits behind a proxy that refuses request bodies
   * over a few kilobytes, and a circuit call has to upload a 2.7 MB proving key.
   * Pointing the app at a proof server of its own is the way past that, and a
   * wallet that cannot prove is then no obstacle.
   */
  it("does not demand a wallet prover when the app brings its own proof server", async () => {
    const api = { getConfiguration: async () => { throw new Error("reached getConfiguration"); } } as unknown as WalletBridgeApi;
    await expect(buildMidnightProviders(api, { proofServerUri: "http://localhost:6300" })).rejects.toThrow(/reached getConfiguration/);
  });

  it("lets a wallet that exposes it through to the rest of the setup", async () => {
    const api = {
      getProvingProvider: async () => ({}),
      getConfiguration: async () => { throw new Error("reached getConfiguration"); },
    } as unknown as WalletBridgeApi;
    await expect(buildMidnightProviders(api)).rejects.toThrow(/reached getConfiguration/);
  });
});

/**
 * `FetchZkConfigProvider` defaults to cross-fetch, which in a browser hands over
 * `window.fetch` unbound, and then calls it as `this.fetchFunc(...)` — so `this`
 * is the provider instead of the window and the browser refuses:
 * "Failed to execute 'fetch' on 'Window': Illegal invocation". Node's fetch does
 * not care about `this`, so only a browser ever saw it. These stand in for one.
 */
describe("ReportingZkConfigProvider fetch binding", () => {
  // Port 9 (discard) so a real request cannot quietly succeed instead.
  const UNREACHABLE = "http://127.0.0.1:9/compact/proofpass";

  function withGlobalFetch<T>(stub: typeof fetch, body: () => T): T {
    const original = globalThis.fetch;
    globalThis.fetch = stub;
    try {
      return body();
    } finally {
      globalThis.fetch = original;
    }
  }

  const respond = (bytes: number[]) => async () => new Response(Uint8Array.from(bytes), { status: 200, headers: { "content-type": "application/octet-stream" } });

  it("goes through the host's current fetch rather than one captured at import", async () => {
    const key = await withGlobalFetch(respond([7, 8, 9]) as unknown as typeof fetch, () =>
      new ReportingZkConfigProvider(UNREACHABLE).getVerifierKey("registerIssuer"));
    expect([...key]).toEqual([7, 8, 9]);
  });

  it("never passes itself as `this`, which is what a browser rejects", async () => {
    const browserLikeFetch = function (this: unknown) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return Promise.resolve(new Response(Uint8Array.from([1]), { status: 200 }));
    } as unknown as typeof fetch;

    const key = await withGlobalFetch(browserLikeFetch, () =>
      new ReportingZkConfigProvider(UNREACHABLE).getProverKey("issueCredential"));
    expect([...key]).toEqual([1]);
  });

  it("still lets a caller inject its own fetch, which the other tests rely on", async () => {
    const provider = new ReportingZkConfigProvider(UNREACHABLE, respond([4, 2]) as unknown as typeof fetch);
    expect([...(await provider.getZKIR("proveEligibility"))]).toEqual([4, 2]);
  });
});

/**
 * `submitDeployTx` writes the contract address, the initial private state and a
 * freshly sampled signing key through `providers.privateStateProvider` — after
 * the transaction has already been submitted and confirmed. Leaving it out did
 * not fail the deploy; it failed the bookkeeping afterwards, with
 * "Cannot read properties of undefined (reading 'setContractAddress')" and a
 * contract already live on chain whose address had just been thrown away.
 */
describe("private state", () => {
  const fakeStore = () => {
    const held = new Map<string, string>();
    return { getItem: (key: string) => held.get(key) ?? null, setItem: (key: string, value: string) => void held.set(key, value), held };
  };

  /**
   * The policy levelPrivateStateProvider enforces on every read and write, as
   * stated by its own errors: at least 16 characters, three of the four
   * character classes, no more than three identical characters in a row, and no
   * four characters running in sequence.
   */
  function policyComplaint(password: string): string | null {
    if (password.length < 16) return `only ${password.length} characters`;
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((cls) => cls.test(password)).length;
    if (classes < 3) return `only ${classes} character classes`;
    if (/(.)\1{3,}/.test(password)) return "four identical characters in a row";
    const lower = password.toLowerCase();
    for (let at = 0; at + 3 < lower.length; at += 1) {
      const steps = [1, 2, 3].map((n) => lower.charCodeAt(at + n) - lower.charCodeAt(at + n - 1));
      if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return `a run in sequence: ${password.slice(at, at + 4)}`;
    }
    return null;
  }

  it("generates a password the SDK's strength policy accepts, every time", () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const password = resolvePrivateStatePassword(fakeStore());
      expect(policyComplaint(password), password).toBeNull();
    }
  });

  it("rejects a hex password, which is what the first attempt generated", () => {
    const hex = "a".repeat(2) + "3f9c1b7e05d2486a9f0c3e5b1d7a4c8e2b6f0a9d3c5e7b1f4a8c";
    expect(policyComplaint(hex)).toBe("only 2 character classes");
  });

  it("replaces a stored password the policy would reject, rather than staying broken", () => {
    const store = fakeStore();
    store.setItem("proofpass:private-state-password", "3f9c1b7e05d2486a9f0c3e5b1d7a4c8e");
    const password = resolvePrivateStatePassword(store);
    expect(password).not.toBe("3f9c1b7e05d2486a9f0c3e5b1d7a4c8e");
    expect(policyComplaint(password)).toBeNull();
  });

  it("keeps the same password, or every reload orphans the stored state", () => {
    const store = fakeStore();
    expect(resolvePrivateStatePassword(store)).toBe(resolvePrivateStatePassword(store));
  });

  it("does not reuse the authority secret as the storage password", () => {
    const store = fakeStore();
    resolvePrivateStatePassword(store);
    expect([...store.held.keys()]).not.toContain("proofpass:authority-secret");
  });

  it("builds a provider with the methods the deploy calls once the transaction lands", () => {
    const provider = createPrivateStateProvider("mn_shield-cpk_test1abc", fakeStore());
    for (const method of ["setContractAddress", "set", "get", "setSigningKey", "getSigningKey"] as const) {
      expect(typeof provider[method]).toBe("function");
    }
  });

  it("refuses to build without a wallet account, so two wallets cannot share a store", () => {
    expect(() => createPrivateStateProvider("", fakeStore())).toThrow(/accountId/);
  });
});


describe("resolveProofServerUri", () => {
  /**
   * Explicit over ambient: reading the environment here would make the result
   * depend on whoever's .env is on disk, which is how a test starts passing
   * for the wrong reason.
   */
  it("reports none for an empty setting, so the wallet's prover is used", () => {
    expect(resolveProofServerUri("")).toBeNull();
  });

  it("ignores whitespace rather than building a provider from a blank string", () => {
    expect(resolveProofServerUri("   ")).toBeNull();
  });

  it("takes the configured server, trimmed", () => {
    expect(resolveProofServerUri("  http://localhost:6300  ")).toBe("http://localhost:6300");
  });

  it("lets an explicit setting win over the environment, in either direction", () => {
    expect(resolveProofServerUri("http://elsewhere:6300")).toBe("http://elsewhere:6300");
    expect(resolveProofServerUri("")).toBeNull();
  });
});
