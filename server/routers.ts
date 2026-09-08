import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  createIssuer,
  createProofRequest,
  listIssuerRegistry,
  recordVerification,
  saveWalletConnection,
  setProofRequestStatus,
  updateIssuerContract,
} from "./db";
import { getCompactArtifactStatus, validateCompiledContract } from "./contractAdapter";

const networkId = z.enum(["undeployed", "mainnet", "preview", "preprod"]);

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  issuer: router({
    registry: protectedProcedure.query(({ ctx }) => listIssuerRegistry(ctx.user.id)),
    create: protectedProcedure
      .input(z.object({
        slug: z.string().trim().min(3).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        displayName: z.string().trim().min(2).max(180),
        did: z.string().trim().max(320).optional(),
        networkId,
        contractAddress: z.string().trim().max(180).optional(),
      }))
      .mutation(({ ctx, input }) => createIssuer(ctx.user.id, input)),
    attachContract: protectedProcedure
      .input(z.object({ issuerId: z.number().int().positive(), contractAddress: z.string().trim().min(10).max(180) }))
      .mutation(({ ctx, input }) => updateIssuerContract(ctx.user.id, input.issuerId, input.contractAddress)),
  }),

  wallet: router({
    saveConnection: protectedProcedure
      .input(z.object({
        providerId: z.string().trim().min(1).max(140),
        providerName: z.string().trim().min(1).max(180),
        walletAddress: z.string().trim().min(4).max(220),
        networkId: z.string().trim().min(1).max(32),
      }))
      .mutation(({ ctx, input }) => saveWalletConnection(ctx.user.id, input)),
  }),

  contract: router({
    artifactStatus: protectedProcedure.query(() => getCompactArtifactStatus()),
    validateArtifacts: protectedProcedure.mutation(() => validateCompiledContract()),
  }),

  proofRequests: router({
    create: protectedProcedure
      .input(z.object({
        requestKey: z.string().trim().min(6).max(180),
        verifierName: z.string().trim().min(2).max(180),
        purpose: z.string().trim().min(2).max(1000),
        requestedAttributes: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
        expiresAt: z.coerce.date(),
        holderUserId: z.number().int().positive().optional(),
        issuerId: z.number().int().positive().optional(),
      }))
      .mutation(({ ctx, input }) => createProofRequest(ctx.user.id, { ...input, requestedAttributes: JSON.stringify(input.requestedAttributes) })),
    approve: protectedProcedure
      .input(z.object({ requestId: z.number().int().positive() }))
      .mutation(({ ctx, input }) => setProofRequestStatus(ctx.user.id, input.requestId, "approved")),
    decline: protectedProcedure
      .input(z.object({ requestId: z.number().int().positive() }))
      .mutation(({ ctx, input }) => setProofRequestStatus(ctx.user.id, input.requestId, "declined")),
  }),

  verification: router({
    record: protectedProcedure
      .input(z.object({
        proofRequestId: z.number().int().positive(),
        holderUserId: z.number().int().positive().optional(),
        verificationKey: z.string().trim().min(6).max(180),
        status: z.enum(["verified", "failed", "revoked"]),
        transactionId: z.string().trim().max(220).optional(),
        resultSummary: z.string().trim().max(1000).optional(),
      }))
      .mutation(({ ctx, input }) => recordVerification(ctx.user.id, input)),
  }),
});

export type AppRouter = typeof appRouter;
