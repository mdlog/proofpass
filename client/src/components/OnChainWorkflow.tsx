import { BadgeCheck, Blocks, KeyRound, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { lastDeployedContract } from "../lib/deployedContract";
import { describeError, readableMessage } from "../lib/describeError";
import { bytesToHex } from "../lib/hex";
import { buildMidnightProviders, resolveProofServerUri } from "../lib/midnightProviders";
import { isMidnightNetwork, type MidnightNetwork, type MidnightWalletSession } from "../lib/midnightWallet";
import {
  availableSteps, callsOf, connectProofPass, credentialCommitmentFor, deriveIssuerId, expirySecondsFromNow,
  dustBlocker, fetchLedgerSnapshot, freshNonce, lastCredentialDraft, ledgerReadBlocker, rememberCredentialDraft, resolveHolderSecret, walletEndpoints,
  type ContractRole, type CredentialDraft, type LedgerSnapshot, type WorkflowStep,
} from "../lib/proofpassContract";
import { readDustBalance, resolveAuthoritySecret } from "../lib/proofpassDeploy";

/**
 * The issuer → holder → verifier workflow, run against the deployed contract.
 *
 * Every step reports what the ledger says afterwards, because a transaction that
 * succeeds is not by itself evidence that state changed. The steps the chain
 * cannot accept are disabled with the contract's own reason — that only saves
 * DUST, the contract's assert remains the authority.
 *
 * Deliberately separate from the issuer and verifier workspaces, which run on
 * stored rows and seeded data: nothing here is a demo.
 */

type Providers = Awaited<ReturnType<typeof buildMidnightProviders>>;

const STEPS: { id: WorkflowStep; label: string; role: ContractRole; hint: string }[] = [
  { id: "register", label: "Register issuer", role: "authority", hint: "Authority publishes the issuer id" },
  { id: "issue", label: "Issue credential", role: "authority", hint: "Authority publishes the holder's commitment" },
  { id: "prove", label: "Prove eligibility", role: "holder", hint: "Holder proves knowledge of the secret" },
  { id: "revoke", label: "Revoke credential", role: "authority", hint: "Authority retires the commitment, one way" },
];

const short = (hex: string) => hex.length > 20 ? `${hex.slice(0, 10)}…${hex.slice(-6)}` : hex;

export type RegistryIssuer = { id: number; slug: string; displayName: string };

export type IssuedCredential = {
  issuerId: number;
  credentialKey: string;
  title: string;
  subjectCommitment: string;
  contractAddress: string;
  networkId: MidnightNetwork;
  expiresAt: Date;
};

export function OnChainWorkflow({ walletSession, onConnect, issuers, onCredentialIssued, onCredentialRevoked }: {
  walletSession: MidnightWalletSession | null;
  onConnect: () => void;
  issuers: RegistryIssuer[];
  onCredentialIssued: (credential: IssuedCredential) => Promise<void>;
  onCredentialRevoked: (credentialKey: string) => Promise<void>;
}) {
  const [address, setAddress] = useState(() => lastDeployedContract()?.contractAddress ?? "");
  const [draft, setDraft] = useState<CredentialDraft>(() => lastCredentialDraft() ?? { slug: "northstar-academy", expiresAt: expirySecondsFromNow(3600), title: "Bootcamp completion" });
  const [identity, setIdentity] = useState<{ issuerId: Uint8Array; commitment: Uint8Array } | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<LedgerSnapshot | null>(null);
  const [dust, setDust] = useState<{ balance: bigint; cap: bigint; registered: boolean } | null>(null);
  const [busy, setBusy] = useState<WorkflowStep | "read" | null>(null);
  const providersRef = useRef<Providers | null>(null);

  // The commitment is what every later step is measured against, so it is
  // derived from the draft rather than recomputed at each click.
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const issuerId = await deriveIssuerId(draft.slug);
        const commitment = credentialCommitmentFor(issuerId, draft.expiresAt, resolveHolderSecret().secret);
        if (current) { setIdentity({ issuerId, commitment }); setIdentityError(null); }
      } catch (error) {
        if (current) { setIdentity(null); setIdentityError(readableMessage(error, "The compiled artifact could not be read.")); }
      }
    })();
    return () => { current = false; };
  }, [draft]);

  /** A new credential: a fresh expiry, which is a fresh commitment. */
  const startDraft = (slug: string, title = draft.title) => {
    const next = { slug, title, expiresAt: expirySecondsFromNow(3600) };
    rememberCredentialDraft(next);
    setDraft(next);
  };

  /** The same slug the on-chain id is derived from, as a row in the registry. */
  const registryIssuer = issuers.find((issuer) => issuer.slug === draft.slug);

  const ensureProviders = useCallback(async () => {
    if (!walletSession) throw new Error("Connect a Midnight wallet first.");
    providersRef.current ??= await buildMidnightProviders(walletSession.connected as never);
    return providersRef.current;
  }, [walletSession]);

  const readLedger = async (providers?: Providers) => {
    setBusy("read");
    try {
      const resolved = providers ?? await ensureProviders();
      const [next, balance] = await Promise.all([
        fetchLedgerSnapshot(resolved as never, address.trim()),
        readDustBalance(walletSession!.connected as never).catch(() => null),
      ]);
      setSnapshot(next);
      setDust(balance);
      if (!next) toast.error("No contract at that address", { description: "The indexer has never seen it on this network." });
    } catch (error) {
      toast.error("Could not read the ledger", { description: readableMessage(error, "The indexer did not answer.") });
    } finally {
      setBusy(null);
    }
  };

  /**
   * The registry half. It is deliberately not allowed to fail the step: the
   * commitment is already on the ledger by the time this runs, and reporting the
   * transaction as failed because a row did not save would be a lie.
   */
  const recordIssued = async (commitment: string) => {
    if (!registryIssuer) {
      toast("Credential not recorded", { description: `No registry issuer with the slug "${draft.slug}" — sign in and register one to keep credentials.` });
      return;
    }
    // The row names the network the commitment lives on; a wallet reporting one
    // this build does not know is not something to guess about.
    const network = walletSession?.configuration?.networkId;
    if (!network || !isMidnightNetwork(network)) {
      toast("Credential not recorded", { description: `The wallet reports network "${network ?? "none"}", which this build does not recognise.` });
      return;
    }
    try {
      await onCredentialIssued({
        issuerId: registryIssuer.id,
        credentialKey: commitment,
        title: draft.title.trim() || "Credential",
        subjectCommitment: commitment,
        contractAddress: address.trim(),
        networkId: network,
        expiresAt: new Date(Number(draft.expiresAt) * 1000),
      });
      toast.success("Credential recorded", { description: `${draft.title.trim() || "Credential"} is now in your registry.` });
    } catch (error) {
      toast.error("Credential not recorded", { description: readableMessage(error, "The registry write failed; the commitment is on chain regardless.") });
    }
  };

  const recordRevoked = async (commitment: string) => {
    if (!registryIssuer) return;
    try {
      await onCredentialRevoked(commitment);
    } catch (error) {
      toast.error("Registry still shows the credential", { description: readableMessage(error, "The ledger revoked it; the row did not follow.") });
    }
  };

  const runStep = async (step: WorkflowStep) => {
    if (!identity) return;
    const { role } = STEPS.find((entry) => entry.id === step)!;
    setBusy(step);
    try {
      const providers = await ensureProviders();
      // Proving takes real time; there is no point spending it on a transaction
      // the wallet already cannot pay for.
      const balance = await readDustBalance(walletSession!.connected as never);
      setDust(balance);
      const unpayable = dustBlocker(balance);
      if (unpayable) throw new Error(unpayable);
      const secret = role === "holder" ? resolveHolderSecret().secret : resolveAuthoritySecret().secret;
      const calls = callsOf(await connectProofPass(providers, address.trim(), role, secret));
      if (step === "register") await calls.registerIssuer(identity.issuerId);
      if (step === "issue") {
        await calls.issueCredential(identity.issuerId, identity.commitment);
        await recordIssued(bytesToHex(identity.commitment));
      }
      if (step === "prove") await calls.proveEligibility(identity.issuerId, draft.expiresAt, freshNonce());
      if (step === "revoke") {
        await calls.revokeCredential(identity.commitment);
        await recordRevoked(bytesToHex(identity.commitment));
      }
      toast.success(`${STEPS.find((entry) => entry.id === step)!.label} accepted`, { description: "Reading the ledger back…" });
      await readLedger(providers);
    } catch (error) {
      // The contract's asserts say exactly what is wrong; nothing here says it better.
      const described = describeError(error);
      toast.error(`${STEPS.find((entry) => entry.id === step)!.label} failed`, { description: readableMessage(error, "The wallet did not complete the transaction.") });
      // A toast is gone in seconds and proving fails inside the wallet, where
      // the cause chain is the only place the real reason survives. Keep the
      // last one where a reload cannot take it.
      console.error(`[ProofPass] ${step} failed`, error, described);
      try {
        localStorage.setItem("proofpass:last-step-error", JSON.stringify({ step, at: new Date().toISOString(), described }));
      } catch { /* storage unavailable; the console still has it */ }
      setBusy(null);
    }
  };

  const blocker = ledgerReadBlocker(Boolean(walletSession), address);
  const steps = snapshot && identity
    ? availableSteps(snapshot, { issuerId: bytesToHex(identity.issuerId), commitment: bytesToHex(identity.commitment), expiresAt: draft.expiresAt })
    : null;
  const expiry = new Date(Number(draft.expiresAt) * 1000);

  return <div className="page-content role-page">
    <div className="section-heading">
      <div>
        <p className="eyebrow">On-chain workflow</p>
        <h1>Run it against the real contract</h1>
        <p className="section-description">Every step is a transaction the wallet signs, and every result is read back from the ledger. Nothing on this page is demo data.</p>
      </div>
      <button className={`connector-state ${walletSession ? "connector-live" : ""}`} onClick={walletSession ? undefined : onConnect}>{walletSession ? "Wallet ready" : "Connect wallet"}</button>
    </div>

    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">Deployed contract</p><h2>Contract under test</h2></div><Blocks size={19} className="muted-icon" /></div>
      <label className="request-field"><span>Contract address</span><input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="0200…" spellCheck={false} /></label>
      <label className="request-field"><span>Issuer slug — the on-chain id is its digest</span><input value={draft.slug} onChange={(event) => startDraft(event.target.value)} spellCheck={false} list="registry-issuer-slugs" /><datalist id="registry-issuer-slugs">{issuers.map((issuer) => <option key={issuer.id} value={issuer.slug}>{issuer.displayName}</option>)}</datalist><small>{registryIssuer ? `Registry: ${registryIssuer.displayName} — credentials will be recorded against it.` : "Registry: no issuer with this slug. The workflow still runs; the credential is not recorded."}</small></label><label className="request-field"><span>Credential title — metadata, never on the ledger</span><input value={draft.title} onChange={(event) => { const next = { ...draft, title: event.target.value }; rememberCredentialDraft(next); setDraft(next); }} spellCheck={false} /></label>
      <div className="role-control-list">
        <div><span>Issuer id</span><strong>{identity ? short(bytesToHex(identity.issuerId)) : "—"}</strong></div>
        <div><span>Commitment</span><strong>{identity ? short(bytesToHex(identity.commitment)) : "—"}</strong></div>
        <div><span>Expires</span><strong>{expiry.toISOString().replace("T", " ").slice(0, 19)}Z</strong></div>
      </div>
      {identityError && <p className="modal-note"><XCircle size={14} /> {identityError}</p>}
      {blocker && <p className="modal-note"><XCircle size={14} /> {blocker}{!walletSession && <> <button className="text-button" onClick={onConnect}>Connect wallet</button></>}</p>}
      <div className="modal-actions">
        <button className="button button-ghost" onClick={() => startDraft(draft.slug)} disabled={busy !== null}><KeyRound size={15} /> Start a new credential</button>
        <button className="button button-light" onClick={() => void readLedger()} disabled={busy !== null || blocker !== null}><RefreshCw size={15} /> {busy === "read" ? "Reading…" : "Read ledger"}</button>
      </div>
      <p className="modal-note">A revoked commitment can never be reissued, so running the workflow again needs a new credential.</p>
    </section>

    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">Wallet endpoints</p><h2>Where this proves and reads</h2></div><ShieldCheck size={19} className="muted-icon" /></div>
      <div className="role-control-list">{walletEndpoints(walletSession?.configuration, resolveProofServerUri()).map((entry) => <div key={entry.label}><span>{entry.label}</span><strong>{entry.value}</strong></div>)}</div>
      <div className="role-control-list">
        <div><span>DUST balance</span><strong>{dust ? `${dust.balance} of ${dust.cap}` : "read the ledger to load"}</strong></div>
      </div>
      {dust && dustBlocker(dust) && <p className="modal-note"><XCircle size={14} /> {dustBlocker(dust)}</p>}
      <p className="modal-note">Proving runs inside the wallet against its own prover — a step that fails with "Failed to fetch" failed to reach one of these.</p>
    </section>

    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">Ledger state</p><h2>What the chain says</h2></div><ShieldCheck size={19} className="muted-icon" /></div>
      {snapshot
        ? <div className="role-control-list">
            <div><span>Registered issuers</span><strong>{snapshot.issuers.length}</strong></div>
            <div><span>This issuer</span><strong>{snapshot.issuers.find((entry) => identity && entry.id === bytesToHex(identity.issuerId))?.status ?? "UNREGISTERED"}</strong></div>
            <div><span>Credentials in the vault</span><strong>{snapshot.credentials.length}</strong></div>
            <div><span>Revoked credentials</span><strong>{snapshot.revokedCredentials.length}</strong></div>
            <div><span>Accepted proofs</span><strong>{snapshot.acceptedProofs.toString()}</strong></div>
            <div><span>Spent nonces</span><strong>{snapshot.spentNonces}</strong></div>
          </div>
        : <p className="modal-note">Read the ledger to see the contract's current state.</p>}
    </section>

    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">Workflow</p><h2>Four steps, in order</h2></div><BadgeCheck size={19} className="muted-icon" /></div>
      {STEPS.map((step) => {
        const availability = steps?.[step.id];
        return <div className="role-event" key={step.id}>
          <div className={`activity-icon ${availability?.ready ? "activity-approved" : "activity-revoked"}`}>{availability?.ready ? <BadgeCheck size={15} /> : <XCircle size={15} />}</div>
          <div><strong>{step.label}</strong><p>{availability?.reason ?? step.hint} · {step.role} key</p></div>
          <button className="button button-primary" onClick={() => void runStep(step.id)} disabled={busy !== null || !availability?.ready}>{busy === step.id ? "Submitting…" : "Run"}</button>
        </div>;
      })}
      {!snapshot && <p className="modal-note">{blocker ?? "Press Read ledger — the chain decides which steps are possible, not this panel."}</p>}
      <p className="modal-note">The contract's fifth circuit, <code>revokeIssuer</code>, is off this path: it would stop the issuer from issuing anything further.</p>
    </section>
  </div>;
}
