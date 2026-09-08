import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCompactArtifactStatus, validateCompiledContract } from "./contractAdapter";

describe("contractAdapter", () => {
  const original = {
    modulePath: process.env.MIDNIGHT_COMPACT_MODULE_PATH,
    assetsPath: process.env.MIDNIGHT_COMPACT_ASSETS_PATH,
    contractTag: process.env.MIDNIGHT_COMPACT_CONTRACT_TAG,
    networkId: process.env.MIDNIGHT_NETWORK_ID,
  };

  beforeEach(() => {
    delete process.env.MIDNIGHT_COMPACT_MODULE_PATH;
    delete process.env.MIDNIGHT_COMPACT_ASSETS_PATH;
    delete process.env.MIDNIGHT_COMPACT_CONTRACT_TAG;
    delete process.env.MIDNIGHT_NETWORK_ID;
  });

  afterEach(() => {
    if (original.modulePath === undefined) delete process.env.MIDNIGHT_COMPACT_MODULE_PATH;
    else process.env.MIDNIGHT_COMPACT_MODULE_PATH = original.modulePath;
    if (original.assetsPath === undefined) delete process.env.MIDNIGHT_COMPACT_ASSETS_PATH;
    else process.env.MIDNIGHT_COMPACT_ASSETS_PATH = original.assetsPath;
    if (original.contractTag === undefined) delete process.env.MIDNIGHT_COMPACT_CONTRACT_TAG;
    else process.env.MIDNIGHT_COMPACT_CONTRACT_TAG = original.contractTag;
    if (original.networkId === undefined) delete process.env.MIDNIGHT_NETWORK_ID;
    else process.env.MIDNIGHT_NETWORK_ID = original.networkId;
  });

  it("reports an explicit not-configured state without importing a contract", async () => {
    const status = await getCompactArtifactStatus();
    expect(status.configured).toBe(false);
    expect(status.moduleAvailable).toBe(false);
    expect(status.assetsAvailable).toBe(false);
    expect(status.contractTag).toBe("proofpass");
    expect(status.networkId).toBe("preview");
  });

  it("reports configured paths as unavailable when the generated output is missing", async () => {
    process.env.MIDNIGHT_COMPACT_MODULE_PATH = "/tmp/proofpass-missing/contract.js";
    process.env.MIDNIGHT_COMPACT_ASSETS_PATH = "/tmp/proofpass-missing/assets";
    const status = await getCompactArtifactStatus();
    expect(status.configured).toBe(true);
    expect(status.moduleAvailable).toBe(false);
    expect(status.assetsAvailable).toBe(false);
    await expect(validateCompiledContract()).rejects.toThrow("not readable");
  });
});

describe("contractAdapter with the real generated artifacts", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const modulePath = path.join(root, "contracts/managed/proofpass/contract/index.js");
  const assetsPath = path.join(root, "contracts/managed/proofpass");
  const keysPresent = existsSync(path.join(assetsPath, "keys"));

  beforeEach(() => {
    process.env.MIDNIGHT_COMPACT_MODULE_PATH = modulePath;
    process.env.MIDNIGHT_COMPACT_ASSETS_PATH = assetsPath;
    process.env.MIDNIGHT_COMPACT_CONTRACT_TAG = "proofpass";
  });

  it("reports the generated module as present", async () => {
    const status = await getCompactArtifactStatus();
    expect(status).toMatchObject({ configured: true, moduleAvailable: true, contractTag: "proofpass" });
  });

  // The proving keys are build output and stay out of version control, so this
  // asserts whichever state the working tree is actually in — and that the two
  // states disagree, which is the point of the check.
  it("ties asset availability to the compiled keys, not just the directory", async () => {
    const status = await getCompactArtifactStatus();
    expect(status.assetsAvailable).toBe(keysPresent);
    expect(status.detail).toMatch(keysPresent ? /ready for Midnight\.js/ : /not readable/);
  });

  it(
    keysPresent
      ? "builds a real CompiledContract from the generated module"
      : "refuses to build without the compiled keys instead of reporting ready",
    async () => {
      if (keysPresent) {
        await expect(validateCompiledContract()).resolves.toMatchObject({ contractTag: "proofpass", compiledContractReady: true });
      } else {
        // ARCHITECTURE §20: missing generated output is an explicit unavailable
        // state, never something the app can present as a working contract.
        await expect(validateCompiledContract()).rejects.toThrow(/not readable/);
      }
    },
  );
});
