# On-chain workflow — design

**Date:** 2026-09-09
**Status:** approved, implementing

## Problem

`contracts/proofpass.compact` is deployed to preprod, but nothing calls it. The
deploy discards the `callTx` handle it is given, and `publicDataProvider` is
constructed and never queried. So the five circuits — `registerIssuer`,
`issueCredential`, `proveEligibility`, `revokeCredential`, `revokeIssuer` — have
never run against a real ledger, and the app cannot show what is on chain.

The goal is one workflow that can be run live, end to end, against the deployed
contract, and that proves each step by reading the ledger back.

## The constraint that shapes everything

`localSecretKey()` serves two roles in the same contract:

- `assertAuthority()` hashes it into `authorityKey` — the caller must be the
  registry authority for `registerIssuer`, `revokeIssuer`, `issueCredential` and
  `revokeCredential`.
- `proveEligibility` derives `credentialCommitment(issuerId, expiresAt, sk)`
  from it — the caller must be the *holder* whose commitment was issued.

One private state cannot satisfy both unless the authority is also the holder.

## Decision: two private states, one wallet

| | Storage | `privateStateId` |
|---|---|---|
| Authority secret | `proofpass:authority-secret` (existing) | `proofpass` |
| Holder secret | `proofpass:holder-secret` (new) | `proofpass:holder` |

`pureCircuits.credentialCommitment` is exported, so the holder computes the
commitment in the browser and hands the issuer only the commitment. The issuer
never learns the holder's secret — the privacy separation the product claims is
exercised, not simulated. One wallet pays every fee.

Rejected: a single identity (fast, but proves nothing about the separation) and
two browsers with two wallets (realistic, but both need DUST and the commitment
needs a transport — more to go wrong in a live demo, and it can come later).

## Decision: a separate on-chain panel

A new workspace runs the sequence and reports ledger state after each step. The
existing demo UI is untouched, so seeded data and real state never share a
surface — the repo already draws this line with `DemoTag` and the README's
honesty table.

## Values

| Value | Rule |
|---|---|
| `issuerId` | `sha256("proofpass:issuer:" + slug)`, 32 bytes. Public by design (ARCHITECTURE §6). Derived, not stored — no schema change. |
| `expiresAt` | Seconds since epoch. `kernel.blockTimeLessThan` is strict, so the deadline itself is already too late. |
| `commitment` | `pureCircuits.credentialCommitment(issuerId, expiresAt, holderSecret)`, computed in the browser. |
| `nonce` | 32 random bytes per presentation; the ledger accepts each exactly once. |

## Flow

```
connect     findDeployedContract(address, privateStateId for the role)
authority   registerIssuer(issuerId)
holder      commitment = credentialCommitment(issuerId, expiresAt, holderSk)
authority   issueCredential(issuerId, commitment)      ← only the commitment crosses
holder      proveEligibility(issuerId, expiresAt, nonce)
authority   revokeCredential(commitment)
```

After every step: `queryContractState(address)` → `ledger(state.data)` → show
`issuers`, `credentials`, `revokedCredentials` and `acceptedProofs` as the chain
reports them. Without the read-back a successful transaction is not evidence
that state changed.

## Structure

- `client/src/lib/proofpassContract.ts` — identity, commitment, connect, the five
  calls, ledger snapshot. Plain functions, testable without React, mirroring
  `proofpassDeploy.ts`.
- `client/src/components/OnChainWorkflow.tsx` — a thin consumer.
- `client/src/pages/Home.tsx` — one workspace entry.

The compiled-contract builder currently inlined in `proofpassDeploy.ts` moves to
a shared helper, since deploy and call both need it.

## Errors

The contract's own asserts are the most useful text there is — "Issuer is
already registered", "Credential has been revoked" — so they are surfaced
verbatim through `readableMessage`. Steps the ledger says cannot succeed are
disabled to avoid spending DUST on a certain failure, but the client guard never
replaces the assert.

The panel accepts a pasted contract address, for a browser whose localStorage
has been cleared.

## Testing

Unit tested: `issuerId` derivation, commitment agreement with `pureCircuits`,
holder secret persistence, ledger snapshot mapping from a fake `Ledger`, and
which steps a given snapshot allows.

Not unit tested: the five submissions, which need a node and a wallet. They stay
thin wrappers — the same boundary `defaultBridgeDeps` already draws. The proof
is the live run.

## Out of scope

No schema change, no changes to the existing demo UI, no multi-wallet flow.
`revokeIssuer` is wired but off the happy path: calling it blocks further issuing.
