# ProofPass — demo runbook, video script, and judge Q&A

## 0. Before you record

```bash
docker start proofpass-mysql
pnpm build && pm2 restart proofpass-dashboard   # or: pnpm dev
```

Checklist:

- Lace is installed and **on the same Midnight network** as `MIDNIGHT_NETWORK_ID`.
- A session exists (see [Signing in during the demo](#signing-in-during-the-demo)).
- The Proof requests list holds at least one seeded row and one stored row, so the **Demo**
  label is visible next to a real one.
- Browser zoom at 100%, window ≥ 1280px wide.

### Signing in during the demo

Hosted OAuth is not configured, so mint a local session instead of clicking sign-in:

```bash
node --input-type=module -e "
import { SignJWT } from 'jose'; import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('.env','utf8').split('\n')
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const jwt = await new SignJWT({ openId: env.OWNER_OPEN_ID, appId: env.VITE_APP_ID, name: 'Demo' })
  .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
  .setExpirationTime(Math.floor(Date.now()/1000) + 86400)
  .sign(new TextEncoder().encode(env.JWT_SECRET));
console.log(jwt);"
```

Then in the browser console on the app origin:

```js
document.cookie = `app_session_id=${THE_JWT}; path=/; max-age=86400; SameSite=Lax`;
```

The matching `users` row must exist:

```sql
INSERT INTO users (openId, name, role) VALUES ('<OWNER_OPEN_ID>', 'Demo', 'admin')
ON DUPLICATE KEY UPDATE name = VALUES(name);
```

> This is a local development shortcut, not a product feature. Rotate `JWT_SECRET` to revoke it,
> and never ship it.

## 1. Demo path (4 minutes)

| # | Action | What to say | What the judge should see |
|---|---|---|---|
| 1 | Open **Overview** | "One dashboard for a holder. Everything here is scoped to consent." | Privacy score, credentials, pending requests |
| 2 | **Connect wallet** → lace | "Real Midnight DApp Connector, API v4. We list every provider and its version rather than silently grabbing the first one." | Wallet picker with `lace · API v4.0.1 · io.lace.wallet` |
| 3 | *(if the network is wrong)* click **Find it** | "The wallet refuses a network mismatch and will not say which network it is on. Rather than making you guess through four buttons, we ask — but only when you tell us to." | Connects, chip and footer switch to the real network |
| 4 | **Verifier workspace** → **Create proof request** | "A verifier asks for facts, not documents. These three are the ones the architecture fixes: completion status, cohort, issuer." | Modal with fact chips, live validation |
| 5 | Submit | "That request is now in MySQL, addressed to the holder." | Toast, request appears at the top of the list **without** a Demo tag |
| 6 | **Proof requests** → **Review** | "Before approving, the holder sees exactly what is shared and what stays private." | "You will share" vs "Stays private" |
| 7 | **Approve proof** | "The approval stores a single-use nonce and the disclosed facts — that is the replay protection from our threat model." | Status flips to Approved |
| 8 | **Activity** | "The trail grew from the action you just watched. The seeded rows are labelled Demo — we do not pass fixtures off as real." | New entries at the top, Demo tags below |
| 9 | Terminal: `cat contracts/proofpass.compact` | "And this is the part that is not a mock." | Contract source |
| 10 | **Issuer workspace** → **Issue credential** | "The generated module is loaded in the browser and the circuit name is checked against the compiled contract." | Toast: `proofpass.issueCredential validated at preprod` |

## 2. Video script (2:30)

**0:00–0:20 — the problem.**
"To prove you finished a bootcamp, you upload the whole certificate. The verifier only needed one
fact, but now they hold your name, your dates, your document — forever. ProofPass sends the fact
and nothing else."

**0:20–0:50 — the holder.**
Overview, then a proof request. "A verifier asks for completion status and issuer. Before anything
moves, the holder sees exactly what is shared and what stays private."

**0:50–1:20 — consent is real.**
Approve. "That approval is stored with a single-use nonce and the list of disclosed facts. Replay
the presentation and the contract rejects it."

**1:20–2:00 — the contract.**
Show `proveEligibility`. "The holder proves they know the secret behind a registered, unrevoked,
unexpired commitment from an active issuer. Five circuits, real prover and verifier keys, compiled
with Compact 0.31.1. No attribute of the credential is revealed — the ledger only ever sees hashes."

**2:00–2:30 — honest close.**
"The wallet connection is real. The persistence is real. The contract compiles and the server
builds a real CompiledContract. What we have not done yet is deploy — that needs tDUST, and we would
rather tell you that than show you a fake transaction hash."

## 3. Judge Q&A

**Is this actually zero-knowledge, or a database with a nice UI?**
Both layers are real and separable. `proveEligibility` proves knowledge of the secret behind a
commitment without revealing the credential's attributes; the ledger stores only hashes. The MySQL
side stores the *request* workflow — verifier name, purpose, requested fact names — never attribute
values, keys, or payloads.

**Why is nothing deployed?**
The wallet's DUST balance is zero, so no transaction can pay fees. Everything up to submission is
built and verified: five compiled circuits, a server-side `CompiledContract`, and a browser that
loads the generated module and validates circuits against it.

**Why Compact 0.31.1 and not the newest?**
`midnight-js-protocol@4.1.1` depends on `compact-runtime@0.16.0`, and the generated module calls
`checkRuntimeVersion('0.16.0')`. Toolchain 0.34.0 emits 0.19.0 and would not load. The version is a
consequence of the SDK, not a preference.

**What stops a replay of an old presentation?**
`spentNonces` in the contract, and the unique `verificationKey` on the stored consent record. A
nonce is accepted exactly once at both layers.

**Can a revoked credential still prove eligibility?**
No. `revokeCredential` moves the commitment out of `credentials` into `revokedCredentials`, and
`proveEligibility` asserts against both. Revocation is one-way on this path.

**What is still demo data?**
Credentials, privacy score, issuer registry health, and the policy builder. Every seeded row is
labelled **Demo** in the UI next to stored ones.

**What would you do with another week?**
Deploy to preprod and show a transaction hash; wire issuing and revocation through the wallet
rather than only preparing them; and move credentials onto the same stored path the proof requests
already use.
