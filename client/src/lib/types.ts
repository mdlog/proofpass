export type RequestStatus = "Pending" | "Approved" | "Declined" | "Expired";
export type CredentialStatus = "Active" | "Expiring soon" | "Revoked";

/** One proof request as the UI renders it, whatever its origin. */
export type ProofRequestView = {
  id: string;
  verifier: string;
  purpose: string;
  attributes: string[];
  expires: string;
  status: RequestStatus;
  logo: string;
};

/** The subset of a persisted `proofRequests` row this UI reads back. */
export type ServerProofRequest = {
  id: number;
  verifierName: string;
  purpose: string;
  requestedAttributes: string;
  expiresAt: string | Date;
  status: string;
};

export type NewRequestInput = { verifierName: string; purpose: string; requestedAttributes: string[]; expiresInDays: number };

/**
 * ARCHITECTURE §10 fixes the facts a policy may ask for:
 * `Array<"completion_status" | "cohort" | "issuer">`. Requests store those
 * identifiers; the UI renders the labels. Anything typed by hand is kept
 * verbatim, because the server's schema accepts free strings and refusing them
 * here would only hide the divergence.
 */
export const REQUESTABLE_FACTS = [
  { id: "completion_status", label: "Completion status", hint: "Whether the program was finished" },
  { id: "cohort", label: "Cohort", hint: "Which intake the credential belongs to" },
  { id: "issuer", label: "Issuer", hint: "Who issued the credential" },
] as const;

const FACT_LABELS: Record<string, string> = Object.fromEntries(REQUESTABLE_FACTS.map((fact) => [fact.id, fact.label]));

export function attributeLabel(attribute: string) {
  return FACT_LABELS[attribute] ?? attribute;
}

/** Recorded with every approval so a stored consent stays interpretable. */
export const CONSENT_VERSION = "1.0";

const SERVER_STATUS_LABEL: Record<string, RequestStatus> = { pending: "Pending", approved: "Approved", declined: "Declined", expired: "Expired" };

/** `requestedAttributes` is a JSON array kept in a text column. */
export function parseRequestedAttributes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
}

export function describeExpiry(expiresAt: Date) {
  const remaining = expiresAt.getTime() - Date.now();
  if (Number.isNaN(remaining)) return "no expiry set";
  if (remaining <= 0) return "expired";
  const days = Math.round(remaining / 86400000);
  if (days >= 1) return `in ${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.max(1, Math.round(remaining / 3600000));
  return `in ${hours} hour${hours === 1 ? "" : "s"}`;
}

export function toDisplayRequest(row: ServerProofRequest): ProofRequestView {
  const verifier = row.verifierName.trim() || "Unnamed verifier";
  const expiresAt = new Date(row.expiresAt);
  const stored = SERVER_STATUS_LABEL[row.status] ?? "Pending";
  // Nothing sets `expired` server-side, so a request that has run out of time
  // would otherwise keep offering a Review button it can no longer honour.
  const status: RequestStatus = stored === "Pending" && expiresAt.getTime() <= Date.now() ? "Expired" : stored;
  return {
    id: `db-${row.id}`,
    verifier,
    purpose: row.purpose,
    attributes: parseRequestedAttributes(row.requestedAttributes),
    expires: describeExpiry(expiresAt),
    status,
    logo: verifier.slice(0, 1).toUpperCase(),
  };
}

/** Persisted rows carry a `db-` id; everything else is the shipped demo set. */
export function isSeededRequest(request: ProofRequestView) {
  return !request.id.startsWith("db-");
}

export function serverRequestId(request: ProofRequestView) {
  const parsed = Number(request.id.slice(3));
  return request.id.startsWith("db-") && Number.isFinite(parsed) ? parsed : null;
}
