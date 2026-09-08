import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * The proof-request lifecycle at the tRPC layer (ARCHITECTURE §14, integration).
 *
 * `./db` is replaced by an in-memory store that reproduces the gate the real
 * `setProofRequestStatus` enforces in SQL — only the holder, and only while the
 * request is still pending. That keeps the suite hermetic (no MySQL, no
 * network) while still exercising the real router: auth middleware, zod
 * contracts, and the wiring between them.
 */
const store = vi.hoisted(() => {
  const state = { issuers: [] as any[], proofRequests: [] as any[], verifications: [] as any[], wallets: [] as any[], nextId: 1 };
  return {
    state,
    reset() {
      state.issuers = []; state.proofRequests = []; state.verifications = []; state.wallets = []; state.nextId = 1;
    },
  };
});

vi.mock("./db", () => ({
  createIssuer: async (userId: number, input: any) => {
    const row = { id: store.state.nextId++, ownerUserId: userId, status: "active", ...input };
    store.state.issuers.push(row);
    return row;
  },
  updateIssuerContract: async (userId: number, issuerId: number, contractAddress: string) => {
    const row = store.state.issuers.find(i => i.id === issuerId && i.ownerUserId === userId);
    if (row) row.contractAddress = contractAddress;
    return row;
  },
  createProofRequest: async (userId: number, input: any) => {
    const row = { id: store.state.nextId++, requesterUserId: userId, status: "pending", ...input };
    store.state.proofRequests.push(row);
    return row;
  },
  // Mirrors the real WHERE clause: id AND holderUserId = caller AND status = 'pending'.
  setProofRequestStatus: async (holderUserId: number, requestId: number, status: string) => {
    const row = store.state.proofRequests.find(r => r.id === requestId && r.holderUserId === holderUserId && r.status === "pending");
    if (row) row.status = status;
    return store.state.proofRequests.find(r => r.id === requestId && r.holderUserId === holderUserId);
  },
  recordVerification: async (userId: number, input: any) => {
    const row = { id: store.state.nextId++, verifierUserId: userId, ...input };
    store.state.verifications.push(row);
    return row;
  },
  saveWalletConnection: async (userId: number, input: any) => {
    const row = { id: store.state.nextId++, userId, ...input };
    store.state.wallets.push(row);
    return row;
  },
  listIssuerRegistry: async (userId: number) => ({
    issuers: store.state.issuers.filter(i => i.ownerUserId === userId),
    credentials: [],
    wallets: store.state.wallets.filter(w => w.userId === userId),
    proofRequests: store.state.proofRequests.filter(r => r.requesterUserId === userId || r.holderUserId === userId),
    verifications: store.state.verifications.filter(v => v.verifierUserId === userId || v.holderUserId === userId),
  }),
}));

const { appRouter } = await import("./routers");

type User = NonNullable<TrpcContext["user"]>;

function user(id: number, role: "user" | "admin" = "user"): User {
  const now = new Date();
  return { id, openId: `open-${id}`, email: null, name: `User ${id}`, loginMethod: "dev", role, createdAt: now, updatedAt: now, lastSignedIn: now };
}

function caller(as: User | null) {
  const ctx = {
    user: as,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  } as TrpcContext;
  return appRouter.createCaller(ctx);
}

const REQUEST = {
  requestKey: "pr-lifecycle-001",
  verifierName: "Northstar Academy",
  purpose: "Confirm bootcamp completion",
  requestedAttributes: ["completion_status", "issuer"],
  expiresAt: new Date("2027-01-01T00:00:00.000Z"),
};

beforeEach(() => store.reset());

