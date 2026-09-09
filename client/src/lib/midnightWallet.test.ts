import { describe, expect, it } from "vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { awaitWalletResponse, connectMidnightWallet, discoverWalletNetwork, WalletNetworkMismatchError, WalletUnresponsiveError, type DetectedWallet } from "./midnightWallet";

/**
 * A stand-in for Lace 2.2.3. Its `connect` accepts exactly one network — the one
 * the wallet is actually on — and rejects every other with the bare message Lace
 * really sends, which never names the network it wants.
 */
function walletOn(activeNetwork: string) {
  const attempts: string[] = [];
  const wallet: DetectedWallet = {
    id: "2d7e3c0e-0f97-49cb-9fb8-923e565ac15d",
    name: "lace",
    apiVersion: "4.0.1",
    rdns: "io.lace.wallet",
    connect: async (networkId: string) => {
      attempts.push(networkId);
      if (networkId !== activeNetwork) throw new Error("Network ID mismatch");
      return {
        getConnectionStatus: async () => ({ status: "connected", networkId: activeNetwork }),
        getConfiguration: async () => ({ networkId: activeNetwork }),
        getUnshieldedAddress: async () => ({ unshieldedAddress: `mn_addr_${activeNetwork}1wpjyvwfrh7mjhthx5jt08np3f9` }),
      };
    },
  };
  return { wallet, attempts };
}

/** A wallet whose owner clicked "reject" in the extension popup. */
function rejectingWallet() {
  const attempts: string[] = [];
  const wallet: DetectedWallet = {
    id: "lace",
    name: "lace",
    apiVersion: "4.0.1",
    connect: async (networkId: string) => {
      attempts.push(networkId);
      throw new Error("Access to wallet api denied");
    },
  };
  return { wallet, attempts };
}

describe("connectMidnightWallet", () => {
  it("connects straight away when the requested network is the wallet's network", async () => {
    const { wallet, attempts } = walletOn("preview");
    const session = await connectMidnightWallet(wallet, "preview");
    expect(session.network).toBe("preview");
    expect(attempts).toEqual(["preview"]);
  });

  // ARCHITECTURE §18: an unexpected network is rejected, never resolved by
  // quietly connecting somewhere the user did not ask for.
  it("rejects a mismatch instead of trying another network", async () => {
    const { wallet, attempts } = walletOn("preprod");
    await expect(connectMidnightWallet(wallet, "preview")).rejects.toBeInstanceOf(WalletNetworkMismatchError);
    expect(attempts).toEqual(["preview"]);
  });

  it("passes a declined request through untouched", async () => {
    const { wallet, attempts } = rejectingWallet();
    await expect(connectMidnightWallet(wallet, "preview")).rejects.toThrow(/denied/i);
    expect(attempts).toEqual(["preview"]);
  });
});

describe("discoverWalletNetwork", () => {
  it("finds the network the wallet is actually on", async () => {
    const { wallet, attempts } = walletOn("preprod");
    const session = await discoverWalletNetwork(wallet, "preview");
    expect(session.network).toBe("preprod");
    expect(session.rawAddress).toContain("preprod");
    expect(attempts).not.toContain("preview");
  });

  it("stops at a declined request rather than prompting for every network", async () => {
    const { wallet, attempts } = rejectingWallet();
    await expect(discoverWalletNetwork(wallet, "preview")).rejects.toThrow(/denied/i);
    expect(attempts).toHaveLength(1);
  });

  it("reports the failure when no network answers", async () => {
    const { wallet } = walletOn("something-else");
    await expect(discoverWalletNetwork(wallet, "preview")).rejects.toThrow(/network id mismatch/i);
  });
});

/**
 * A wallet that never answers is the failure mode with no natural error: Lace
 * asks for approval in a window outside the page, so an unanswered prompt and a
 * dead extension look identical from here — the promise simply never settles.
 */
describe("awaitWalletResponse", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("passes a prompt answer straight through", async () => {
    await expect(awaitWalletResponse(Promise.resolve("api"), { walletName: "lace" })).resolves.toBe("api");
  });

  it("passes a rejection through untouched", async () => {
    await expect(awaitWalletResponse(Promise.reject(new Error("Access to wallet api denied")), { walletName: "lace" }))
      .rejects.toThrow(/denied/);
  });

  it("nudges the user once while the wallet is still thinking", async () => {
    const onSlow = vi.fn();
    const pending = awaitWalletResponse(new Promise(() => {}), { walletName: "lace", onSlow, slowAfterMs: 8_000, timeoutMs: 120_000 });
    pending.catch(() => {});

    await vi.advanceTimersByTimeAsync(7_999);
    expect(onSlow).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(onSlow).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(onSlow).toHaveBeenCalledTimes(1);
  });

  it("gives up eventually instead of spinning forever", async () => {
    const pending = awaitWalletResponse(new Promise(() => {}), { walletName: "lace", slowAfterMs: 10, timeoutMs: 5_000 });
    const assertion = expect(pending).rejects.toBeInstanceOf(WalletUnresponsiveError);
    await vi.advanceTimersByTimeAsync(5_001);
    await assertion;
  });

  it("names the wallet and says what to check", async () => {
    const pending = awaitWalletResponse(new Promise(() => {}), { walletName: "lace", timeoutMs: 1_000 });
    const assertion = expect(pending).rejects.toThrow(/lace did not respond within 1s.*approval window.*unlocked/is);
    await vi.advanceTimersByTimeAsync(1_001);
    await assertion;
  });

  it("stops its timers once the wallet answers", async () => {
    const onSlow = vi.fn();
    await expect(awaitWalletResponse(Promise.resolve("api"), { walletName: "lace", onSlow, slowAfterMs: 10 })).resolves.toBe("api");
    await vi.advanceTimersByTimeAsync(200_000);
    expect(onSlow).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
