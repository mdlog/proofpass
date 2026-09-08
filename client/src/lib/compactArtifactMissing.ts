/**
 * Stands in for the generated Compact module when `contracts/managed/proofpass`
 * has not been built. Importing it fails loudly instead of letting the UI claim
 * an artifact it does not have (ARCHITECTURE §20: missing artifacts must produce
 * an explicit unavailable state).
 */
export const Contract = undefined;
export const witnesses = undefined;
export const __artifactMissing = true;
