/**
 * Stands in for the generated Compact module when `contracts/managed/proofpass`
 * has not been built. Importing it fails loudly instead of letting the UI claim
 * an artifact it does not have (ARCHITECTURE §20: missing artifacts must produce
 * an explicit unavailable state).
 */
function unavailable(): never {
  throw new Error("Generated Compact module is missing. Run `pnpm contracts:build` first.");
}

export const Contract = undefined;
/** Shaped like the real module's, so call sites need no build-time branch. */
export const pureCircuits = { authorityKey: unavailable, credentialCommitment: unavailable };
export const ledger = unavailable;
export const witnesses = undefined;
export const __artifactMissing = true;
