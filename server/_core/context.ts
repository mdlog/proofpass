import type * as trpcExpress from "@trpc/server/adapters/express";
import { sdk } from "./sdk";

/**
 * An unauthenticated request is a normal state, not an error: the whole demo
 * path renders without a session, so a failed lookup yields `user: null`.
 */
export async function createContext(opts: trpcExpress.CreateExpressContextOptions) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch {
    user = null;
  }
  return { req: opts.req, res: opts.res, user };
}

/** The tRPC context. `Context` is kept as an alias for local readability. */
export type TrpcContext = Awaited<ReturnType<typeof createContext>>;
export type Context = TrpcContext;
