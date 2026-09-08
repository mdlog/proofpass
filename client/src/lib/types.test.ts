import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attributeLabel,
  describeExpiry,
  isSeededRequest,
  parseRequestedAttributes,
  serverRequestId,
  toDisplayRequest,
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
