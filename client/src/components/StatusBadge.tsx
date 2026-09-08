/**
 * PRD §8: colour is never the only differentiator — every status also carries
 * its own text.
 */
const STATUS_STYLES: Record<string, string> = {
  Active: "status-active",
  "Expiring soon": "status-warning",
  Revoked: "status-danger",
  Pending: "status-warning",
  Approved: "status-active",
  Declined: "status-neutral",
  Expired: "status-neutral",
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill ${STATUS_STYLES[status] ?? "status-neutral"}`}><span className="status-dot" />{status}</span>;
}
