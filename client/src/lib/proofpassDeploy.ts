import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import { bytesToHex, hexToBytes } from "./hex";
import { readableMessage } from "./describeError";
import { buildProofPassContract } from "./proofpassContract";
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

/** The witness returns Bytes<32>, so anything else is a configuration error. */
function secretFromHex(hex: string, what: string) {
  const bytes = hexToBytes(hex);
  if (bytes.length !== 32) throw new Error(`${what} must be 32 bytes of hex, got ${bytes.length}.`);
  return bytes;
}

export type AuthoritySecret = { secret: Uint8Array; source: "configured" | "generated"; hex: string };

/**
 * The secret behind `localSecretKey()` becomes the registry authority: only it
 * can register issuers, issue, or revoke. Losing it means the deployed contract
 * can never be administered again, so it is either configured explicitly or
 * generated once and handed back to the caller to store.
 */
export function resolveAuthoritySecret(store: Pick<Storage, "getItem" | "setItem"> = localStorage): AuthoritySecret {
  const configured = (import.meta.env.VITE_PROOFPASS_AUTHORITY_SEED as string | undefined)?.trim();
  if (configured) return { secret: secretFromHex(configured, "Authority seed"), source: "configured", hex: configured.replace(/^0x/, "") };

  const stored = store.getItem(AUTHORITY_STORAGE_KEY);
  if (stored) return { secret: secretFromHex(stored, "Stored authority secret"), source: "generated", hex: stored };

  const generated = crypto.getRandomValues(new Uint8Array(32));
  const hex = bytesToHex(generated);
  store.setItem(AUTHORITY_STORAGE_KEY, hex);
  return { secret: generated, source: "generated", hex };
}

export type DeployResult = {
  contractAddress: string;
  networkId: string;
  authority: AuthoritySecret;
};

/** Fees are paid in DUST, and a wallet holding only NIGHT has none of it yet. */
export async function readDustBalance(api: WalletBridgeApi) {
  const { balance, cap } = await api.getDustBalance();
  return { balance, cap, hasNone: balance === 0n, registered: cap > 0n };
}

/**
 * Effect reports every ZK asset failure as `ZKConfigurationReadError: Failed to
 * read verifier key for proofpass#<circuit>` — once per circuit, with the reason
 * underneath dropped. `ReportingZkConfigProvider` keeps that reason; this turns
 * it into the one sentence worth showing.
 */
export function zkAssetFailureMessage(failure: string | undefined, baseUrl: string): string | null {
  if (!failure) return null;
  return `The compiled ZK assets could not be read — ${failure}. They are served from ${baseUrl}; run \`pnpm contracts:build\` if that path is empty.`;
}

export async function deployProofPass(api: WalletBridgeApi, options: { zkAssetsBaseUrl?: string } = {}): Promise<DeployResult> {
  const dust = await readDustBalance(api);
  if (!dust.registered) {
    throw new Error("This wallet generates no DUST yet. In Lace, open Tokens and use \"Generate tDUST\" to designate your NIGHT — fees are paid in DUST, not NIGHT.");
  }
  if (dust.hasNone) {
    throw new Error("DUST balance is 0. Designated NIGHT accrues DUST over time; wait for the tank to fill and try again.");
  }

  const providers = await buildMidnightProviders(api, options);
  const authority = resolveAuthoritySecret();

  // The witness feeds the contract the secret without it ever reaching the
  // ledger: `authorityKey()` hashes it, and only the hash is published. Calls
  // reuse the same definition, so deploy and call cannot drift apart.
  const compiled = await buildProofPassContract();

  let deployed: { deployTxData: { public: { contractAddress: string } } };
  try {
    deployed = await deployContract(providers as never, {
      compiledContract: compiled,
      privateStateId: "proofpass",
      initialPrivateState: { secret: authority.secret },
    } as never) as { deployTxData: { public: { contractAddress: string } } };
  } catch (error) {
    // The five circuits' verifier keys are read before the wallet is touched, so
    // an unreadable asset surfaces here rather than as a wallet refusal.
    const assetFailure = zkAssetFailureMessage(providers.zkConfigProvider.firstFailure, providers.zkConfigProvider.baseURL);
    if (assetFailure) throw new Error(assetFailure, { cause: error });

    // "could not balance dust" says nothing about how short the wallet was.
    const message = readableMessage(error, "The wallet did not complete the deployment.");
    if (/insufficient|balance dust/i.test(message)) {
      throw new Error(`${message}. Wallet holds ${dust.balance} of a ${dust.cap} DUST cap — wait for the tank to fill further and retry.`, { cause: error });
    }
    throw error;
  }

  return {
    contractAddress: deployed.deployTxData.public.contractAddress,
    networkId: providers.configuration.networkId,
    authority,
  };
}