describe("authentication gate", () => {
  it("refuses every write to an anonymous caller", async () => {
    const anon = caller(null);
    await expect(anon.proofRequests.create(REQUEST)).rejects.toThrow(/Please login/);
    await expect(anon.proofRequests.approve({ requestId: 1 })).rejects.toThrow(/Please login/);
    await expect(anon.proofRequests.decline({ requestId: 1 })).rejects.toThrow(/Please login/);
    await expect(anon.issuer.registry()).rejects.toThrow(/Please login/);
    await expect(anon.wallet.saveConnection({ providerId: "lace", providerName: "lace", walletAddress: "mn_addr_x".padEnd(12, "y"), networkId: "preprod" }))
      .rejects.toThrow(/Please login/);
  });

  it("still answers auth.me anonymously", async () => {
    await expect(caller(null).auth.me()).resolves.toBeNull();
  });
});

describe("input contracts", () => {
  const holder = user(1);

  it("rejects a proof request with no requested facts", async () => {
    await expect(caller(holder).proofRequests.create({ ...REQUEST, requestedAttributes: [] })).rejects.toThrow();
  });

  it("rejects a proof request asking for more than twenty facts", async () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `fact_${i}`);
    await expect(caller(holder).proofRequests.create({ ...REQUEST, requestedAttributes: tooMany })).rejects.toThrow();
  });

  it("rejects an issuer slug that is not kebab-case", async () => {
    await expect(caller(holder).issuer.create({ slug: "Not A Slug", displayName: "Northstar", networkId: "preprod" })).rejects.toThrow();
  });

  it("accepts a well-formed issuer slug", async () => {
    await expect(caller(holder).issuer.create({ slug: "northstar-academy", displayName: "Northstar Academy", networkId: "preprod" }))
      .resolves.toMatchObject({ slug: "northstar-academy", status: "active" });
  });

  it("stores requested facts as a JSON array, not a raw list", async () => {
    await caller(holder).proofRequests.create({ ...REQUEST, holderUserId: 1 });
    expect(store.state.proofRequests[0].requestedAttributes).toBe('["completion_status","issuer"]');
  });
});

describe("proof request lifecycle", () => {
  const holder = user(1);

  it("runs request -> approve -> verification and reports each step in the registry", async () => {
    const api = caller(holder);

    const created = await api.proofRequests.create({ ...REQUEST, holderUserId: holder.id });
    expect(created.status).toBe("pending");
    expect((await api.issuer.registry()).proofRequests).toHaveLength(1);

    await api.proofRequests.approve({ requestId: created.id });
    expect((await api.issuer.registry()).proofRequests[0].status).toBe("approved");

    await api.verification.record({
      proofRequestId: created.id,
      holderUserId: holder.id,
      verificationKey: "nonce-abc-123",
      status: "verified",
      resultSummary: JSON.stringify({ consentVersion: "1.0", disclosedAttributes: REQUEST.requestedAttributes }),
    });

    const registry = await api.issuer.registry();
    expect(registry.verifications).toHaveLength(1);
    expect(JSON.parse(registry.verifications[0].resultSummary ?? "{}").disclosedAttributes).toEqual(["completion_status", "issuer"]);
  });

  it("records a decline as declined", async () => {
    const api = caller(holder);
    const created = await api.proofRequests.create({ ...REQUEST, holderUserId: holder.id });
    await api.proofRequests.decline({ requestId: created.id });
    expect(store.state.proofRequests[0].status).toBe("declined");
  });

  it("lets nobody but the holder resolve a request", async () => {
    const created = await caller(holder).proofRequests.create({ ...REQUEST, holderUserId: holder.id });
    await caller(user(2)).proofRequests.approve({ requestId: created.id });
    expect(store.state.proofRequests[0].status).toBe("pending");
  });

  it("refuses to re-resolve a request that is already settled", async () => {
    const api = caller(holder);
    const created = await api.proofRequests.create({ ...REQUEST, holderUserId: holder.id });
    await api.proofRequests.approve({ requestId: created.id });
    await api.proofRequests.decline({ requestId: created.id });
    expect(store.state.proofRequests[0].status).toBe("approved");
  });

  it("scopes the registry to the caller", async () => {
    await caller(holder).proofRequests.create({ ...REQUEST, holderUserId: holder.id });
    expect((await caller(user(3)).issuer.registry()).proofRequests).toHaveLength(0);
  });
});
