import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attributeLabel,
  describeExpiry,
  isSeededRequest,
  parseRequestedAttributes,
  serverRequestId,
  credentialSummary,
  disclosureSummary,
  toDisplayCredential,
  toDisplayRequest,
  preferStored,
  verificationTrend,
  type CredentialView,
  type ProofRequestView,
  type ServerProofRequest,
} from "./types";

const NOW = new Date("2026-06-01T12:00:00.000Z");
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

function row(overrides: Partial<ServerProofRequest> = {}): ServerProofRequest {
  return {
    id: 7,
    verifierName: "Northstar Academy",
    purpose: "Confirm bootcamp completion",
    requestedAttributes: JSON.stringify(["completion_status", "issuer"]),
    expiresAt: hoursFromNow(48),
    status: "pending",
    ...overrides,
  };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

describe("parseRequestedAttributes", () => {
  it("reads the JSON array the column stores", () => {
    expect(parseRequestedAttributes('["completion_status","cohort"]')).toEqual(["completion_status", "cohort"]);
  });

  it("falls back to a comma-separated list rather than throwing", () => {
    expect(parseRequestedAttributes("Completion status, Issuer")).toEqual(["Completion status", "Issuer"]);
  });

  it("returns nothing for a JSON value that is not an array", () => {
    expect(parseRequestedAttributes('{"a":1}')).toEqual([]);
  });
});

describe("attributeLabel", () => {
  it("renders the documented facts with their labels", () => {
    expect(attributeLabel("completion_status")).toBe("Completion status");
    expect(attributeLabel("cohort")).toBe("Cohort");
    expect(attributeLabel("issuer")).toBe("Issuer");
  });

  it("passes anything else through untouched", () => {
    expect(attributeLabel("Cohort 2026")).toBe("Cohort 2026");
  });
});

describe("describeExpiry", () => {
  it("counts days, then hours, then reports expiry", () => {
    expect(describeExpiry(new Date(hoursFromNow(48)))).toBe("in 2 days");
    expect(describeExpiry(new Date(hoursFromNow(24)))).toBe("in 1 day");
    expect(describeExpiry(new Date(hoursFromNow(5)))).toBe("in 5 hours");
    expect(describeExpiry(new Date(hoursFromNow(-1)))).toBe("expired");
  });

  it("does not crash on an unparseable date", () => {
    expect(describeExpiry(new Date("not a date"))).toBe("no expiry set");
  });
});

describe("toDisplayRequest", () => {
  it("maps a stored row onto the shape the list renders", () => {
    const view = toDisplayRequest(row());
    expect(view).toMatchObject({
      id: "db-7",
      verifier: "Northstar Academy",
      status: "Pending",
      logo: "N",
      attributes: ["completion_status", "issuer"],
      expires: "in 2 days",
    });
  });

  it("derives Expired for a pending request whose deadline has passed", () => {
    // Nothing sets `expired` server-side, so this derivation is what stops the
    // UI offering Review on a request it can no longer honour.
    expect(toDisplayRequest(row({ expiresAt: hoursFromNow(-1) })).status).toBe("Expired");
  });

  it("leaves a settled request alone even when it is past its deadline", () => {
    expect(toDisplayRequest(row({ status: "approved", expiresAt: hoursFromNow(-1) })).status).toBe("Approved");
    expect(toDisplayRequest(row({ status: "declined", expiresAt: hoursFromNow(-1) })).status).toBe("Declined");
  });

  it("falls back to a readable name when the verifier is blank", () => {
    const view = toDisplayRequest(row({ verifierName: "   " }));
    expect(view.verifier).toBe("Unnamed verifier");
    expect(view.logo).toBe("U");
  });

  it("treats an unknown server status as pending rather than dropping the row", () => {
    expect(toDisplayRequest(row({ status: "something-new", expiresAt: hoursFromNow(48) })).status).toBe("Pending");
  });
});

describe("row provenance", () => {
  const seeded: ProofRequestView = { id: "req-7F3A", verifier: "X", purpose: "p", attributes: [], expires: "", status: "Pending", logo: "X" };

  it("separates seeded rows from stored ones", () => {
    expect(isSeededRequest(seeded)).toBe(true);
    expect(isSeededRequest(toDisplayRequest(row()))).toBe(false);
  });

  it("recovers the database id only from a stored row", () => {
    expect(serverRequestId(toDisplayRequest(row({ id: 42 })))).toBe(42);
    expect(serverRequestId(seeded)).toBeNull();
  });
});

/**
 * A stored credential and a seeded one sit in the same grid, so the mapping has
 * to produce the same shape and mark which is which — PRD §5, the same rule the
 * proof-request list already follows.
 */
describe("toDisplayCredential", () => {
  const row = {
    id: 7,
    title: "Bootcamp completion",
    status: "active" as const,
    issuedAt: new Date("2026-09-09T00:00:00.000Z"),
    expiresAt: new Date("2027-09-09T00:00:00.000Z"),
    credentialKey: "5a2707d6538212219ebf73ab9529686c769a1cb4eda1abf1884d44b80a941f0a",
  };

  it("labels a stored credential as stored, not seeded", () => {
    expect(toDisplayCredential(row, "Northstar Academy").seeded).toBe(false);
  });

  it("names the issuer it was recorded against", () => {
    expect(toDisplayCredential(row, "Northstar Academy").issuer).toBe("Northstar Academy");
  });

  it("says so plainly when the issuer row is gone rather than showing a blank", () => {
    expect(toDisplayCredential(row, undefined).issuer).toBe("Unknown issuer");
  });

  it("maps the stored status to the label the filter uses", () => {
    expect(toDisplayCredential(row, "N").status).toBe("Active");
    expect(toDisplayCredential({ ...row, status: "expiring" }, "N").status).toBe("Expiring soon");
    expect(toDisplayCredential({ ...row, status: "revoked" }, "N").status).toBe("Revoked");
  });

  it("shows a credential past its expiry as expiring soon, since nothing sweeps the column", () => {
    const past = { ...row, expiresAt: new Date("2020-01-01T00:00:00.000Z") };
    expect(toDisplayCredential(past, "N").status).toBe("Expiring soon");
  });

  it("keeps a revoked credential revoked even once expired", () => {
    const past = { ...row, status: "revoked" as const, expiresAt: new Date("2020-01-01T00:00:00.000Z") };
    expect(toDisplayCredential(past, "N").status).toBe("Revoked");
  });

  it("carries the commitment, which is what makes it checkable on chain", () => {
    expect(toDisplayCredential(row, "N").credentialKey).toBe(row.credentialKey);
  });

  it("survives a credential with no expiry", () => {
    expect(toDisplayCredential({ ...row, expiresAt: null }, "N").expires).toMatch(/no expiry/i);
  });
});

/**
 * The Credentials page shows stored cards and seeded ones in one grid. Saying
 * which is which in a line above them is the difference between a page that is
 * honest and a page that merely has honest badges on it.
 */
describe("credentialSummary", () => {
  const seeded = { seeded: true } as CredentialView;
  const stored = { seeded: false } as CredentialView;

  it("says nothing is stored rather than implying the seeded ones are yours", () => {
    expect(credentialSummary([seeded, seeded])).toMatch(/none.*stored|no stored/i);
  });

  it("counts stored and seeded separately once both are present", () => {
    const summary = credentialSummary([stored, seeded, seeded]);
    expect(summary).toMatch(/1 stored/);
    expect(summary).toMatch(/2 (seeded|demo)/i);
  });

  it("stops mentioning seeded cards when there are none left", () => {
    expect(credentialSummary([stored, stored])).not.toMatch(/seeded|demo/i);
  });

  it("says something for an empty grid rather than returning nothing", () => {
    expect(credentialSummary([]).length).toBeGreaterThan(0);
  });
});

/**
 * Seeded rows exist so a page is not empty before anything is stored. Once real
 * rows arrive that reason is gone, and keeping them only dilutes the real ones —
 * a list where four of five entries are fabricated reads as a mock even when it
 * is not.
 */
describe("preferStored", () => {
  const stored = (id: string) => ({ id }) as ProofRequestView;
  const seeded = (id: string) => ({ id }) as ProofRequestView;

  it("shows only stored rows once any exist", () => {
    expect(preferStored([stored("s1")], [seeded("d1"), seeded("d2")]).map((r) => r.id)).toEqual(["s1"]);
  });

  it("falls back to seeded rows when nothing is stored, so the page is not empty", () => {
    expect(preferStored([], [seeded("d1"), seeded("d2")]).map((r) => r.id)).toEqual(["d1", "d2"]);
  });

  it("keeps every stored row, in the order given", () => {
    expect(preferStored([stored("s1"), stored("s2")], [seeded("d1")]).map((r) => r.id)).toEqual(["s1", "s2"]);
  });

  it("shows nothing rather than inventing rows when both are empty", () => {
    expect(preferStored([], [])).toEqual([]);
  });

  it("applies to credentials on the same terms, since the reason is the same", () => {
    const held = { seeded: false, title: "real" } as CredentialView;
    const demo = { seeded: true, title: "seeded" } as CredentialView;
    expect(preferStored([held], [demo, demo])).toEqual([held]);
    expect(preferStored([], [demo])).toEqual([demo]);
  });
});

/**
 * The Activity chart was eight hardcoded bar heights with no label on it. A
 * chart reads as data by its shape, so an unlabelled fabricated one misleads
 * more than a number ever could. Verifications carry `verifiedAt`, so the trend
 * is countable from what is stored.
 */
describe("verificationTrend", () => {
  const now = new Date("2026-09-10T12:00:00.000Z");
  const at = (iso: string) => ({ verifiedAt: iso });

  it("returns one bucket per day asked for", () => {
    expect(verificationTrend([], 7, now)).toHaveLength(7);
  });

  it("is all zero when nothing was verified, rather than an invented shape", () => {
    expect(verificationTrend([], 7, now)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("puts today in the last bucket, which is how a trend reads", () => {
    expect(verificationTrend([at("2026-09-10T09:00:00.000Z")], 7, now).at(-1)).toBe(1);
  });

  it("counts several on the same day together", () => {
    const rows = [at("2026-09-10T01:00:00.000Z"), at("2026-09-10T23:00:00.000Z")];
    expect(verificationTrend(rows, 7, now).at(-1)).toBe(2);
  });

  it("places an older row in an earlier bucket", () => {
    expect(verificationTrend([at("2026-09-08T12:00:00.000Z")], 7, now)).toEqual([0, 0, 0, 0, 1, 0, 0]);
  });

  it("ignores anything outside the window rather than piling it on the edge", () => {
    expect(verificationTrend([at("2025-01-01T00:00:00.000Z")], 7, now)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("survives a row with an unreadable timestamp", () => {
    expect(verificationTrend([{ verifiedAt: "not a date" }], 7, now)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

/**
 * "Privacy score 92/100" and "Data kept private 86%" were composites of nothing.
 * What is measurable is what was actually disclosed, and what the ledger holds —
 * which for attributes is nothing at all, because the contract stores only
 * Bytes<32> commitments.
 *
 * Notably this build has no selective disclosure: approving sends every
 * requested attribute, so withheld is 0. Reporting that plainly is the point;
 * a ratio dressed up as minimisation would be the same lie in a new shape.
 */
describe("disclosureSummary", () => {
  const request = (id: number, attrs: string[]) => ({ id, requestedAttributes: JSON.stringify(attrs) });
  const verification = (proofRequestId: number, attrs: string[]) => ({
    proofRequestId,
    resultSummary: JSON.stringify({ consentVersion: "1.0", disclosedAttributes: attrs }),
  });

  it("counts the proofs actually shared", () => {
    const s = disclosureSummary([request(1, ["a", "b"])], [verification(1, ["a", "b"])]);
    expect(s.proofs).toBe(1);
  });

  it("counts attributes disclosed across every proof", () => {
    const s = disclosureSummary(
      [request(1, ["a", "b"]), request(2, ["c"])],
      [verification(1, ["a", "b"]), verification(2, ["c"])],
    );
    expect(s.disclosed).toBe(3);
  });

  it("reports withheld attributes, which this build never has", () => {
    const s = disclosureSummary([request(1, ["a", "b"])], [verification(1, ["a", "b"])]);
    expect(s.requested).toBe(2);
    expect(s.withheld).toBe(0);
  });

  it("counts a genuinely partial disclosure, should one ever exist", () => {
    const s = disclosureSummary([request(1, ["a", "b", "c"])], [verification(1, ["a"])]);
    expect(s.withheld).toBe(2);
  });

  it("is all zero before anything is shared, rather than a flattering default", () => {
    expect(disclosureSummary([], [])).toEqual({ proofs: 0, disclosed: 0, requested: 0, withheld: 0 });
  });

  it("survives a summary that is not the JSON it should be", () => {
    const s = disclosureSummary([request(1, ["a"])], [{ proofRequestId: 1, resultSummary: "not json" }]);
    expect(s.proofs).toBe(1);
    expect(s.disclosed).toBe(0);
  });

  it("ignores a verification whose request is gone", () => {
    expect(disclosureSummary([], [verification(9, ["a"])]).requested).toBe(0);
  });
});
