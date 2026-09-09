import { describe, expect, it } from "vitest";
import { describeError, readableMessage } from "./describeError";

/**
 * Reproduces the shape the Midnight SDK actually threw when a deploy ran out of
 * DUST: an Effect FiberFailure whose own message is empty, wrapping a Cause
 * whose real detail sits in `failure.message`.
 */
function fiberFailure() {
  const cause = Object.assign(Object.create(null), {
    _id: "Cause",
    _tag: "Fail",
    failure: { message: "Insufficient Funds: could not balance dust", tokenType: "dust", _tag: "Wallet.InsufficientFunds" },
  });
  const error = new Error("");
  Object.assign(error, { _id: "FiberFailure" });
  (error as Error & { cause?: unknown }).cause = cause;
  return error;
}

describe("readableMessage", () => {
  it("finds the message Effect buried in cause.failure", () => {
    expect(readableMessage(fiberFailure())).toBe("Insufficient Funds: could not balance dust");
  });

  it("prefers a plain message when there is one", () => {
    expect(readableMessage(new Error("Access to wallet api denied"))).toBe("Access to wallet api denied");
  });

  it("falls back rather than showing [object Object]", () => {
    const error = new Error("");
    (error as Error & { cause?: unknown }).cause = {};
    expect(readableMessage(error, "nothing usable")).toBe("nothing usable");
  });

  it("reads a non-Error throwable", () => {
    expect(readableMessage("plain string failure")).toBe("plain string failure");
  });
});

describe("describeError", () => {
  it("keeps the Effect tags that identify the failure", () => {
    const described = describeError(fiberFailure());
    expect(described.properties).toMatchObject({ _id: "FiberFailure" });
    expect(described.cause?.properties).toMatchObject({ _id: "Cause", _tag: "Fail" });
    expect((described.cause?.properties?.failure as { _tag?: string })?._tag).toBe("Wallet.InsufficientFunds");
  });

  it("does not recurse forever on a circular cause", () => {
    const a = new Error("a");
    (a as Error & { cause?: unknown }).cause = a;
    expect(() => describeError(a)).not.toThrow();
  });
});
