/**
 * Network identifiers the Midnight DApp Connector accepts.
 *
 * There is no "testnet" — Lace rejects it outright with "Unsupported network ID:
 * testnet. Supported networks are: undeployed, mainnet, preview, preprod". The
 * public test network is `preview`; `undeployed` is a local standalone node.
 */
export const MIDNIGHT_NETWORKS = ["undeployed", "mainnet", "preview", "preprod"] as const;

export type MidnightNetwork = (typeof MIDNIGHT_NETWORKS)[number];

const NETWORK_LABELS: Record<MidnightNetwork, string> = {
  undeployed: "Midnight local",
  mainnet: "Midnight mainnet",
  preview: "Midnight preview",
  preprod: "Midnight preprod",
};

function isMidnightNetwork(value: string): value is MidnightNetwork {
  return (MIDNIGHT_NETWORKS as readonly string[]).includes(value);
}

/** Network ProofPass asks the wallet for. Override with VITE_MIDNIGHT_NETWORK. */
export function getTargetNetwork(): MidnightNetwork {
  const configured = (import.meta.env.VITE_MIDNIGHT_NETWORK as string | undefined)?.trim();
  return configured && isMidnightNetwork(configured) ? configured : "preview";
}

const NETWORK_STORAGE_KEY = "proofpass:midnight-network";

/**
 * The connector exposes no way to read a wallet's network before connecting —
 * the initial API is only name/icon/apiVersion/rdns/connect — and `connect()`
 * fails with "Network ID mismatch" when the DApp guesses wrong. So the choice
 * belongs to the user, and it is remembered per browser.
 */
export function getStoredNetwork(): MidnightNetwork {
  try {
    const stored = localStorage.getItem(NETWORK_STORAGE_KEY);
    if (stored && isMidnightNetwork(stored)) return stored;
  } catch {
    // localStorage unavailable (private window, blocked site data).
  }
  return getTargetNetwork();
}

export function setStoredNetwork(network: MidnightNetwork) {
  try {
    localStorage.setItem(NETWORK_STORAGE_KEY, network);
  } catch {
    // Non-fatal: the choice simply will not persist.
  }
}

export function getNetworkLabel(network: MidnightNetwork = getStoredNetwork()) {
  return NETWORK_LABELS[network];
}

export type MidnightInitialApi = {
  rdns?: string;
  name: string;
  icon?: string;
  apiVersion: string;
  connect: (networkId: string) => Promise<MidnightConnectedApi>;
};

export type MidnightConnectedApi = {
  getConfiguration?: () => Promise<{
    networkId?: string;
    indexerUri?: string;
    indexerWsUri?: string;
    proverServerUri?: string;
    substrateNodeUri?: string;
  }>;
  getConnectionStatus?: () => Promise<{ networkId?: string }>;
  getShieldedBalances?: () => Promise<Record<string, bigint>>;
  getUnshieldedBalances?: () => Promise<Record<string, bigint>>;
  getDustBalance?: () => Promise<bigint>;
  getShieldedAddresses?: () => Promise<{ shieldedAddress?: string }>;
  getUnshieldedAddress?: () => Promise<{ unshieldedAddress?: string }>;
  getDustAddress?: () => Promise<{ dustAddress?: string }>;
  balanceUnsealedTransaction?: (tx: string, options?: { payFees?: boolean }) => Promise<{ tx: string }>;
  balanceSealedTransaction?: (tx: string, options?: { payFees?: boolean }) => Promise<{ tx: string }>;
  submitTransaction?: (tx: string) => Promise<string>;
  signData?: (data: string, options: Record<string, unknown>) => Promise<unknown>;
  /** Hands back a prover bound to the wallet's own proof server. */
  getProvingProvider?: (keyMaterialProvider: unknown) => Promise<unknown>;
};

declare global {
  interface Window {
    midnight?: Record<string, MidnightInitialApi>;
  }
}

export type DetectedWallet = MidnightInitialApi & { id: string };

/** A `window.midnight` provider whose connector major version ProofPass cannot talk to. */
export type IncompatibleWallet = { id: string; name: string; apiVersion: string };

/** A wallet extension for some other chain. It can never sign a Midnight transaction. */
export type ForeignWallet = { name: string; ecosystem: string };

export type MidnightWalletScan = {
  compatible: DetectedWallet[];
  incompatible: IncompatibleWallet[];
};

export type MidnightWalletSession = {
  wallet: DetectedWallet;
  connected: MidnightConnectedApi;
  network: MidnightNetwork;
  address: string;
  rawAddress: string;
  dustBalance?: string;
  configuration?: Awaited<ReturnType<NonNullable<MidnightConnectedApi["getConfiguration"]>>>;
};

/** Midnight DApp Connector API major version this build implements (`@midnight-ntwrk/dapp-connector-api` v4.x). */
export const SUPPORTED_API_MAJOR = 4;

function isSupportedApiVersion(version: string) {
  const major = Number.parseInt(version.split(".")[0] ?? "0", 10);
  return major === SUPPORTED_API_MAJOR;
}

