/**
 * The browser side of the Compact boundary (ARCHITECTURE §20).
 *
 * The generated module arrives through the bundler, not through a URL import:
 * it opens with `import * as __compactRuntime from '@midnight-ntwrk/compact-runtime'`
 * and calls `checkRuntimeVersion('0.16.0')`, and a bare specifier like that is
 * unresolvable for a raw `import(url)` in a page. The compiled ZK assets do come
 * over HTTP, because that is what a ZK config provider fetches per circuit.
 *
 * Nothing here claims a transaction was submitted. Preparing a circuit request
 * is exactly that — preparation.
 */

declare const __COMPACT_CONTRACT_PRESENT__: boolean;

export type CompactArtifactManifest = {
  contractName: string;
  compiledAssetsUrl: string;
  networkId: string;
  version?: string;
};

export type GeneratedCompactContractModule = {
  Contract?: unknown;
  witnesses?: Record<string, unknown>;
  __artifactMissing?: boolean;
};

export type LoadedCompactArtifact = CompactArtifactManifest & {
  module: GeneratedCompactContractModule;
  circuits: string[];
  loadedAt: string;
};

/** Where `pnpm contracts:build` copies `keys/` and `zkir/`. */
const DEFAULT_ASSETS_URL = "/compact/proofpass";

export function getDefaultCompactArtifactManifest(): CompactArtifactManifest | null {
  if (!__COMPACT_CONTRACT_PRESENT__) return null;
  return {
    contractName: (import.meta.env.VITE_COMPACT_CONTRACT_NAME as string | undefined)?.trim() || "proofpass",
    compiledAssetsUrl: (import.meta.env.VITE_COMPACT_ASSETS_URL as string | undefined)?.trim() || DEFAULT_ASSETS_URL,
    networkId: (import.meta.env.VITE_MIDNIGHT_NETWORK as string | undefined)?.trim() || "preview",
    version: (import.meta.env.VITE_COMPACT_ARTIFACT_VERSION as string | undefined)?.trim(),
  };
}

/**
 * Circuit names as the compiler generated them, rather than a hand-kept list.
 *
 * The constructor refuses to build unless every declared witness is present as a
 * function, so introspection passes a proxy that answers any name. None of them
 * is ever invoked — this only reads the circuit table off the instance. A
 * failure here is deliberately not swallowed: a silent empty list would turn the
 * circuit check into a no-op that always passes.
 */
function readCircuitNames(module: GeneratedCompactContractModule): string[] {
  const Generated = module.Contract as (new (witnesses: unknown) => { impureCircuits?: Record<string, unknown> }) | undefined;
  if (typeof Generated !== "function") throw new Error("Generated Compact module does not export a Contract constructor.");
  const introspectionWitnesses = new Proxy({}, {
    get: () => () => { throw new Error("Witnesses are unavailable during introspection."); },
  });
  return Object.keys(new Generated(introspectionWitnesses).impureCircuits ?? {});
}

export async function loadCompactArtifact(manifest: CompactArtifactManifest): Promise<LoadedCompactArtifact> {
  const module = await import("@compact/proofpass") as GeneratedCompactContractModule;
  if (module.__artifactMissing || !module.Contract) {
    throw new Error("Generated Compact module is missing. Run `pnpm contracts:build` to compile contracts/proofpass.compact.");
  }
  return { ...manifest, module, circuits: readCircuitNames(module), loadedAt: new Date().toISOString() };
}

export function createCompactContractRequest(artifact: LoadedCompactArtifact, circuit: string, args: unknown[] = []) {
  if (!artifact.module.Contract) throw new Error("Compact artifact is not loaded.");
  if (artifact.circuits.length && !artifact.circuits.includes(circuit)) {
    throw new Error(`Circuit "${circuit}" is not one of ${artifact.circuits.join(", ")}.`);
  }
  return { contractName: artifact.contractName, circuit, args, networkId: artifact.networkId, artifactVersion: artifact.version, assetsUrl: artifact.compiledAssetsUrl };
}

export function describeCompactIntegration() {
  if (!__COMPACT_CONTRACT_PRESENT__) {
    return { configured: false, label: "Artifact not compiled", detail: "Run `pnpm contracts:build` to compile contracts/proofpass.compact and publish its ZK assets." };
  }
  return { configured: true, label: "Artifact compiled", detail: `Generated module bundled; ZK assets served from ${getDefaultCompactArtifactManifest()?.compiledAssetsUrl}.` };
}
