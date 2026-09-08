import { Check, QrCode, X } from "lucide-react";
import { useState } from "react";
import { REQUESTABLE_FACTS, type NewRequestInput } from "../lib/types";

export function CreateRequestModal({ onClose, onSubmit, isSaving }: { onClose: () => void; onSubmit: (input: NewRequestInput) => void; isSaving: boolean }) {
  const [verifierName, setVerifierName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [facts, setFacts] = useState<string[]>(["completion_status"]);
  const [extras, setExtras] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(7);

  const toggleFact = (id: string) => setFacts((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);

  // The documented facts come first so a policy built from the presets stores
  // exactly the identifiers ARCHITECTURE §10 specifies.
  const requestedAttributes = [...facts, ...extras.split(",").map((entry) => entry.trim()).filter(Boolean)];

  // Mirrors the zod contract on proofRequests.create, so a rejected mutation is
  // never the first time the operator hears about a field they got wrong.
  const problem = verifierName.trim().length < 2 ? "Verifier needs at least 2 characters."
    : purpose.trim().length < 2 ? "Add a purpose so the holder knows what they are approving."
    : requestedAttributes.length === 0 ? "Select at least one fact to request."
    : requestedAttributes.length > 20 ? "A request can ask for at most 20 facts."
    : requestedAttributes.some((entry) => entry.length > 120) ? "Each fact must stay under 120 characters."
    : null;

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSaving) onClose(); }}><div className="wallet-picker-modal" role="dialog" aria-modal="true" aria-labelledby="create-request-title"><div className="modal-header"><div className="wallet-picker-heading"><span className="wallet-picker-icon"><QrCode size={18} /></span><div><p className="eyebrow">Verifier workspace</p><h2 id="create-request-title">New proof request</h2></div></div><button className="icon-button" onClick={onClose} disabled={isSaving} aria-label="Close create request"><X size={18} /></button></div><p className="wallet-picker-lede">The holder sees the purpose and the exact facts before anything is shared.</p><div className="request-form"><label className="request-field"><span>Verifier</span><input value={verifierName} onChange={(event) => setVerifierName(event.target.value)} placeholder="Northstar Academy" maxLength={180} disabled={isSaving} autoFocus /></label><label className="request-field"><span>Purpose</span><textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Confirm bootcamp completion" rows={2} maxLength={1000} disabled={isSaving} /></label><div className="request-field"><span>Facts requested</span><div className="fact-options" role="group" aria-label="Facts requested">{REQUESTABLE_FACTS.map((fact) => <button key={fact.id} type="button" className={`network-chip ${facts.includes(fact.id) ? "network-chip-active" : ""}`} onClick={() => toggleFact(fact.id)} disabled={isSaving} aria-pressed={facts.includes(fact.id)} title={fact.hint}>{fact.label}</button>)}</div><input value={extras} onChange={(event) => setExtras(event.target.value)} placeholder="Other facts, separated by commas" disabled={isSaving} /><small>{requestedAttributes.length} requested · minimum disclosure keeps this list short</small></div><label className="request-field"><span>Expires in</span><select value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))} disabled={isSaving}>{[1, 2, 5, 7, 14, 30].map((days) => <option key={days} value={days}>{days} day{days === 1 ? "" : "s"}</option>)}</select></label></div>{problem && <p className="request-form-problem">{problem}</p>}<div className="request-form-actions"><button className="button button-light" onClick={onClose} disabled={isSaving}>Cancel</button><button className="button button-primary" disabled={Boolean(problem) || isSaving} onClick={() => onSubmit({ verifierName: verifierName.trim(), purpose: purpose.trim(), requestedAttributes, expiresInDays })}>{isSaving ? "Creating…" : <>Create request <Check size={15} /></>}</button></div></div></div>;
}