/**
 * Split every `window.midnight` provider into "can connect" and "wrong connector
 * version". The second bucket used to be dropped silently, which made an
 * outdated Midnight wallet look exactly like having no wallet installed.
 */
export function scanMidnightWallets(): MidnightWalletScan {
  if (typeof window === "undefined" || !window.midnight) return { compatible: [], incompatible: [] };

  const compatible: DetectedWallet[] = [];
  const incompatible: IncompatibleWallet[] = [];

  for (const [id, wallet] of Object.entries(window.midnight)) {
    // Extension-injected input is untrusted: verify shape before reading it.
    if (!wallet || typeof wallet.name !== "string" || typeof wallet.connect !== "function") continue;
    const apiVersion = typeof wallet.apiVersion === "string" ? wallet.apiVersion : "unknown";
    if (isSupportedApiVersion(apiVersion)) {
      // Lace injects a class instance, so `connect` lives on the prototype while
      // name/icon/apiVersion/rdns are own properties. A `{ ...wallet }` spread
      // copies only the own enumerable ones and silently drops `connect`, which
      // fails later as "wallet.connect is not a function". Copy the data fields
      // and keep a bound call into the live provider instead.
      compatible.push({
        id,
        name: wallet.name,
        icon: wallet.icon,
        rdns: wallet.rdns,
        apiVersion,
        connect: (networkId: string) => wallet.connect(networkId),
      });
    } else {
      incompatible.push({ id, name: wallet.name, apiVersion });
    }
  }

  return { compatible, incompatible };
}

export function detectMidnightWallets(): DetectedWallet[] {
  return scanMidnightWallets().compatible;
}

export function hasMidnightWallet() {
  return detectMidnightWallets().length > 0;
}

const EIP6963_ANNOUNCE_WINDOW_MS = 300;

/**
 * Enumerate wallet extensions that belong to other ecosystems.
 *
 * ProofPass cannot use any of them — Midnight is not EVM/JSON-RPC and its
 * connector is a different API surface entirely — but naming them is the
 * difference between "install a wallet" (confusing when you have twelve) and
 * "none of your twelve wallets speak Midnight".
 */
export async function detectForeignWallets(): Promise<ForeignWallet[]> {
  if (typeof window === "undefined") return [];

  const found = new Map<string, ForeignWallet>();
  const add = (name: string, ecosystem: string) => {
    const key = `${ecosystem}:${name.toLowerCase()}`;
    if (!found.has(key)) found.set(key, { name, ecosystem });
  };

  // EIP-6963: EVM wallets announce themselves in response to a request event.
  const onAnnounce = (event: Event) => {
    const name = (event as CustomEvent<{ info?: { name?: string } }>).detail?.info?.name;
    if (typeof name === "string" && name) add(name, "Ethereum / EVM");
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((resolve) => setTimeout(resolve, EIP6963_ANNOUNCE_WINDOW_MS));
  window.removeEventListener("eip6963:announceProvider", onAnnounce);

  const injected = window as unknown as Record<string, any>;

  // Legacy single-provider EVM injection, only if EIP-6963 announced nothing.
  const sawEvm = [...found.values()].some((entry) => entry.ecosystem === "Ethereum / EVM");
  if (injected.ethereum && !sawEvm) {
    add(injected.ethereum.isMetaMask ? "MetaMask" : "Injected EVM wallet", "Ethereum / EVM");
  }

  // Cardano CIP-30. Adjacent to Midnight, still a different connector API.
  if (injected.cardano && typeof injected.cardano === "object") {
    for (const key of Object.keys(injected.cardano)) {
      const name = injected.cardano[key]?.name;
      add(typeof name === "string" && name ? name : key, "Cardano (CIP-30)");
    }
  }

  if (injected.solana || injected.phantom) add(injected.solana?.isPhantom ? "Phantom" : "Solana wallet", "Solana");
  if (injected.keplr) add("Keplr", "Cosmos");

  return [...found.values()];
}

function shortAddress(address: string) {
  if (address.length < 18) return address;
  return `${address.slice(0, 10)}…${address.slice(-6)}`;
}

/**
 * Both messages mean "wrong network, not wrong you": the request was well formed
 * and the wallet already authorised this origin, it simply is not on the network
 * we asked for. The wallet never names the network it *is* on.
 */
function isWrongNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /network id mismatch/i.test(message) || /unsupported network id/i.test(message);
}

/**
 * Thrown when the wallet never answers. Lace opens its approval window outside
 * the page, so an unanswered prompt looks identical to a dead extension from
 * here: the promise simply never settles, and without this the UI sits on a
 * disabled button forever (PRD §11 requires a recoverable state instead).
 */
export class WalletUnresponsiveError extends Error {
  constructor(walletName: string, waitedMs: number) {
    super(`${walletName} did not respond within ${Math.round(waitedMs / 1000)}s. Check for an approval window, and that the wallet is unlocked.`);
    this.name = "WalletUnresponsiveError";
  }
}

