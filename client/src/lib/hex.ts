/**
 * Hex for the 32-byte secrets ProofPass keeps in localStorage.
 *
 * Its own module because both the authority secret and the holder secret need
 * it, and having those two import each other would make a cycle out of a
 * three-line conversion. Length is not checked here: how many bytes a value
 * must be belongs to the value, not to the encoding.
 */

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/, "");
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(clean)) {
    throw new Error(`Expected an even number of hex digits, got ${JSON.stringify(hex)}.`);
  }
  return Uint8Array.from(clean.match(/../g)!.map((byte) => parseInt(byte, 16)));
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
