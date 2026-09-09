import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes } from "./hex";

/**
 * Both the authority secret and the holder secret are 32-byte values kept as
 * hex in localStorage, so the conversion sits in its own module rather than
 * having the two secret modules import each other.
 */
describe("hexToBytes", () => {
  it("reads a 32-byte secret back exactly", () => {
    expect([...hexToBytes("00ff10")]).toEqual([0, 255, 16]);
  });

  it("tolerates a 0x prefix and surrounding space, which pasted values carry", () => {
    expect([...hexToBytes("  0x00ff  ")]).toEqual([0, 255]);
  });

  it("refuses an odd number of digits rather than dropping one", () => {
    expect(() => hexToBytes("abc")).toThrow(/hex/i);
  });

  it("refuses anything that is not hex, instead of producing NaN bytes", () => {
    expect(() => hexToBytes("zzzz")).toThrow(/hex/i);
  });
});

describe("bytesToHex", () => {
  it("pads each byte to two digits, or the value cannot be read back", () => {
    expect(bytesToHex(Uint8Array.from([0, 15, 255]))).toBe("000fff");
  });

  it("round-trips a generated secret", () => {
    const secret = crypto.getRandomValues(new Uint8Array(32));
    expect([...hexToBytes(bytesToHex(secret))]).toEqual([...secret]);
  });
});
