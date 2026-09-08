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
