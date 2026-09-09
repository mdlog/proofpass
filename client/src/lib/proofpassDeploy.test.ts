import { describe, expect, it } from "vitest";
import { zkAssetFailureMessage } from "./proofpassDeploy";

/**
 * A deploy reads the five circuits' verifier keys before the wallet is ever
 * asked for anything. When that read fails, Midnight.js reports only
 * "Failed to read verifier key for proofpass#registerIssuer" — five times, once
 * per circuit, with the actual reason dropped. The provider keeps that reason;
 * this turns it into the sentence the operator sees.
 */
describe("zkAssetFailureMessage", () => {
  const BASE = "http://localhost:3010/compact/proofpass";

  it("says nothing when the assets read fine, so other failures keep their own message", () => {
    expect(zkAssetFailureMessage(undefined, BASE)).toBeNull();
  });

  it("leads with the reason the provider kept", () => {
    const message = zkAssetFailureMessage("verifier key for registerIssuer: Failed to fetch ZK artifact from …: 404 Not Found", BASE);
    expect(message).toContain("verifier key for registerIssuer");
    expect(message).toContain("404 Not Found");
  });

  it("names where the assets are served from, since a wrong base is the usual cause", () => {
    expect(zkAssetFailureMessage("zkir for proveEligibility: Failed to fetch", BASE)).toContain(BASE);
  });

  it("points at the build step that produces them", () => {
    expect(zkAssetFailureMessage("prover key for issueCredential: 404", BASE)).toMatch(/contracts:build/);
  });
});
