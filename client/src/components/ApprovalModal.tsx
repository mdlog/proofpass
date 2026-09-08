import { Check, CheckCircle2, Clock3, LockKeyhole, ShieldCheck, X, XCircle } from "lucide-react";
import { useState } from "react";
import { attributeLabel, type ProofRequestView } from "../lib/types";

/**
 * PRD §7.1 and §7.2 in one dialog. Approving discloses exactly the facts the
 * request names; declining asks for an optional reason and then confirms, so a
 * refusal is never one stray click away.
 */
export function ApprovalModal({ request, onClose, onApprove, onDecline, isBusy }: { request: ProofRequestView; onClose: () => void; onApprove: (selectedAttributes: string[]) => void; onDecline: (reason: string) => void; isBusy: boolean }) {
  const [decliningNow, setDecliningNow] = useState(false);
  const [reason, setReason] = useState("");

  const close = () => { if (!isBusy) onClose(); };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><div className="approval-modal" role="dialog" aria-modal="true" aria-labelledby="approval-title"><div className="modal-header"><div className="request-logo request-logo-large">{request.logo}</div><button className="icon-button" onClick={close} disabled={isBusy} aria-label="Close approval dialog"><X size={18} /></button></div><p className="eyebrow">Proof request · {request.id}</p><h2 id="approval-title">{request.purpose}</h2><p className="modal-lede"><strong>{request.verifier}</strong> is asking you to prove the following facts. Nothing is shared until you approve.</p><div className="share-section"><div className="share-heading"><span className="share-icon share-icon-teal"><CheckCircle2 size={15} /></span><div><strong>You will share</strong><span>Only the attributes needed for this request.</span></div></div><div className="attribute-list">{request.attributes.map((attribute) => <div className="attribute-row" key={attribute}><Check size={14} />{attributeLabel(attribute)}<span className="attribute-private">private proof</span></div>)}</div></div><div className="share-section share-private"><div className="share-heading"><span className="share-icon share-icon-slate"><LockKeyhole size={15} /></span><div><strong>Stays private</strong><span>Never revealed to the verifier.</span></div></div><div className="private-chips"><span>Legal name</span><span>Wallet balance</span><span>Source documents</span></div></div><div className="modal-note"><Clock3 size={14} /> This proof expires {request.expires}. You can revoke access at any time.</div>{decliningNow
    ? <><label className="request-field decline-reason"><span>Reason (optional)</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={500} placeholder="Kept for your own records — the verifier is only told you declined." disabled={isBusy} autoFocus /></label><div className="modal-actions"><button className="button button-ghost" onClick={() => setDecliningNow(false)} disabled={isBusy}>Back</button><button className="button button-danger button-wide" onClick={() => onDecline(reason.trim())} disabled={isBusy}><XCircle size={16} /> {isBusy ? "Declining…" : "Confirm decline"}</button></div></>
    : <div className="modal-actions"><button className="button button-ghost" onClick={() => setDecliningNow(true)} disabled={isBusy}>Decline</button><button className="button button-primary button-wide" onClick={() => onApprove(request.attributes)} disabled={isBusy}><ShieldCheck size={16} /> {isBusy ? "Approving…" : "Approve proof"}</button></div>}</div></div>;
}
