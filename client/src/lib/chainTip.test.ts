import { describe, expect, it, vi } from "vitest";
import { fetchChainTip } from "./chainTip";

/**
 * The Overview hero printed "Block 18,420,991", a number that was never true of
 * any chain. The indexer answers `{ block { height } }`, so the real tip is one
 * request away — and anything less than a well-formed answer reports nothing
 * rather than a number that looks authoritative.
 */
const respondWith = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

const INDEXER = "https://indexer.example/midnight-preprod/";

describe("fetchChainTip", () => {
  it("reads the height the indexer reports", async () => {
    const tip = await fetchChainTip(INDEXER, respondWith({ data: { block: { height: 2480691 } } }));
    expect(tip).toEqual({ height: 2480691 });
  });

  it("asks for the block, as a GraphQL query", async () => {
    const fetchFn = respondWith({ data: { block: { height: 1 } } });
    await fetchChainTip(INDEXER, fetchFn);
    const [url, init] = (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe(INDEXER);
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("block");
  });

  it("reports nothing when the indexer answers with errors", async () => {
    expect(await fetchChainTip(INDEXER, respondWith({ errors: [{ message: "nope" }] }))).toBeNull();
  });

  it("reports nothing for a height that is not a number, rather than printing NaN", async () => {
    expect(await fetchChainTip(INDEXER, respondWith({ data: { block: { height: "high" } } }))).toBeNull();
  });

  it("reports nothing when the indexer refuses the request", async () => {
    expect(await fetchChainTip(INDEXER, respondWith({}, 500))).toBeNull();
  });

  it("survives a body that is not JSON at all", async () => {
    const fetchFn = vi.fn(async () => new Response("<html>gateway</html>", { status: 200 })) as unknown as typeof fetch;
    expect(await fetchChainTip(INDEXER, fetchFn)).toBeNull();
  });

  it("survives a network that never answers, since the hero must still render", async () => {
    const fetchFn = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    expect(await fetchChainTip(INDEXER, fetchFn)).toBeNull();
  });
});
