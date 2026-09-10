import type { NextFunction, Request, Response } from "express";

/**
 * Forwards proving requests to the proof server, server-side.
 *
 * The browser must not reach the prover directly. Lace runs a service worker
 * that intercepts page-level fetches, and a request originating from that
 * context to 127.0.0.1 is refused by Chrome outright — so a dApp pointing at
 * `http://localhost:6300` works only by luck of which context the fetch ends up
 * in. A same-origin path passes through the worker to the network, and this
 * handler forwards it from Node, where no such restriction applies.
 *
 * Two things follow that matter beyond the bug. The prover never has to be
 * exposed publicly, so there is no open endpoint to abuse. And the proof
 * preimage — which carries the witness, and so the secret behind it — travels
 * only to the origin already serving the app and then over loopback, rather
 * than to a second public host.
 */

export const PROOF_SERVER_PATH = "/proof-server";

export const DEFAULT_PROOF_SERVER_URL = "http://127.0.0.1:6300";

/** `/`, or slash-separated segments of unreserved characters — nothing else. */
const SAFE_SUFFIX = /^\/$|^(?:\/(?!\.\.?(?:\/|$))[A-Za-z0-9._~-]+)+$/;

export type ProofServerProxyOptions = {
  upstream?: string;
  fetchFn?: typeof fetch;
};

export function proofServerProxy({ upstream = DEFAULT_PROOF_SERVER_URL, fetchFn = fetch }: ProofServerProxyOptions = {}) {
  const base = upstream.replace(/\/$/, "");

  return async function handle(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!req.path.startsWith(`${PROOF_SERVER_PATH}/`) && req.path !== PROOF_SERVER_PATH) {
      next();
      return;
    }
    // Proving is a POST of binary; nothing else here is meaningful, and
    // answering only what the prover uses keeps the surface as small as the job.
    if (req.method !== "POST") {
      res.status(405).setHeader("Allow", "POST");
      res.send("Only POST is proxied to the proof server.");
      return;
    }

    const suffix = req.path.slice(PROOF_SERVER_PATH.length) || "/";
    // An allowlist, not a blocklist: `req.path` is not decoded, so testing for
    // ".." misses `..%2f`, and guessing at every encoding is how one gets
    // missed. Only the shape the prover's own endpoints take gets through.
    if (!SAFE_SUFFIX.test(suffix)) {
      res.status(400).send("Invalid proof server path.");
      return;
    }

    try {
      const upstreamResponse = await fetchFn(`${base}${suffix}`, {
        method: "POST",
        headers: { "Content-Type": req.header("content-type") ?? "application/octet-stream" },
        body: req.body as BodyInit,
      });
      const payload = Buffer.from(await upstreamResponse.arrayBuffer());
      res.status(upstreamResponse.status);
      res.setHeader("Content-Type", upstreamResponse.headers.get("content-type") ?? "application/octet-stream");
      res.send(payload);
    } catch (error) {
      // A dead prover must not read as a proof that failed on its merits.
      res.status(502).send(`The proof server at ${base} did not answer: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}
