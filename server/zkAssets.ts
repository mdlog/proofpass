import type { NextFunction, Request, Response } from "express";

/**
 * Lets the wallet fetch the compiled ZK assets.
 *
 * Proving happens inside the wallet (ARCHITECTURE §18), and it reaches for the
 * prover key and zkir from its own extension origin rather than the page's.
 * Without a cross-origin header the browser refuses that request before it is
 * sent, and all the wallet can report back is "'prove' returned an error:
 * TypeError: Failed to fetch".
 *
 * Opening these discloses nothing: they are what `pnpm contracts:build`
 * publishes into `client/public`, already downloadable by anyone who can reach
 * the server, and they carry no key belonging to anybody. Credentials stay off,
 * so this cannot be turned into a way to reach an authenticated route.
 */

export const ZK_ASSET_PREFIX = "/compact";

export function allowZkAssetOrigin(req: Request, res: Response, next: NextFunction): void {
  if (req.path === ZK_ASSET_PREFIX || req.path.startsWith(`${ZK_ASSET_PREFIX}/`)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  next();
}
