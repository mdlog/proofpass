import { describe, expect, it, vi } from "vitest";
import { PROOF_SERVER_PATH, proofServerProxy } from "./proofServerProxy";

/**
 * The browser must not fetch the proof server directly.
 *
 * Lace runs a service worker that intercepts page-level fetches, and a request
 * originating from that context to 127.0.0.1 is refused by Chrome outright. A
 * same-origin path passes through the worker to the network, where this handler
 * forwards it server-side — which also means the prover never needs to be
 * exposed publicly, and the witness inside a proof preimage never leaves the
 * machines the operator already runs.
 */
const handler = (upstream: string, fetchFn: typeof fetch) => proofServerProxy({ upstream, fetchFn });

const call = async (proxy: ReturnType<typeof proofServerProxy>, req: Partial<{ method: string; path: string; body: unknown }>) => {
  const sent: { status?: number; headers: Record<string, string>; body?: unknown } = { headers: {} };
  const res = {
    status(code: number) { sent.status = code; return res; },
    setHeader(key: string, value: string) { sent.headers[key] = value; },
    send(body: unknown) { sent.body = body; return res; },
    end() { return res; },
  };
  await proxy({ method: "POST", path: `${PROOF_SERVER_PATH}/prove`, body: Buffer.from("x"), header: () => "application/octet-stream", ...req } as never, res as never, vi.fn());
  return sent;
};

describe("proofServerProxy", () => {
  const ok = (body: string) => vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "application/octet-stream" } })) as unknown as typeof fetch;

  it("forwards the sub-path to the proof server, not the proxy prefix", async () => {
    const fetchFn = ok("proof");
    await call(handler("http://127.0.0.1:6300", fetchFn), {});
    const [url] = (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe("http://127.0.0.1:6300/prove");
  });

  it("passes the body through, since a proving request carries megabytes", async () => {
    const fetchFn = ok("proof");
    const body = Buffer.alloc(3_000_000, 7);
    await call(handler("http://127.0.0.1:6300", fetchFn), { body });
    const [, init] = (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect((init.body as Buffer).length).toBe(3_000_000);
  });

  it("returns what the prover returned", async () => {
    const sent = await call(handler("http://127.0.0.1:6300", ok("proof-bytes")), {});
    expect(sent.status).toBe(200);
  });

  it("reports an unreachable prover as a gateway failure, not a silent 200", async () => {
    const dead = vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const sent = await call(handler("http://127.0.0.1:6300", dead), {});
    expect(sent.status).toBe(502);
    expect(String(sent.body)).toMatch(/proof server/i);
  });

  it("passes a non-2xx from the prover through rather than masking it", async () => {
    const bad = vi.fn(async () => new Response("bad header tag", { status: 400 })) as unknown as typeof fetch;
    expect((await call(handler("http://127.0.0.1:6300", bad), {})).status).toBe(400);
  });

  it("refuses a method the prover has no use for", async () => {
    const fetchFn = ok("proof");
    const sent = await call(handler("http://127.0.0.1:6300", fetchFn), { method: "GET" });
    expect(sent.status).toBe(405);
    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });

  /**
   * An allowlist rather than a blocklist: `req.path` is not decoded, so a
   * blocklist on ".." misses `..%2f`, and guessing at every encoding is how one
   * gets missed. Only the shape the prover's own endpoints take is forwarded.
   */
  it.each([
    ["/proof-server/../../etc/passwd", "a traversal segment"],
    ["/proof-server/..%2fhealth", "an encoded traversal"],
    ["/proof-server/prove?x=1", "a query smuggled into the path"],
    ["/proof-server/pro ve", "a space"],
    ["/proof-server/prove\\health", "a backslash"],
  ])("refuses %s (%s)", async (path) => {
    const fetchFn = ok("proof");
    const sent = await call(handler("http://127.0.0.1:6300", fetchFn), { path });
    expect(sent.status).toBe(400);
    expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });

  it.each([
    ["/proof-server/prove"],
    ["/proof-server/check"],
    ["/proof-server/v1/prove"],
    ["/proof-server"],
  ])("forwards %s, which is the shape the prover uses", async (path) => {
    const fetchFn = ok("proof");
    const sent = await call(handler("http://127.0.0.1:6300", fetchFn), { path });
    expect(sent.status).toBe(200);
  });
});
