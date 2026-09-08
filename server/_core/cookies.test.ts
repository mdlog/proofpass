import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { getSessionCookieOptions } from "./cookies";

/**
 * `SameSite=None` cookies are only accepted when Secure is set, so getting this
 * wrong silently logs everyone out behind a proxy. The x-forwarded-proto branch
 * is the entire reason this module exists.
 */
const request = (protocol: string, forwarded?: string | string[]) =>
  ({ protocol, headers: forwarded === undefined ? {} : { "x-forwarded-proto": forwarded } }) as unknown as Request;

describe("getSessionCookieOptions", () => {
  it("always locks the cookie to the app and away from scripts", () => {
    expect(getSessionCookieOptions(request("https"))).toMatchObject({ httpOnly: true, path: "/", sameSite: "none" });
  });

  it("trusts a direct TLS connection", () => {
    expect(getSessionCookieOptions(request("https")).secure).toBe(true);
  });

  it("does not claim secure on a plain connection with no proxy header", () => {
    expect(getSessionCookieOptions(request("http")).secure).toBe(false);
  });

  it("trusts a proxy that terminated TLS upstream", () => {
    expect(getSessionCookieOptions(request("http", "https")).secure).toBe(true);
  });

  it("reads https out of a comma-separated forwarding chain", () => {
    expect(getSessionCookieOptions(request("http", "http, https")).secure).toBe(true);
  });

  it("accepts the header in its array form", () => {
    expect(getSessionCookieOptions(request("http", ["https", "http"])).secure).toBe(true);
  });

  it("ignores casing and padding rather than failing closed on cosmetics", () => {
    expect(getSessionCookieOptions(request("http", "  HTTPS  ")).secure).toBe(true);
  });

  it("stays insecure when the chain never mentions https", () => {
    expect(getSessionCookieOptions(request("http", "http, http")).secure).toBe(false);
  });
});
