import { and, desc, eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  credentials,
  issuers,
  proofRequests,
  type InsertUser,
  type InsertIssuer,
  type InsertWalletConnection,
  users,
  verifications,
  walletConnections,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db) throw new Error("Database is not configured.");
  return db;
}

export async function upsertUser(user: typeof users.$inferInsert): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  const values: InsertUser = { openId: user.openId, name: user.name ?? null, email: user.email ?? null, loginMethod: user.loginMethod ?? null, lastSignedIn: user.lastSignedIn ?? new Date() };
  const updateSet: Record<string, unknown> = { name: values.name, email: values.email, loginMethod: values.loginMethod, lastSignedIn: values.lastSignedIn };
  if (user.role) {
    values["role"] = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values["role"] = "admin";
    updateSet.role = "admin";
  }
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function listIssuerRegistry(userId: number) {
  const db = requireDb(await getDb());
  const [ownedIssuers, ownedCredentials, connectedWallets, requests, verificationRows] = await Promise.all([
    db.select().from(issuers).where(eq(issuers.ownerUserId, userId)).orderBy(desc(issuers.updatedAt)),
    db.select().from(credentials).where(eq(credentials.holderUserId, userId)).orderBy(desc(credentials.updatedAt)),
    db.select().from(walletConnections).where(eq(walletConnections.userId, userId)).orderBy(desc(walletConnections.lastConnectedAt)),
    db.select().from(proofRequests).where(or(eq(proofRequests.requesterUserId, userId), eq(proofRequests.holderUserId, userId))).orderBy(desc(proofRequests.updatedAt)),
    db.select().from(verifications).where(or(eq(verifications.verifierUserId, userId), eq(verifications.holderUserId, userId))).orderBy(desc(verifications.verifiedAt)),
  ]);
  return { issuers: ownedIssuers, credentials: ownedCredentials, wallets: connectedWallets, proofRequests: requests, verifications: verificationRows };
}

export async function createIssuer(userId: number, input: Omit<InsertIssuer, "ownerUserId">) {
  const db = requireDb(await getDb());
  await db.insert(issuers).values({ ...input, ownerUserId: userId });
  const created = await db.select().from(issuers).where(eq(issuers.slug, input.slug)).limit(1);
  return created[0];
}

export async function updateIssuerContract(userId: number, issuerId: number, contractAddress: string) {
  const db = requireDb(await getDb());
  await db.update(issuers).set({ contractAddress }).where(and(eq(issuers.id, issuerId), eq(issuers.ownerUserId, userId)));
  const updated = await db.select().from(issuers).where(and(eq(issuers.id, issuerId), eq(issuers.ownerUserId, userId))).limit(1);
  return updated[0];
}

/**
 * The metadata half of an on-chain credential: the ledger holds the commitment,
 * this holds the title, issuer and expiry that make it readable. Scoped twice —
 * the issuer must belong to the caller, and the row is held by the caller — so a
 * credential cannot be attributed to an issuer someone else owns.
 */
export async function createCredential(userId: number, input: {
  issuerId: number;
  credentialKey: string;
  title: string;
  subjectCommitment?: string;
  contractAddress?: string;
  networkId: string;
  expiresAt?: Date;
  holderWalletAddress?: string;
}) {
  const db = requireDb(await getDb());
  const [issuer] = await db.select().from(issuers).where(and(eq(issuers.id, input.issuerId), eq(issuers.ownerUserId, userId))).limit(1);
  if (!issuer) throw new Error("Issuer not found for this account");
  // `credentialKey` is the commitment, and the ledger will not accept the same
  // one twice either — so the friendlier message comes before the constraint.
  const [existing] = await db.select().from(credentials).where(eq(credentials.credentialKey, input.credentialKey)).limit(1);
  if (existing) throw new Error("Credential already recorded");
  await db.insert(credentials).values({ ...input, holderUserId: userId });
  const [created] = await db.select().from(credentials).where(eq(credentials.credentialKey, input.credentialKey)).limit(1);
  return created;
}

/** Revocation is one way on the ledger, and one way here. */
export async function revokeStoredCredential(userId: number, credentialKey: string) {
  const db = requireDb(await getDb());
  const where = and(eq(credentials.credentialKey, credentialKey), eq(credentials.holderUserId, userId));
  await db.update(credentials).set({ status: "revoked" }).where(where);
  const [row] = await db.select().from(credentials).where(where).limit(1);
  return row;
}

export async function saveWalletConnection(userId: number, input: Omit<InsertWalletConnection, "userId">) {
  const db = requireDb(await getDb());
  const existing = await db.select().from(walletConnections).where(and(eq(walletConnections.userId, userId), eq(walletConnections.providerId, input.providerId), eq(walletConnections.walletAddress, input.walletAddress))).limit(1);
  if (existing[0]) {
    await db.update(walletConnections).set({ ...input, lastConnectedAt: new Date() }).where(eq(walletConnections.id, existing[0].id));
    return { ...existing[0], ...input, lastConnectedAt: new Date() };
  }
  await db.insert(walletConnections).values({ ...input, userId });
  const created = await db.select().from(walletConnections).where(and(eq(walletConnections.userId, userId), eq(walletConnections.providerId, input.providerId), eq(walletConnections.walletAddress, input.walletAddress))).orderBy(desc(walletConnections.id)).limit(1);
  return created[0];
}

export async function createProofRequest(userId: number, input: Omit<typeof proofRequests.$inferInsert, "requesterUserId">) {
  const db = requireDb(await getDb());
  await db.insert(proofRequests).values({ ...input, requesterUserId: userId });
  const created = await db.select().from(proofRequests).where(eq(proofRequests.requestKey, input.requestKey)).limit(1);
  return created[0];
}

export async function setProofRequestStatus(holderUserId: number, requestId: number, status: "approved" | "declined") {
  const db = requireDb(await getDb());
  await db.update(proofRequests).set({ status }).where(and(eq(proofRequests.id, requestId), eq(proofRequests.holderUserId, holderUserId), eq(proofRequests.status, "pending")));
  const updated = await db.select().from(proofRequests).where(and(eq(proofRequests.id, requestId), eq(proofRequests.holderUserId, holderUserId))).limit(1);
  return updated[0];
}

export async function recordVerification(userId: number, input: Omit<typeof verifications.$inferInsert, "verifierUserId">) {
  const db = requireDb(await getDb());
  await db.insert(verifications).values({ ...input, verifierUserId: userId });
  const created = await db.select().from(verifications).where(eq(verifications.verificationKey, input.verificationKey)).limit(1);
  return created[0];
}
