import { ChevronRight, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { isSeededRequest, type ProofRequestView } from "../lib/types";
import { StatusPill } from "./StatusBadge";

export function RequestRow({ request, onApprove, compact = false }: { request: ProofRequestView; onApprove: (id: string) => void; compact?: boolean }) {
  // PRD §5 "Honest demo": a seeded row and one that really round-tripped
  // through the store must not look identical.
  const seeded = isSeededRequest(request);
  return <div className={`request-row ${compact ? "request-row-compact" : ""}`}><div className="request-logo">{request.logo}</div><div className="request-main"><div className="request-title-line"><strong>{request.verifier}</strong><StatusPill status={request.status} />{seeded && <span className="demo-tag" title="Seeded demo data — not stored">Demo</span>}</div><p>{request.purpose}</p><div className="request-meta"><span>{request.attributes.length} attributes requested</span><span className="meta-separator">·</span><span>{request.expires}</span></div></div>{request.status === "Pending" ? <button className="mini-action" onClick={() => onApprove(request.id)}>Review <ChevronRight size={14} /></button> : <button className="icon-button row-more" aria-label="Request options" onClick={() => toast("Request options", { description: request.status === "Expired" ? "This request expired and can no longer be answered." : "This request is already resolved." })}><MoreHorizontal size={17} /></button>}</div>;
}
