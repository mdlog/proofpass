import { access } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export type CompactArtifactStatus = {
  configured: boolean;
  modulePath: string | null;
  assetsPath: string | null;
  moduleAvailable: boolean;
  assetsAvailable: boolean;
  contractTag: string;
  networkId: string;
  detail: string;
};

type GeneratedContractModule = {
  Contract?: unknown;
  default?: { Contract?: unknown };
  witnesses?: Record<string, unknown>;
};

type CompiledContractApi = {
  make: (tag: string, contract: unknown) => unknown;
  withWitnesses: (contract: unknown, witnesses: Record<string, unknown>) => unknown;
  withVacantWitnesses: (contract: unknown) => unknown;
  withCompiledFileAssets: (contract: unknown, assetsPath: string) => unknown;
};

function configuredPath(name: string) {
  const value = process.env[name]?.trim();
  return value || null;
}

async function pathExists(path: string | null) {
  if (!path) return false;
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function getCompactArtifactStatus(): Promise<CompactArtifactStatus> {
  const modulePath = configuredPath("MIDNIGHT_COMPACT_MODULE_PATH");
  const assetsPath = configuredPath("MIDNIGHT_COMPACT_ASSETS_PATH");
  const moduleAvailable = await pathExists(modulePath);
  const assetsAvailable = await pathExists(assetsPath);
  const configured = Boolean(modulePath && assetsPath);
  let detail = "Set MIDNIGHT_COMPACT_MODULE_PATH and MIDNIGHT_COMPACT_ASSETS_PATH to activate the generated Compact contract.";
  if (configured && moduleAvailable && assetsAvailable) detail = "Generated Compact module and compiled assets are ready for Midnight.js.";
  else if (configured) detail = "Compact paths are configured, but one or more files/directories are not readable.";
  return {
    configured,
    modulePath,
    assetsPath,
    moduleAvailable,
    assetsAvailable,
    contractTag: process.env.MIDNIGHT_COMPACT_CONTRACT_TAG?.trim() || "proofpass",
    networkId: process.env.MIDNIGHT_NETWORK_ID?.trim() || "preview",
    detail,
  };
}

export async function loadCompiledContract() {
  const status = await getCompactArtifactStatus();
  if (!status.modulePath || !status.assetsPath || !status.moduleAvailable || !status.assetsAvailable) {
    throw new Error(status.detail);
  }

  const generated = await import(pathToFileURL(status.modulePath).href) as GeneratedContractModule;
  const contract = generated.Contract ?? generated.default?.Contract;
  if (!contract) throw new Error("The generated Compact module does not export Contract.");

  const compactJs = await import("@midnight-ntwrk/midnight-js-protocol/compact-js") as unknown as { CompiledContract: CompiledContractApi };
  const compiledApi = compactJs.CompiledContract;
  let compiled = compiledApi.make(status.contractTag, contract);
  compiled = generated.witnesses ? compiledApi.withWitnesses(compiled, generated.witnesses) : compiledApi.withVacantWitnesses(compiled);
  compiled = compiledApi.withCompiledFileAssets(compiled, status.assetsPath);
  return { compiledContract: compiled, status };
}

export async function validateCompiledContract() {
  const { compiledContract, status } = await loadCompiledContract();
  return { contractTag: status.contractTag, networkId: status.networkId, compiledContractReady: Boolean(compiledContract), detail: status.detail };
}
