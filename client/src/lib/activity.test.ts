import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeElapsed, toActivityItems } from "./activity";
import type { ServerProofRequest } from "./types";

const NOW = new Date("2026-06-01T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function row(overrides: Partial<ServerProofRequest> & Record<string, unknown> = {}) {
  return {
    id: 1,
    verifierName: "Northstar Academy",
    purpose: "Confirm bootcamp completion",
    requestedAttributes: "[]",
    expiresAt: NOW.toISOString(),
    status: "pending",
    createdAt: ago(3_600_000),
    updatedAt: ago(600_000),
    ...overrides,
  } as ServerProofRequest;
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

describe("describeElapsed", () => {
  it("steps from just now through minutes, hours and days", () => {
    expect(describeElapsed(new Date(NOW.getTime() - 30_000))).toBe("just now");
    expect(describeElapsed(new Date(ago(600_000)))).toBe("10m ago");
    expect(describeElapsed(new Date(ago(3 * 3_600_000)))).toBe("3h ago");
    expect(describeElapsed(new Date(ago(2 * 86_400_000)))).toBe("2d ago");
  });
});

describe("toActivityItems", () => {
  it("records only the creation while a request is pending", () => {
    const items = toActivityItems([row()]);
    expect(items.map(i => i.title)).toEqual(["Proof request created"]);
  });

  it("adds the resolution ahead of the creation once answered", () => {
    // PRD §13.3: the trail has to grow when a request is answered.
    expect(toActivityItems([row({ status: "approved" })]).map(i => i.title))
      .toEqual(["Proof approved", "Proof request created"]);
    expect(toActivityItems([row({ status: "declined" })]).map(i => i.title))
      .toEqual(["Proof declined", "Proof request created"]);
  });

  it("keeps entries free of anything but verifier, purpose and time", () => {
    // ARCHITECTURE §13 limits an activity entry to non-sensitive metadata.
    const [entry] = toActivityItems([row({ status: "approved" })]);
    expect(entry.detail).toBe("Northstar Academy · Confirm bootcamp completion");
    expect(entry.time).toBe("10m ago");
    expect(entry.seeded).toBeUndefined();
  });

  it("grows with every stored request", () => {
    expect(toActivityItems([row({ id: 1, status: "approved" }), row({ id: 2 })])).toHaveLength(3);
  });
});
