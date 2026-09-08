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
| Compact contract | **Compiled, not deployed.** `contracts/proofpass.compact` builds to five circuits with real prover and verifier keys; the server constructs a genuine `CompiledContract`. |
| On-chain transactions | **None yet.** Deployment needs tDUST for fees — see [Deploying the contract](#deploying-the-contract). |
| Credentials, privacy score, issuer registry health, policy builder | **Seeded demo data.** |
| Hosted sign-in | **Not configured.** Without `VITE_OAUTH_PORTAL_URL` the sign-in prompt says so rather than failing silently. |

The Midnight adapter is therefore a **prepared** adapter, not a submitting one: it loads the
generated module, validates circuits against it, and stops short of claiming a transaction was
sent (ARCHITECTURE §20).

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
pnpm dev     # tsx watch + Vite middleware
pnpm build   # client to dist/public, server to dist/index.js
pnpm start   # NODE_ENV=production node dist/index.js
pnpm test    # vitest
pnpm check   # tsc --noEmit
```

Under a process manager:

```bash
pm2 start ecosystem.config.cjs && pm2 save
```

## Deploying the contract

Not done yet, and the reason is concrete: the wallet's DUST balance is zero, so nothing can pay
transaction fees.

1. Fund the wallet at <https://faucet.preprod.midnight.network/>.
2. Build the Midnight.js providers. Every endpoint comes from the connected wallet itself —
   `getConfiguration()` returns `indexerUri`, `indexerWsUri`, `proverServerUri` and
   `substrateNodeUri`, and `getProvingProvider()` pairs with
   `@midnight-ntwrk/midnight-js-dapp-connector-proof-provider`.
3. Call `deployContract` from `@midnight-ntwrk/midnight-js-contracts`, then store the returned
   address in `issuers.contractAddress` (the column already exists).

The provider packages are **not installed yet** and there is no `contracts:deploy` script —
this path is documented, not implemented, because it cannot be exercised without funds.

No local proof server is needed on preprod: the wallet points at a hosted prover.

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

- No on-chain transaction has been made; the contract is compiled but not deployed.
- Credentials, privacy score, and the policy builder are seeded data.
- Hosted sign-in requires an OAuth server this repository does not include.
- A decline reason is shown back to the holder but not stored — `proofRequests` has no column for it.
- `pnpm contracts:build` publishes ~14 MB of proving keys into `client/public/`.

## License

MIT — see [LICENSE](./LICENSE).
