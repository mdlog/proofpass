import { toast } from "sonner";
import { OAUTH_STATE_COOKIE, encodeOAuthState } from "@shared/const";

export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Start the Manus OAuth login. Call this from an event handler or effect at the
// moment you want to navigate, e.g. `onClick={() => startLogin()}`.
//
// It has SIDE EFFECTS — it mints a one-time nonce, writes the __Host- state
// cookie, and navigates immediately — so the cookie nonce always matches the
// `state` it sends. Do NOT call it during render (no `href={startLogin()}` /
// `loginUrl={...}`): each call overwrites the cookie, so a stray render-phase
// call would desync it from an in-flight login and the callback would reject it
// with "invalid oauth state". It returns void by design, so there is no URL to
// stash across renders.
export const isLoginConfigured = () =>
  Boolean(
    (import.meta.env.VITE_OAUTH_PORTAL_URL as string | undefined)?.trim() &&
    (import.meta.env.VITE_APP_ID as string | undefined)?.trim(),
  );

export const startLogin = () => {
  const oauthPortalUrl = (import.meta.env.VITE_OAUTH_PORTAL_URL as string | undefined)?.trim();
  const appId = (import.meta.env.VITE_APP_ID as string | undefined)?.trim();

  // Without a portal this used to build `new URL("undefined/app-auth")`, which
  // throws a TypeError the moment anyone clicks sign in — a dead button that
  // looks like a broken app. Say what is missing instead.
  if (!oauthPortalUrl || !appId) {
    toast.error("Sign-in is not configured", {
      description: "This deployment has no VITE_OAUTH_PORTAL_URL / VITE_APP_ID, so the hosted sign-in flow is unavailable.",
    });
    return;
  }

  const nonce = crypto.randomUUID();
  document.cookie = `${OAUTH_STATE_COOKIE}=${nonce}; Path=/; Max-Age=600; SameSite=None; Secure`;
  const state = encodeOAuthState({ redirectUri: `${window.location.origin}/api/oauth/callback`, nonce });

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", `${window.location.origin}/api/oauth/callback`);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  window.location.href = url.toString();
};