/** How long before we suggest the user goes looking for the wallet's window. */
export const WALLET_SLOW_AFTER_MS = 8_000;
/** Approving takes human time, so the ceiling is generous — but finite. */
export const WALLET_TIMEOUT_MS = 120_000;

/**
 * Wraps a wallet call so a silent wallet becomes a message rather than a
 * spinner. `onSlow` fires once, while the call is still in flight.
 */
export async function awaitWalletResponse<T>(
  call: Promise<T>,
  { walletName, onSlow, slowAfterMs = WALLET_SLOW_AFTER_MS, timeoutMs = WALLET_TIMEOUT_MS }:
    { walletName: string; onSlow?: () => void; slowAfterMs?: number; timeoutMs?: number },
): Promise<T> {
  let slowTimer: ReturnType<typeof setTimeout> | undefined;
  let hardTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      call,
      new Promise<never>((_, reject) => {
        if (onSlow) slowTimer = setTimeout(onSlow, slowAfterMs);
        hardTimer = setTimeout(() => reject(new WalletUnresponsiveError(walletName, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(slowTimer);
    clearTimeout(hardTimer);
  }
}

/** Thrown when the wallet refuses the network ProofPass asked for. */
export class WalletNetworkMismatchError extends Error {
  readonly requested: MidnightNetwork;
  constructor(requested: MidnightNetwork, reason: string) {
    super(reason);
    this.name = "WalletNetworkMismatchError";
    this.requested = requested;
  }
}

async function openConnection(wallet: DetectedWallet, network: MidnightNetwork) {
  const connected = await wallet.connect(network);
  const status = connected.getConnectionStatus ? await connected.getConnectionStatus() : undefined;
  if (status?.networkId && status.networkId !== network) {
    throw new Error(`Wallet connected to ${status.networkId}, expected ${network}.`);
  }
  return connected;
}

async function buildSession(wallet: DetectedWallet, connected: MidnightConnectedApi, network: MidnightNetwork): Promise<MidnightWalletSession> {
  const [configuration, unshieldedAddress, shieldedAddresses, dustBalance] = await Promise.all([
    connected.getConfiguration?.(),
    connected.getUnshieldedAddress?.().catch(() => undefined),
    connected.getShieldedAddresses?.().catch(() => undefined),
    connected.getDustBalance?.().catch(() => undefined),
  ]);

  const address = unshieldedAddress?.unshieldedAddress ?? shieldedAddresses?.shieldedAddress ?? "Connected wallet";
  return { wallet, connected, network, address: shortAddress(address), rawAddress: address, dustBalance: dustBalance?.toString(), configuration };
}

/**
 * Connect on exactly the network asked for. ARCHITECTURE §18: "A wallet
 * connection to an unexpected network is rejected by the adapter" — so a
 * mismatch surfaces as an error here and is never quietly resolved by
 * connecting somewhere else.
 */
export async function connectMidnightWallet(wallet: DetectedWallet, network: MidnightNetwork): Promise<MidnightWalletSession> {
  let connected: MidnightConnectedApi;
  try {
    connected = await openConnection(wallet, network);
  } catch (error) {
    if (isWrongNetworkError(error)) {
      throw new WalletNetworkMismatchError(network, error instanceof Error ? error.message : String(error));
    }
    throw error;
  }
  return buildSession(wallet, connected, network);
}

/**
 * Ask each remaining network in turn until one answers. This is a separate,
 * explicitly user-initiated call — the wallet will not say which network it is
 * on, and the alternative is making someone guess through four buttons — so the
 * network it lands on is one the user asked to find, not one silently accepted.
 */
export async function discoverWalletNetwork(wallet: DetectedWallet, tried: MidnightNetwork): Promise<MidnightWalletSession> {
  let firstFailure: unknown;
  for (const candidate of MIDNIGHT_NETWORKS.filter((option) => option !== tried)) {
    try {
      const connected = await openConnection(wallet, candidate);
      return buildSession(wallet, connected, candidate);
    } catch (error) {
      if (firstFailure === undefined) firstFailure = error;
      // A declined popup or a locked wallet is the same answer on every network.
      if (!isWrongNetworkError(error)) throw error;
    }
  }
  throw firstFailure instanceof Error ? firstFailure : new Error(String(firstFailure));
}

export async function balanceAndSubmitUnsealedTransaction(connected: MidnightConnectedApi, unsealedTransaction: string) {
  if (!connected.balanceUnsealedTransaction || !connected.submitTransaction) {
    throw new Error("This wallet does not expose the transaction methods required by ProofPass.");
  }
  const balanced = await connected.balanceUnsealedTransaction(unsealedTransaction, { payFees: true });
  return connected.submitTransaction(balanced.tx);
}

/** Lace Midnight Preview — the wallet that implements the Midnight DApp Connector API. */
export function getWalletInstallUrl() {
  return "https://chromewebstore.google.com/detail/lace-midnight-preview/hgeekaiplokcnmakghbdfbgnlfheichg";
}
