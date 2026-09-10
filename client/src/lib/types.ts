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

/** One credential as the UI renders it, whatever its origin. */
export type CredentialView = {
  id: string;
  title: string;
  issuer: string;
  issued: string;
  expires: string;
  status: CredentialStatus;
  accent: string;
  mark: string;
  /** The commitment, which is what makes the credential checkable on chain. */
  credentialKey?: string;
  seeded: boolean;
};

type StoredCredential = {
  id: number;
  title: string;
  status: "active" | "expiring" | "revoked";
  issuedAt: Date | string;
  expiresAt: Date | string | null;
  credentialKey: string;
};

const STORED_CREDENTIAL_LABEL: Record<StoredCredential["status"], CredentialStatus> = {
  active: "Active",
  expiring: "Expiring soon",
  revoked: "Revoked",
};

const day = (value: Date | string | null) =>
  value === null ? "no expiry" : new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/**
 * A stored credential in the shape the grid renders, marked as stored so it
 * sits unlabelled beside seeded ones (PRD §5).
 *
 * The issuer name comes from the registry rather than the credential: the row
 * holds only a foreign key, and a credential whose issuer has gone says so
 * instead of rendering an empty byline.
 */
export function toDisplayCredential(row: StoredCredential, issuerName: string | undefined): CredentialView {
  // Nothing sweeps the status column, so an expiry that has passed is reported
  // as expiring rather than left claiming to be active. Revocation is one way
  // and outranks it.
  const stored = STORED_CREDENTIAL_LABEL[row.status] ?? "Active";
  const expired = row.expiresAt !== null && new Date(row.expiresAt).getTime() <= Date.now();
  return {
    id: `stored-${row.id}`,
    title: row.title,
    issuer: issuerName?.trim() || "Unknown issuer",
    issued: day(row.issuedAt),
    expires: day(row.expiresAt),
    status: stored === "Revoked" ? "Revoked" : expired ? "Expiring soon" : stored,
    accent: "teal",
    mark: (issuerName?.trim() || "?").slice(0, 2).toUpperCase(),
    credentialKey: row.credentialKey,
    seeded: false,
  };
}

/**
 * What the credential grid is actually showing.
 *
 * Stored cards and seeded ones sit side by side, and a badge on each is easy to
 * skim past. Saying the split in a line above them means the page states what it
 * is rather than leaving it to be inferred.
 */
export function credentialSummary(credentials: CredentialView[]): string {
  const stored = credentials.filter((credential) => !credential.seeded).length;
  const seeded = credentials.length - stored;
  const held = stored === 0 ? "No stored credentials yet" : `${stored} stored credential${stored === 1 ? "" : "s"}`;
  return seeded === 0 ? `${held}.` : `${held} · ${seeded} seeded card${seeded === 1 ? "" : "s"} below, kept so the page reads as populated.`;
}

/**
 * Which proof requests to show.
 *
 * Seeded rows exist so the page is not empty before anything is stored. Once
 * real rows arrive that reason is gone, and keeping them beside real ones only
 * dilutes them — a list where four of five entries are fabricated reads as a
 * mock even when it is not, whatever the badges say.
 */
export function visibleRequests(stored: ProofRequestView[], seeded: ProofRequestView[]): ProofRequestView[] {
  return stored.length > 0 ? stored : seeded;
}
