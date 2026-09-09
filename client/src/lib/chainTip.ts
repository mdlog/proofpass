/**
 * The current block height, from the indexer the wallet named.
 *
 * The Overview hero used to print "Block 18,420,991" — a number that was never
 * true of any chain, and the kind of decorative detail that reads as live. The
 * indexer answers `{ block { height } }` over the same GraphQL endpoint the
 * public data provider already uses, so the real tip is one request away.
 *
 * Anything short of a well-formed answer reports nothing. A hero that shows no
 * block is honest; one showing `NaN`, or a stale number kept because a request
 * failed, is not.
 */

export type ChainTip = { height: number };

export async function fetchChainTip(indexerUri: string, fetchFn: typeof fetch = fetch): Promise<ChainTip | null> {
  try {
    const response = await fetchFn(indexerUri, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ block { height } }" }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { data?: { block?: { height?: unknown } } };
    const height = payload?.data?.block?.height;
    return typeof height === "number" && Number.isFinite(height) ? { height } : null;
  } catch {
    // An unreachable indexer is not worth failing a page render over.
    return null;
  }
}
