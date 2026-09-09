import { describe, expect, it, vi } from "vitest";
import { allowZkAssetOrigin, ZK_ASSET_PREFIX } from "./zkAssets";

/**
 * The wallet does the proving, and it reaches for the prover keys from its own
 * extension origin — not the page's. Without a cross-origin header that request
 * is refused before it is sent, and the wallet reports only
 * "'prove' returned an error: TypeError: Failed to fetch".
 *
 * These are compiled build output: `pnpm contracts:build` publishes them and
 * anyone who can reach the server can already download them, so opening them to
 * other origins discloses nothing new.
 */
const call = (path: string) => {
  const headers: Record<string, string> = {};
  const next = vi.fn();
  allowZkAssetOrigin({ path } as never, { setHeader: (key: string, value: string) => { headers[key] = value; } } as never, next);
  return { headers, next };
};

describe("allowZkAssetOrigin", () => {
  it("lets the wallet fetch a prover key", () => {
    expect(call(`${ZK_ASSET_PREFIX}/proofpass/keys/registerIssuer.prover`).headers["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("covers the zkir the prover reads alongside the key", () => {
    expect(call(`${ZK_ASSET_PREFIX}/proofpass/zkir/registerIssuer.bzkir`).headers["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("leaves the API alone, where a session cookie is what identifies the caller", () => {
    expect(call("/api/trpc/issuer.registry").headers).toEqual({});
  });

  it("leaves the app itself alone", () => {
    expect(call("/").headers).toEqual({});
  });

  it("never allows credentials, so opening the assets cannot open a session", () => {
    expect(call(`${ZK_ASSET_PREFIX}/proofpass/keys/registerIssuer.prover`).headers["Access-Control-Allow-Credentials"]).toBeUndefined();
  });

  it("does not swallow a path that merely mentions the prefix later on", () => {
    expect(call("/api/compact/proofpass/keys/x.prover").headers).toEqual({});
  });

  it("always continues, whether or not it applied", () => {
    expect(call("/").next).toHaveBeenCalledOnce();
    expect(call(`${ZK_ASSET_PREFIX}/proofpass/keys/x.prover`).next).toHaveBeenCalledOnce();
  });
});
