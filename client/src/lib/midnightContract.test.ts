import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCompactContractRequest, getDefaultCompactArtifactManifest, loadCompactArtifact } from "./midnightContract";

const artifactBuilt = existsSync(path.resolve(import.meta.dirname, "../../../contracts/managed/proofpass/contract/index.js"));

// The generated module is build output, so a checkout that never ran
// `pnpm contracts:build` skips rather than fails.
describe.skipIf(!artifactBuilt)("compiled Compact artifact", () => {
  it("exposes exactly the circuits the contract exports", async () => {
    const manifest = getDefaultCompactArtifactManifest();
    expect(manifest).not.toBeNull();
    const artifact = await loadCompactArtifact(manifest!);
    expect(artifact.circuits.sort()).toEqual(
      ["issueCredential", "proveEligibility", "registerIssuer", "revokeCredential", "revokeIssuer"],
    );
  });

  it("refuses a circuit the contract does not declare", async () => {
    const artifact = await loadCompactArtifact(getDefaultCompactArtifactManifest()!);
    expect(() => createCompactContractRequest(artifact, "issueCredential")).not.toThrow();
    expect(() => createCompactContractRequest(artifact, "mintTokens")).toThrow(/not one of/i);
  });
});
