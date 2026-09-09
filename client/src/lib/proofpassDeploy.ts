import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import { buildMidnightProviders, type WalletBridgeApi } from "./midnightProviders";

/**
 * Deploys contracts/proofpass.compact through the connected wallet.
 *
 * ARCHITECTURE §18: the app prepares, the wallet signs and submits. Nothing
 * here holds a key or talks to a node directly — every endpoint comes from the
 * wallet's own `getConfiguration()`.
 */

const AUTHORITY_STORAGE_KEY = "proofpass:authority-secret";

export type ProofPassPrivateState = { secret: Uint8Array };

function hexToBytes(hex: string) {
  const clean = hex.trim().replace(/^0x/, "");
  if (clean.length !== 64 || !/^[0-9a-f]+$/i.test(clean)) throw new Error("Authority seed must be 32 bytes of hex.");
  return Uint8Array.from(clean.match(/../g)!.map((byte) => parseInt(byte, 16)));
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type AuthoritySecret = { secret: Uint8Array; source: "configured" | "generated"; hex: string };

/**
 * The secret behind `localSecretKey()` becomes the registry authority: only it
 * can register issuers, issue, or revoke. Losing it means the deployed contract
 * can never be administered again, so it is either configured explicitly or
 * generated once and handed back to the caller to store.
 */
export function resolveAuthoritySecret(): AuthoritySecret {
  const configured = (import.meta.env.VITE_PROOFPASS_AUTHORITY_SEED as string | undefined)?.trim();
  if (configured) return { secret: hexToBytes(configured), source: "configured", hex: configured.replace(/^0x/, "") };

  const stored = localStorage.getItem(AUTHORITY_STORAGE_KEY);
  if (stored) return { secret: hexToBytes(stored), source: "generated", hex: stored };

  const generated = crypto.getRandomValues(new Uint8Array(32));
  const hex = bytesToHex(generated);
  localStorage.setItem(AUTHORITY_STORAGE_KEY, hex);
  return { secret: generated, source: "generated", hex };
}

export type DeployResult = {
  contractAddress: string;
  networkId: string;
  authority: AuthoritySecret;
};

export async function deployProofPass(api: WalletBridgeApi, options: { zkAssetsBaseUrl?: string } = {}): Promise<DeployResult> {
  const providers = await buildMidnightProviders(api, options);
  const authority = resolveAuthoritySecret();

  const generated = await import("@compact/proofpass") as { Contract?: unknown; __artifactMissing?: boolean };
  if (generated.__artifactMissing || !generated.Contract) {
    throw new Error("Generated Compact module is missing. Run `pnpm contracts:build` first.");
  }

  // The witness feeds the contract the secret without it ever reaching the
  // ledger: `authorityKey()` hashes it, and only the hash is published.
  const witnesses = {
    localSecretKey: ({ privateState }: { privateState: ProofPassPrivateState }): [ProofPassPrivateState, Uint8Array] =>
      [privateState, privateState.secret],
  };

  // The builder is Effect-style and its generics track what is still missing;
  // the same loose view server/contractAdapter.ts uses keeps the call readable.
  const builder = CompiledContract as unknown as {
    make: (tag: string, ctor: unknown) => unknown;
    withWitnesses: (self: unknown, witnesses: unknown) => unknown;
    withCompiledFileAssets: (self: unknown, path: string) => unknown;
  };
  let compiled = builder.make("proofpass", generated.Contract);
  compiled = builder.withWitnesses(compiled, witnesses);
  // Relative: the ZK config provider resolves it against its own base URL.
  compiled = builder.withCompiledFileAssets(compiled, "");

  const deployed = await deployContract(providers as never, {
    compiledContract: compiled,
    privateStateId: "proofpass",
    initialPrivateState: { secret: authority.secret },
  } as never) as { deployTxData: { public: { contractAddress: string } } };

  return {
    contractAddress: deployed.deployTxData.public.contractAddress,
    networkId: providers.configuration.networkId,
    authority,
  };
}
