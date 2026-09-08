import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/** Core user table backing Manus OAuth. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

/** A user-owned issuer identity and its deployed Compact contract address. */
export const issuers = mysqlTable("issuers", {
  id: int("id").autoincrement().primaryKey(),
  ownerUserId: int("ownerUserId").notNull(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  displayName: varchar("displayName", { length: 180 }).notNull(),
  did: varchar("did", { length: 320 }),
  networkId: varchar("networkId", { length: 32 }).notNull().default("preview"),
  contractAddress: varchar("contractAddress", { length: 180 }),
  status: mysqlEnum("status", ["active", "suspended", "revoked"]).notNull().default("active"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Public credential registry metadata. No private key or raw source document is stored. */
export const credentials = mysqlTable("credentials", {
  id: int("id").autoincrement().primaryKey(),
  issuerId: int("issuerId").notNull(),
  holderUserId: int("holderUserId"),
  holderWalletAddress: varchar("holderWalletAddress", { length: 220 }),
  credentialKey: varchar("credentialKey", { length: 180 }).notNull().unique(),
  title: varchar("title", { length: 180 }).notNull(),
  subjectCommitment: varchar("subjectCommitment", { length: 220 }),
  contractAddress: varchar("contractAddress", { length: 180 }),
  networkId: varchar("networkId", { length: 32 }).notNull().default("preview"),
  issuedAt: timestamp("issuedAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt"),
  status: mysqlEnum("status", ["active", "expiring", "revoked"]).notNull().default("active"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Provider metadata only; signing material remains inside the wallet extension. */
export const walletConnections = mysqlTable("walletConnections", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  providerId: varchar("providerId", { length: 140 }).notNull(),
  providerName: varchar("providerName", { length: 180 }).notNull(),
  walletAddress: varchar("walletAddress", { length: 220 }).notNull(),
  networkId: varchar("networkId", { length: 32 }).notNull(),
  lastConnectedAt: timestamp("lastConnectedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Purpose-bound requests stored for the holder and verifier audit trail. */
export const proofRequests = mysqlTable("proofRequests", {
  id: int("id").autoincrement().primaryKey(),
  requesterUserId: int("requesterUserId").notNull(),
  holderUserId: int("holderUserId"),
  issuerId: int("issuerId"),
  requestKey: varchar("requestKey", { length: 180 }).notNull().unique(),
  verifierName: varchar("verifierName", { length: 180 }).notNull(),
  purpose: text("purpose").notNull(),
  requestedAttributes: text("requestedAttributes").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  status: mysqlEnum("status", ["pending", "approved", "declined", "expired"]).notNull().default("pending"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Verification outcomes and transaction references; result payloads should contain claims, not source documents. */
export const verifications = mysqlTable("verifications", {
  id: int("id").autoincrement().primaryKey(),
  proofRequestId: int("proofRequestId").notNull(),
  verifierUserId: int("verifierUserId").notNull(),
  holderUserId: int("holderUserId"),
  verificationKey: varchar("verificationKey", { length: 180 }).notNull().unique(),
  status: mysqlEnum("status", ["verified", "failed", "revoked"]).notNull(),
  transactionId: varchar("transactionId", { length: 220 }),
  resultSummary: text("resultSummary"),
  verifiedAt: timestamp("verifiedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Issuer = typeof issuers.$inferSelect;
export type InsertIssuer = typeof issuers.$inferInsert;
export type Credential = typeof credentials.$inferSelect;
export type InsertCredential = typeof credentials.$inferInsert;
export type WalletConnection = typeof walletConnections.$inferSelect;
export type InsertWalletConnection = typeof walletConnections.$inferInsert;
export type ProofRequest = typeof proofRequests.$inferSelect;
export type InsertProofRequest = typeof proofRequests.$inferInsert;
export type Verification = typeof verifications.$inferSelect;
export type InsertVerification = typeof verifications.$inferInsert;
