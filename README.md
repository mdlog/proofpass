# ProofPass

Private credentials on Midnight. Prove the fact, keep the rest private.

A holder proves a verifier's requirement is met — "this credential is active, unexpired,
and issued by a registered issuer" — without handing over the certificate, the legal name,
or any attribute the verifier did not ask for.

- Product requirements: [PRD.md](./PRD.md)
- Technical architecture: [ARCHITECTURE.md](./ARCHITECTURE.md)
- Demo runbook and judge Q&A: [docs/DEMO.md](./docs/DEMO.md)

## What is real, and what is not

This matters more than a feature list, so it is stated plainly (PRD §5, "Honest demo").
Seeded rows are labelled **Demo** in the UI wherever they sit next to stored ones.

| Area | Status |
|---|---|
| Midnight wallet connection | **Real.** Midnight DApp Connector API v4 against Lace, with a wallet picker, API-version filtering, and an explicit "no Midnight wallet" state. |
| Proof requests (create / approve / decline) | **Real.** Stored in MySQL behind authenticated tRPC procedures, with a consent record carrying a single-use nonce and the disclosed facts. |
| Compact contract | **Compiled and deployed.** `contracts/proofpass.compact` builds to five circuits with real prover and verifier keys, and the browser deploys it through the connected wallet. |
| On-chain transactions | **Real.** Deploy plus `registerIssuer`, `issueCredential`, `proveEligibility` and `revokeCredential` have all been run against preprod through Lace, with the resulting ledger state read back from the indexer. `revokeIssuer` is implemented and deliberately unexercised — see [Deploying the contract](#deploying-the-contract). |
| Overview counts and issuer registry health | **Real.** Credential and verification counts come from the store; the hero block height comes from the indexer the wallet names. Each shows an em dash when there is nothing to read, rather than a figure. |
| Credential cards, privacy score, policy builder | **Seeded demo data,** labelled wherever it sits beside a stored value. The privacy score and "data kept private" stay seeded because neither has a definition yet — computing them from an invented formula would be worse than saying so. |
| Hosted sign-in | **Not configured.** Without `VITE_OAUTH_PORTAL_URL` the sign-in prompt says so rather than failing silently. |

The app still never holds a key and never talks to a node: it prepares the transaction, and the
wallet signs and submits it (ARCHITECTURE §18). What it no longer stops short of is the deploy
itself — that path has been run end to end against preprod through Lace, and the address it
returns is recorded rather than logged.

## Requirements

| Tool | Version | Why |
|---|---|---|
| Node.js | 22+ | ESM, `import.meta.dirname` |
| pnpm | 10.4+ | Declared in `packageManager` |
| MySQL | 8.x | Drizzle schema targets MySQL |
| Compact toolchain | **0.31.1** | Language 0.23, runtime **0.16.0** |
| Lace wallet | Midnight-enabled | Connector API v4 |

The Compact version is not a free choice. `@midnight-ntwrk/midnight-js-protocol@4.1.1` depends on
`@midnight-ntwrk/compact-runtime@0.16.0`, and the generated contract calls
`checkRuntimeVersion('0.16.0')` on import. Toolchain 0.31.1 is the one that emits that runtime —
0.34.0 emits 0.19.0 and will not load.

```bash
compact update 0.31.1
compact list   # 0.31.1 must be the active (→) version
```

## Setup

```bash
pnpm install

# 1. Database
docker run -d --name proofpass-mysql --restart unless-stopped \
  -e MYSQL_ROOT_PASSWORD=change-me -e MYSQL_DATABASE=proofpass \
  -e MYSQL_USER=proofpass -e MYSQL_PASSWORD=change-me \
  -p 127.0.0.1:3306:3306 mysql:8
mysql -h 127.0.0.1 -uproofpass -p proofpass < drizzle/0000_sticky_shriek.sql

# 2. Contract (writes contracts/managed/ and client/public/compact/)
pnpm contracts:build

# 3. Environment
cp .env.example .env   # then fill in the values below
```

### Environment

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | `mysql://user:pass@127.0.0.1:3306/proofpass` |
| `JWT_SECRET` | yes | Signs the session cookie. Sessions are self-contained HS256 JWTs verified locally. |
| `VITE_APP_ID` | yes | Client id embedded in the session and OAuth request |
| `OWNER_OPEN_ID` | no | This openId is promoted to the `admin` role |
| `OAUTH_SERVER_URL` / `VITE_OAUTH_PORTAL_URL` | no | Hosted sign-in. Omit both and the UI says sign-in is unavailable instead of offering a dead button. |
| `MIDNIGHT_COMPACT_MODULE_PATH` | no | Absolute path to `contracts/managed/proofpass/contract/index.js` |
| `MIDNIGHT_COMPACT_ASSETS_PATH` | no | Absolute path to `contracts/managed/proofpass` |
| `MIDNIGHT_NETWORK_ID` / `VITE_MIDNIGHT_NETWORK` | no | Must match the network the wallet is on. Defaults to `preview`. |

## Running

```bash
pnpm dev            # tsx watch + Vite middleware
pnpm build          # client to dist/public, server to dist/index.js
pnpm start          # NODE_ENV=production node dist/index.js
pnpm test           # vitest
pnpm test:coverage  # vitest with v8 coverage
pnpm check          # tsc --noEmit
```

## Tests

`pnpm test` runs 91 tests across 13 files and needs no database, network, or
Compact toolchain — the generated contract module is committed, so the circuit
tests run on a clean checkout.

| Area | Where | What it covers |
|---|---|---|
| Compact circuits | `contracts/proofpass.contract.test.ts` | The six ARCHITECTURE §14 unit bullets, simulated off-chain through `@midnight-ntwrk/compact-runtime`: issuer allow-list, revocation authority, one-way status transition, block-time expiry, nonce replay, and that the holder's secret never leaves the private transcript. |
| Proof-request lifecycle | `server/routers.test.ts` | The real tRPC router against an in-memory store: auth gate, zod contracts, request → approve → verification, and the holder-only/pending-only rule. |
| Wallet negotiation | `client/src/lib/midnightWallet.test.ts` | Strict connect, explicit network discovery, declined requests. |
| Derived state | `client/src/lib/{types,activity}.test.ts` | Expiry derivation, fact labels, and the activity trail growing when a request is answered. |
| Dialogs | `client/src/components/*.test.tsx` | Consent disclosure, decline flow, validation, focus trap, Escape. |
| Shell | `client/src/pages/Home.test.tsx` | One `h1` per page, keyboard-only navigation, mobile drawer, toast feedback. |
| Motion | `client/src/styles.test.ts` | `prefers-reduced-motion` neutralises animation globally and in the consent sequence. |

CI (`.github/workflows/ci.yml`) runs `pnpm check`, the suite, and the build, and
**fails if any test is skipped** — a skipped file once hid the fact that no
contract test was running at all.

Not covered: `server/db.ts` at the SQL level (it would require a live MySQL and
would cost the suite its hermeticity), and the eight-step demo script in
`docs/DEMO.md`, which is still run by hand.

Under a process manager:

```bash
pm2 start ecosystem.config.cjs && pm2 save
```

## Deploying the contract

Done: `contracts/proofpass.compact` has been deployed to preprod from the browser through Lace.
What follows is what it takes to repeat it.

1. Request tNIGHT from the network faucet — preview:
   <https://midnight-tmnight-preview.nethermind.dev/>, preprod:
   <https://midnight-tmnight-preprod.nethermind.dev/>. Both are rate limited.
2. Register that tNIGHT for tDUST generation, natively on Midnight: in Lace open
   **Tokens** and use **Generate tDUST**. Fees are paid in DUST, not NIGHT —
   DUST is shielded and non-transferable, and a NIGHT balance only generates it
   once designated. Until the tDUST Tank leaves `Empty`, nothing can be
   submitted, however much NIGHT the wallet holds.
3. Build the Midnight.js providers. Every endpoint comes from the connected wallet itself —
   `getConfiguration()` returns `indexerUri`, `indexerWsUri`, `proverServerUri` and
   `substrateNodeUri`, and `getProvingProvider()` pairs with
   `@midnight-ntwrk/midnight-js-dapp-connector-proof-provider`.
4. Press **Deploy contract** in the issuer workspace. `client/src/lib/proofpassDeploy.ts` checks
   the DUST balance first so a wallet that cannot pay says why, then calls `deployContract` from
   `@midnight-ntwrk/midnight-js-contracts`. The returned address is written to localStorage
   immediately and then recorded in `issuers.contractAddress` against an issuer on the same
   network.

`client/src/lib/midnightProviders.ts` assembles the providers from a connected wallet. The two
interfaces that looked mismatched turned out to be the same object in different clothes: the
connector's own documentation says `balanceUnsealedTransaction` takes a serialised
`Transaction<SignatureEnabled, Proof, PreBinding>` — Midnight.js's `UnboundTransaction` — and
`submitTransaction` takes a serialised `Transaction<SignatureEnabled, Proof, Binding>`, its
`FinalizedTransaction`. So the bridge is `serialize`/`deserialize` through hex, and the
`TransactionId` that `submitTransaction` never returns comes off the transaction itself via
`identifiers()`.

The **On-chain workspace** runs the whole workflow against a deployed contract: register an
issuer, issue a credential, prove eligibility, revoke it — each a transaction the wallet signs,
each followed by reading the ledger back, because a transaction that succeeds is not by itself
evidence that state changed. It is deliberately separate from the issuer and verifier workspaces,
which still move rows in MySQL and show seeded data.

Run end to end on preprod against contract
`cb2eed75ab1b3b13ef7404db5ee49d4a0628e64d4bdb5fe4ed5e563b153f892c`, whose ledger the indexer
then reported as:

```
issuers          1   a2b527777a…056b70d8 -> ACTIVE      registerIssuer
credentials      0                                      issueCredential, then
revoked          1   5a2707d65382…0a941f0a               revokeCredential moved it here
spentNonces      1                                      proveEligibility
acceptedProofs   1                                      proveEligibility
```

`acceptedProofs` is the one that matters: the counter increments only inside `proveEligibility`,
after every one of its assertions has passed — issuer registered and active, nonce unspent,
deadline in the future, commitment present and unrevoked. A real proof was verified on chain.
The issuer id is `sha256("proofpass:issuer:northstar-academy")`, which is what makes it
reproducible from the slug alone.

`localSecretKey()` is the constraint that shapes it: `assertAuthority()` hashes it into the
registry authority, while `proveEligibility` derives the credential commitment from it as the
*holder's* secret. One private state cannot be both, so the two roles keep separate secrets under
separate private state ids, and — since `pureCircuits.credentialCommitment` is exported — the
holder computes the commitment in the browser and hands the issuer only the result. The issuer
never learns the secret behind it.

Four things a browser build needs that a Node one does not, each of which failed loudly before it
was handled:

- **A `Buffer` global.** compact-runtime, platform-js and wallet-sdk-address-format call it
  without importing it. `client/src/lib/bufferPolyfill.ts` installs it as the entry's first import.
- **A fetch that is not passed as a method.** `FetchZkConfigProvider` invokes its fetch as
  `this.fetchFunc(...)`, and cross-fetch hands over `window.fetch` unbound, so the browser refuses
  with "Illegal invocation". `ReportingZkConfigProvider` supplies one that calls the host's fetch
  plainly.
- **A private state provider.** `submitDeployTx` writes the contract address, private state and
  signing key through it *after* submitting, so without one a deploy succeeds on chain and then
  throws. In a browser `level` resolves to browser-level, so the store is IndexedDB.
- **A password that passes the storage policy.** That provider wants sixteen characters and three
  of four character classes, which a hex string does not have.

No local proof server is needed on the public testnets: the wallet's `getConfiguration()`
points at a hosted prover.

## Contract

`contracts/proofpass.compact` maps to ARCHITECTURE §8:

| Ledger field | Role |
|---|---|
| `issuers: Map<Bytes<32>, IssuerStatus>` | §8.1 registry — who may issue, and whether they still may |
| `credentials: Set<Bytes<32>>` | §8.2 vault — commitments only, never payloads |
| `revokedCredentials: Set<Bytes<32>>` | §8.3 revocation, one-way |
| `spentNonces: Set<Bytes<32>>` | §11 replay mitigation |
| `acceptedProofs: Counter` | non-identifying counter for the activity trail |

`proveEligibility(issuerId, expiresAt, nonce)` is the privacy-carrying circuit. It proves the
caller knows the secret behind a registered, unrevoked, unexpired commitment from an active
issuer, and burns the nonce — revealing no attribute of the credential.

## Layout

```
client/src/            React app: pages/, components/, lib/, contexts/
server/                Express + tRPC: routers.ts, db.ts, contractAdapter.ts, _core/
shared/                Types and constants shared across the boundary
drizzle/               Schema and migration
contracts/             proofpass.compact and its build output (gitignored)
```

## Known limitations

- `revokeIssuer` is implemented and never exercised: calling it stops the issuer from issuing
  anything further, so it sits off the workflow path.
- The issuer, verifier and holder workspaces still read and write MySQL rows, not ledger state.
  Only the On-chain workspace touches the contract.
- A circuit call needs a proof server that accepts multi-megabyte request bodies. The hosted
  preprod prover does not: it sits behind a proxy that refuses bodies over roughly 4–8 KB, while a
  call uploads its proving key — 2.7 MB for `registerIssuer` — so every call fails there as
  `TypeError: Failed to fetch`. Set `VITE_PROOF_SERVER_URI` to a local proof server
  (`tools/localnet/standalone.yml` runs one on 6300). Deploy is unaffected: it uploads no proving
  data, which is why deploying works there and calling does not.
- Fees are paid from a DUST tank that designated NIGHT refills over time, and a deploy can leave
  the NIGHT undesignated — `0 / 0 tDUST` in Lace with a NIGHT balance still showing. Re-designate
  with **Generate tDUST** before expecting the tank to refill.
- Credentials, privacy score, and the policy builder are seeded data.
- Hosted sign-in requires an OAuth server this repository does not include.
- A decline reason is shown back to the holder but not stored — `proofRequests` has no column for it.
- `pnpm contracts:build` publishes ~14 MB of proving keys into `client/public/`.

## License

MIT — see [LICENSE](./LICENSE).
