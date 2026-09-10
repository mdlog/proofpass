import { BadgeCheck, Building2, KeyRound, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { lastDeployedContract } from "../lib/deployedContract";
import { describeError, readableMessage } from "../lib/describeError";
import { bytesToHex } from "../lib/hex";
import { buildMidnightProviders, resolveProofServerUri } from "../lib/midnightProviders";
import { isMidnightNetwork, type MidnightNetwork, type MidnightWalletSession } from "../lib/midnightWallet";
import {
  availableSteps, callsOf, connectProofPass, credentialCommitmentFor, deriveIssuerId, expirySecondsFromNow,
  dustBlocker, fetchLedgerSnapshot, freshNonce, issuerDisplayName, parseHex32, lastCredentialDraft, ledgerReadBlocker, rememberCredentialDraft, resolveHolderSecret, walletEndpoints,
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

export function OnChainWorkflow({ walletSession, onConnect, issuers, onCredentialIssued, onCredentialRevoked, onRegisterIssuer, canRegisterIssuer }: {
  walletSession: MidnightWalletSession | null;
  onConnect: () => void;
  issuers: RegistryIssuer[];
  onCredentialIssued: (credential: IssuedCredential) => Promise<void>;
  onCredentialRevoked: (credentialKey: string) => Promise<void>;
  /** Registers this slug in the registry, so the row and the on-chain id agree. */
  onRegisterIssuer: (slug: string, networkId: MidnightNetwork) => Promise<void>;
  canRegisterIssuer: boolean;
}) {
  const [address, setAddress] = useState(() => lastDeployedContract()?.contractAddress ?? "");
  const [draft, setDraft] = useState<CredentialDraft>(() => lastCredentialDraft() ?? { slug: "northstar-academy", expiresAt: expirySecondsFromNow(3600), title: "Bootcamp completion" });
  const [identity, setIdentity] = useState<{ issuerId: Uint8Array; commitment: Uint8Array } | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<LedgerSnapshot | null>(null);
  const [dust, setDust] = useState<{ balance: bigint; cap: bigint; registered: boolean } | null>(null);
  const [busy, setBusy] = useState<WorkflowStep | "read" | null>(null);
  // The two values that cross between parties. Both are public; neither can be
  // turned back into the secret behind it.
  const [externalCommitment, setExternalCommitment] = useState("");
  const [challenge, setChallenge] = useState("");
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
  /**
   * Registers the slug the on-chain id is derived from, on the network the
   * wallet is actually on. Issuer registration elsewhere invents a slug suffix,
   * which makes a row that can never match a ledger entry.
   */
  const copyValue = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`, { description: "Hand it to the other party — it discloses nothing on its own." });
    } catch {
      // A blocked clipboard should still let the value be read and selected.
      toast(`${label}`, { description: value });
    }
  };

  const registerIssuerRow = async () => {
    const network = walletSession?.configuration?.networkId;
    if (!network || !isMidnightNetwork(network)) {
      toast.error("Cannot register", { description: `The wallet reports network "${network ?? "none"}", which this build does not recognise.` });
      return;
    }
    try {
      await onRegisterIssuer(draft.slug, network);
      toast.success("Issuer registered", { description: `${issuerDisplayName(draft.slug)} on ${network} — credentials will be recorded against it.` });
    } catch (error) {
      toast.error("Issuer not registered", { description: readableMessage(error, "The registry write failed.") });
    }
  };

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
      const network = walletSession?.configuration?.networkId ?? "preprod";
      const calls = callsOf(await connectProofPass(providers, { contractAddress: address.trim(), role, secret, networkId: network }));
      if (step === "register") await calls.registerIssuer(identity.issuerId);
      if (step === "issue") {
        if (!issuedCommitment) throw new Error("No commitment to issue.");
        await calls.issueCredential(identity.issuerId, issuedCommitment);
        await recordIssued(bytesToHex(issuedCommitment));
      }
      // The verifier's challenge when they gave one; otherwise our own, which
       // proves a credential is valid but binds the proof to nobody's request.
      if (step === "prove") await calls.proveEligibility(identity.issuerId, draft.expiresAt, pastedChallenge ?? freshNonce());
      if (step === "revoke") {
        if (!issuedCommitment) throw new Error("No commitment to revoke.");
        await calls.revokeCredential(issuedCommitment);
        await recordRevoked(bytesToHex(issuedCommitment));
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

  /**
   * What the issuer publishes: a holder's commitment when one has been handed
   * over, otherwise this browser's own — which is what makes the single-browser
   * walkthrough still work.
   */
  const pastedCommitment = parseHex32(externalCommitment);
  const issuedCommitment = pastedCommitment ?? identity?.commitment ?? null;
  const pastedChallenge = parseHex32(challenge);
  const commitmentInvalid = externalCommitment.trim().length > 0 && !pastedCommitment;
  const challengeInvalid = challenge.trim().length > 0 && !pastedChallenge;
  // Two views of the same ledger. The issuer's steps concern the commitment
  // being published; proving concerns this browser's own, because the contract
  // recomputes it from the secret held here and nowhere else.
  const issuerSteps = snapshot && identity && issuedCommitment
    ? availableSteps(snapshot, { issuerId: bytesToHex(identity.issuerId), commitment: bytesToHex(issuedCommitment), expiresAt: draft.expiresAt })
    : null;
  const holderSteps = snapshot && identity
    ? availableSteps(snapshot, { issuerId: bytesToHex(identity.issuerId), commitment: bytesToHex(identity.commitment), expiresAt: draft.expiresAt })
    : null;
  const stepAvailability = (step: WorkflowStep) => (step === "prove" ? holderSteps : issuerSteps)?.[step];
  const expiry = new Date(Number(draft.expiresAt) * 1000);

  const stepButton = (step: WorkflowStep, label: string, hint: string) => {
    const availability = stepAvailability(step);
    const ready = Boolean(availability?.ready);
    return <div className="step-action" key={step}>
      <span className={`activity-icon ${ready ? "activity-approved" : "activity-revoked"}`}>{ready ? <BadgeCheck size={14} /> : <XCircle size={14} />}</span>
      <span className="step-action-copy"><strong>{label}</strong><small>{availability?.reason ?? hint}</small></span>
      <button className="button button-primary" onClick={() => void runStep(step)} disabled={busy !== null || !ready}>{busy === step ? "…" : "Run"}</button>
    </div>;
  };

  const thisIssuer = snapshot && identity
    ? snapshot.issuers.find((entry) => entry.id === bytesToHex(identity.issuerId))?.status ?? "UNREGISTERED"
    : "—";
  const challengeHex = challenge.trim().replace(/^0x/i, "").toLowerCase();
  const challengeSpent = Boolean(snapshot && pastedChallenge && snapshot.spentNonces.includes(challengeHex));

  return <div className="page-content role-page">
    <div className="section-heading">
      <div>
        <p className="eyebrow">On-chain workflow</p>
        <h1>Run it against the real contract</h1>
        <p className="section-description">Three parties, one contract. Only a commitment and a challenge ever cross between them — both public, neither reversible into the secret behind it.</p>
      </div>
      <button className={`connector-state ${walletSession ? "connector-live" : ""}`} onClick={walletSession ? undefined : onConnect}>{walletSession ? "Wallet ready" : "Connect wallet"}</button>
    </div>

    <section className="panel contract-strip">
      <div className="contract-strip-top">
        <label className="request-field contract-address"><span>Contract</span>
          <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="0200…" spellCheck={false} />
        </label>
        <button className="button button-light" onClick={() => void readLedger()} disabled={busy !== null || blocker !== null}><RefreshCw size={15} /> {busy === "read" ? "Reading…" : "Read ledger"}</button>
      </div>
      {blocker
        ? <p className="modal-note"><XCircle size={14} /> {blocker}{!walletSession && <> <button className="text-button" onClick={onConnect}>Connect wallet</button></>}</p>
        : <div className="evidence-strip">
            <div><span>This issuer</span><strong>{thisIssuer}</strong></div>
            <div><span>Credentials</span><strong>{snapshot ? snapshot.credentials.length : "—"}</strong></div>
            <div><span>Revoked</span><strong>{snapshot ? snapshot.revokedCredentials.length : "—"}</strong></div>
            <div><span>Proofs accepted</span><strong>{snapshot ? snapshot.acceptedProofs.toString() : "—"}</strong></div>
            <div><span>Challenges spent</span><strong>{snapshot ? snapshot.spentNonces.length : "—"}</strong></div>
          </div>}
    </section>

    <div className="role-columns">
      <section className="panel role-column">
        <div className="panel-heading"><div><p className="eyebrow">Issuer · authority key</p><h2>Publishes the registry</h2></div><Building2 size={19} className="muted-icon" /></div>
        <label className="request-field"><span>Issuer slug</span>
          <input value={draft.slug} onChange={(event) => startDraft(event.target.value)} spellCheck={false} list="registry-issuer-slugs" />
          <datalist id="registry-issuer-slugs">{issuers.map((issuer) => <option key={issuer.id} value={issuer.slug}>{issuer.displayName}</option>)}</datalist>
          <small>{registryIssuer ? `Recorded against ${registryIssuer.displayName}.` : canRegisterIssuer ? "No registry row for this slug." : "Credentials will not be recorded without a session."}</small>
        </label>
        {!registryIssuer && canRegisterIssuer && <button className="text-button" onClick={() => void registerIssuerRow()} disabled={busy !== null}>Register &ldquo;{issuerDisplayName(draft.slug)}&rdquo; in the registry</button>}
        <label className="request-field"><span>Credential title</span>
          <input value={draft.title} onChange={(event) => { const next = { ...draft, title: event.target.value }; rememberCredentialDraft(next); setDraft(next); }} spellCheck={false} />
        </label>
        <label className="request-field"><span>Holder&apos;s commitment</span>
          <input value={externalCommitment} onChange={(event) => setExternalCommitment(event.target.value)} placeholder="paste, or leave empty for your own" spellCheck={false} />
          <small>{commitmentInvalid ? "Not 32 bytes of hex." : pastedCommitment ? "Issue and Revoke act on this." : "Empty: acts on this browser&apos;s own commitment."}</small>
        </label>
        <div className="step-list">
          {stepButton("register", "Register issuer", "Publishes the issuer id")}
          {stepButton("issue", "Issue credential", "Publishes the commitment")}
          {stepButton("revoke", "Revoke credential", "Retires it, one way")}
        </div>
      </section>

      <section className="panel role-column">
        <div className="panel-heading"><div><p className="eyebrow">Holder · holder key</p><h2>Proves without showing</h2></div><KeyRound size={19} className="muted-icon" /></div>
        <div className="role-control-list role-control-stack">
          <div><span>My commitment</span><strong>{identity ? short(bytesToHex(identity.commitment)) : "—"}</strong></div>
          <div><span>Valid until</span><strong>{expiry.toISOString().replace("T", " ").slice(0, 16)}Z</strong></div>
        </div>
        <div className="modal-actions">
          <button className="button button-ghost" disabled={!identity} onClick={() => identity && void copyValue("Commitment", bytesToHex(identity.commitment))}>Copy commitment</button>
          <button className="button button-ghost" onClick={() => startDraft(draft.slug)} disabled={busy !== null}>New credential</button>
        </div>
        <label className="request-field"><span>Challenge to prove with</span>
          <input value={challenge} onChange={(event) => setChallenge(event.target.value)} placeholder="paste the verifier&apos;s challenge" spellCheck={false} />
          <small>{challengeInvalid ? "Not 32 bytes of hex." : pastedChallenge ? "The proof will be bound to this challenge." : "Empty: a fresh nonce, bound to nobody&apos;s request."}</small>
        </label>
        <div className="step-list">
          {stepButton("prove", "Prove eligibility", "Proves knowledge of the secret")}
        </div>
        {identityError && <p className="modal-note"><XCircle size={14} /> {identityError}</p>}
      </section>

      <section className="panel role-column">
        <div className="panel-heading"><div><p className="eyebrow">Verifier</p><h2>Checks the chain</h2></div><ShieldCheck size={19} className="muted-icon" /></div>
        <div className="role-control-list role-control-stack">
          <div><span>Challenge</span><strong>{pastedChallenge ? short(challengeHex) : "none yet"}</strong></div>
          <div><span>On chain</span><strong>{!pastedChallenge ? "—" : !snapshot ? "read the ledger" : challengeSpent ? "used" : "not used yet"}</strong></div>
        </div>
        <div className="modal-actions">
          <button className="button button-ghost" onClick={() => { const next = bytesToHex(freshNonce()); setChallenge(next); void copyValue("Challenge", next); }}>New challenge</button>
        </div>
        <p className="modal-note">{challengeSpent
          ? "A holder proved for this exact challenge. Nothing here was taken on trust — the ledger says so."
          : "Give the challenge to the holder, then read the ledger again. A used challenge is the proof that it was answered for you."}</p>
      </section>
    </div>

    <details className="panel diagnostics">
      <summary>Diagnostics &mdash; fees, endpoints, and the fifth circuit</summary>
      <div className="role-control-list">
        <div><span>DUST balance</span><strong>{dust ? `${dust.balance} of ${dust.cap}` : "read the ledger"}</strong></div>
        {walletEndpoints(walletSession?.configuration, resolveProofServerUri()).map((entry) => <div key={entry.label}><span>{entry.label}</span><strong>{entry.value}</strong></div>)}
      </div>
      {dust && dustBlocker(dust) && <p className="modal-note"><XCircle size={14} /> {dustBlocker(dust)}</p>}
      <p className="modal-note">Proving runs against the prover above; a step that fails with &ldquo;Failed to fetch&rdquo; failed to reach one of these. The contract&apos;s fifth circuit, <code>revokeIssuer</code>, is off this path: it would stop the issuer issuing anything further.</p>
    </details>
  </div>;
}
