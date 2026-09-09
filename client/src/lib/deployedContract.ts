/**
 * Where a deployed contract address is kept.
 *
 * The address exists in exactly one place the moment `deployContract` returns:
 * the value in hand. It used to reach a toast and `console.info` and nowhere
 * else, so closing the tab lost the only record of a contract that had already
 * cost DUST to put on chain. The registry is the durable home for it, but that
 * needs an authenticated account — so it is written locally first, which costs
 * nothing and covers the signed-out case.
 */

const DEPLOYED_STORAGE_KEY = "proofpass:deployed-contract";

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

export type DeployedContract = { contractAddress: string; networkId: string; deployedAt: string };

export function rememberDeployedContract(
  result: { contractAddress: string; networkId: string },
  store: KeyValueStore = localStorage,
  at: Date = new Date(),
): void {
  try {
    store.setItem(DEPLOYED_STORAGE_KEY, JSON.stringify({ ...result, deployedAt: at.toISOString() }));
  } catch {
    // Private window, blocked site data. The toast and console still have it.
  }
}

export function lastDeployedContract(store: KeyValueStore = localStorage): DeployedContract | null {
  try {
    const raw = store.getItem(DEPLOYED_STORAGE_KEY);
    return raw ? JSON.parse(raw) as DeployedContract : null;
  } catch {
    return null;
  }
}

type AttachableIssuer = { id: number; networkId: string; contractAddress?: string | null };

/**
 * Which issuer a freshly deployed contract belongs to.
 *
 * Never one on another network — a preprod address on a preview issuer would be
 * a record that reads as true and is not. Among the rest an issuer still
 * without a contract is the obvious home; otherwise the most recent one, which
 * is what the registry already returns first.
 */
export function issuerForContract<T extends AttachableIssuer>(issuers: readonly T[], networkId: string): T | null {
  const onNetwork = issuers.filter((candidate) => candidate.networkId === networkId);
  return onNetwork.find((candidate) => !candidate.contractAddress) ?? onNetwork[0] ?? null;
}
