import { ArrowUpRight, CheckCircle2, XCircle, type LucideIcon } from "lucide-react";
import type { ServerProofRequest } from "./types";

export type ActivityItem = {
  type: string;
  title: string;
  detail: string;
  time: string;
  icon: LucideIcon;
  /** Seeded rows are labelled, so the trail never passes demo data off as real. */
  seeded?: boolean;
};

export function describeElapsed(at: Date) {
  const elapsed = Date.now() - at.getTime();
  if (Number.isNaN(elapsed)) return "unknown";
  if (elapsed < 60_000) return "just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * PRD §13.3 requires the trail to grow when a request is answered, so the feed
 * is derived from the stored requests rather than from a fixed array.
 *
 * ARCHITECTURE §13 limits an activity entry to request id, purpose, status and
 * time — no attribute values, no holder identity.
 */
export function toActivityItems(rows: ServerProofRequest[]): ActivityItem[] {
  const entries: ActivityItem[] = [];

  for (const row of rows) {
    const created = new Date((row as { createdAt?: string | Date }).createdAt ?? row.expiresAt);
    const resolved = new Date((row as { updatedAt?: string | Date }).updatedAt ?? created);

    if (row.status === "approved") {
      entries.push({ type: "approved", title: "Proof approved", detail: `${row.verifierName} · ${row.purpose}`, time: describeElapsed(resolved), icon: CheckCircle2 });
    } else if (row.status === "declined") {
      entries.push({ type: "revoked", title: "Proof declined", detail: `${row.verifierName} · ${row.purpose}`, time: describeElapsed(resolved), icon: XCircle });
    }

    entries.push({ type: "requested", title: "Proof request created", detail: `${row.verifierName} · ${row.purpose}`, time: describeElapsed(created), icon: ArrowUpRight });
  }

  return entries;
}
