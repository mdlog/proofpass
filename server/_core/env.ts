export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  /** Where the proof server listens; the browser reaches it only through /proof-server. */
  proofServerUrl: process.env.PROOF_SERVER_URL ?? "http://127.0.0.1:6300",
  midnightNetworkId: process.env.MIDNIGHT_NETWORK_ID ?? "preview",
  midnightCompactModulePath: process.env.MIDNIGHT_COMPACT_MODULE_PATH ?? "",
  midnightCompactAssetsPath: process.env.MIDNIGHT_COMPACT_ASSETS_PATH ?? "",
  midnightCompactContractTag: process.env.MIDNIGHT_COMPACT_CONTRACT_TAG ?? "proofpass",
};
