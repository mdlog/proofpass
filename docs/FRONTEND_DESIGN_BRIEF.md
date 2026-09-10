# ProofPass — frontend design brief

A prompt for an AI design model. It exists so the design is drawn against data
that actually exists. Every field below is real: it has a source, a type, and a
state where it is absent. Nothing here is aspirational.

---

## 1. Your task

Redesign the frontend of ProofPass. Produce a visual and interaction design that
presents the data in section 5 clearly and professionally, at desktop widths
(≥1280px) with a working responsive story down to 390px.

You are designing **for the data that exists**. If a surface below lists four
fields, design for four. Do not invent a fifth, and do not design a chart for a
series that has no source.

---

## 2. What the product is

A person holds a credential — a bootcamp certificate, a licence, a membership.
A company wants to know one fact about it: *is it valid?*

Today that means sending the whole document: name, date of birth, address, ID
number, all of it, to answer a yes/no question.

ProofPass replaces the document with a proof. The issuer publishes a hash. The
holder proves they know the secret behind it. The verifier gets an answer they
can check themselves on a public ledger — and no attribute ever reaches that
ledger or the verifier.

Three parties, and this is the spine of the whole interface:

| Party | Holds | Does |
|---|---|---|
| **Issuer** (a bootcamp) | the authority key | registers itself, issues credentials, revokes them |
| **Holder** (a person) | their own secret | computes a commitment, proves eligibility |
| **Verifier** (a company) | nothing | issues a challenge, checks the ledger |

Only two values ever cross between them: a **commitment** and a **challenge**.
Both are public 32-byte hashes. Neither can be reversed into a secret.

Product promise: **Prove the fact. Keep the rest private.**

---

## 3. Non-negotiable constraints

**Stack.** React 19 + TypeScript, Vite, plain CSS in one stylesheet
(`client/src/index.css`), `lucide-react` icons, `sonner` toasts, Radix
primitives available. No CSS framework migration, no component library swap, no
new build tooling.

**Existing type scale.** Space Grotesk for display, DM Sans for body. You may
propose a change, but justify it — the current pairing is coherent and a second
visual language layered on a consistent one reads as less professional, not more.

**Light and dark.** Both are implemented and switchable. Every colour you specify
needs both values.

**Accessibility.** Exactly one `<h1>` per page. Every control reachable by
keyboard, every icon-only button labelled. A `prefers-reduced-motion: reduce`
block must neutralise animation and transition globally — this is enforced by a
test.

**The honesty rule — the most important constraint here.**

This product's credibility is its whole value. The codebase enforces a rule: a
figure is either read from a real source, or it is visibly marked as seeded demo
data (a `DemoTag` badge), or it is absent (an em dash). There is no fourth
option.

Concretely, this has already been enforced by removing:

- a "Privacy score 92/100" that measured nothing
- a "Data kept private 86%" with no definition
- a bar chart of eight hardcoded heights, carrying no label
- a hardcoded wallet address `midnight1q…4r8x` shown while a real session existed
- a "Receive credential" button promising an invite link that does not exist
- a permanent "Demo mode" badge that stopped being true

**Do not reintroduce any of these, in any form.** No sparklines without a series,
no percentages without a numerator, no trend arrows without a comparison, no
avatars without people, no "+12.4% from last month" without a last month. If a
layout looks empty, the honest answer is an empty state — not a filler figure.

---

## 4. Information architecture

Two nav groups today. The distinction confuses people and you may restructure it,
but the underlying truth must survive:

**Workspace** — Overview, Credentials, Proof requests, Activity, Settings.
Reads and writes a database. Real, but never touches the blockchain.

**Roles** — Issuer workspace, Verifier workspace, On-chain workflow.
Only **On-chain workflow** reaches the contract. It is marked `Live`. Issuer and
Verifier workspaces are still largely demo surfaces.

A user must be able to tell, without reading documentation, which surfaces act on
a blockchain and which act on a database.

---

## 5. Data inventory

Every surface, every field, its type, source, an example, and what shows when it
is absent. `—` means an em dash is rendered.

### 5.1 Global chrome

| Field | Type | Source | Example | Absent |
|---|---|---|---|---|
| Account name | string \| null | session | `Demo operator` | `Not signed in` |
| Current page | enum | router | `On-chain workflow` | — |
| Wallet status | bool | wallet session | `Wallet connected` | `No wallet` |
| Network label | enum | localStorage | `Midnight preprod` | defaults to `preview` |
| Nav counts | number? | database | `3` | badge hidden |

Networks are exactly: `undeployed`, `mainnet`, `preview`, `preprod`.

### 5.2 Overview

| Field | Type | Source | Example | Absent |
|---|---|---|---|---|
| Active credentials | number | `credentials` rows | `1` | `—` |
| Total credentials | number | `credentials` rows | `1` | `none stored yet` |
| Proofs shared | number | `verifications` rows | `1` | `—` |
| Attributes on chain | literal `0` | structural fact | `0` | never absent |
| Block height | number | indexer GraphQL | `2,480,691` | line hidden entirely |
| Attributes disclosed | number | consent records | `2` | `—` |
| Attributes requested | number | proof requests | `2` | `—` |
| Attributes withheld | number | computed | `0` | `—` |
| Proof request list | array | database | see 5.4 | seeded rows, badged |

`Attributes on chain: 0` is not an estimate. The contract's ledger fields are
`Bytes<32>` maps, sets and a counter — an attribute cannot be stored there.

`withheld` is always `0` in this build: approving discloses every requested
attribute. Design must not present this as "minimisation achieved".

### 5.3 Credentials

Per card:

| Field | Type | Example | Notes |
|---|---|---|---|
| title | string ≤180 | `Bootcamp completion` | issuer-supplied |
| issuer | string ≤180 | `Northstar Academy` | `Unknown issuer` if the row is gone |
| status | enum | `Active` \| `Expiring soon` \| `Revoked` | |
| issued | date | `09 Sep 2026` | |
| expires | date \| null | `09 Sep 2027` | `no expiry` |
| credentialKey | 64-char hex | `5a2707d653…0a941f0a` | **stored credentials only** |
| seeded | bool | — | drives the Demo badge |

The commitment is what makes a card checkable on a public ledger. A seeded card
has none. Design must make that difference visible — this is the single strongest
signal of a real credential in the product.

Page-level: a summary line stating the split, e.g. `1 stored credential`, or
`No stored credentials yet · 4 seeded cards below`.

### 5.4 Proof requests

| Field | Type | Example | Notes |
|---|---|---|---|
| verifier | string ≤180 | `Northstar Academy` | |
| purpose | text | `Confirm bootcamp completion` | can be a sentence or two |
| requestedAttributes | string[] | `["completion_status","issuer"]` | typically 1–5 |
| status | enum | `Pending` \| `Approved` \| `Declined` \| `Expired` | |
| expires | timestamp | `in 6 days` | |
| seeded | bool | — | badge |

Approval writes a consent record: a single-use nonce (uuid), a consent version,
and the disclosed attribute list. The approval dialog shows "You will share"
against "Stays private". **There is currently no way to deselect an attribute** —
if you design checkboxes, say clearly in your notes that it needs building.

### 5.5 Activity

| Field | Type | Example | Notes |
|---|---|---|---|
| title | string | `Proof approved` | |
| detail | string | `Northstar Academy · consent recorded` | |
| time | relative | `2 min ago` | |
| type | enum | `approved` \| `revoked` \| `pending` | drives the icon |
| seeded | bool | — | badge |
| Proofs shared | number | `1` | from verifications |
| Daily trend | number[8] | `[0,0,1,0,0,0,0,0]` | counted from `verifiedAt` |

The trend is genuinely sparse — often one non-zero bucket. **Do not normalise it
into something that always looks busy.** A near-empty chart is the honest answer.

### 5.6 Settings

| Field | Type | Source |
|---|---|---|
| Dark mode | bool | localStorage, real |
| Midnight network | enum ×4 | localStorage, real |
| Connected wallet address | string | wallet session, `mn_addr_…x2pptu` |
| Wallet provider name | string | `Lace` |
| Wallet network | enum | — |

Three privacy rows are **statements, not switches** — properties of the build:
the consent screen cannot be skipped; activity never carries attributes; the
wallet signs because the app holds no key. Design them as facts. Rendering them
as toggles implies the guarantees are optional, which is the opposite of the
product's claim.

There is no notification system. Do not design one.

### 5.7 On-chain workflow — the centrepiece

The only surface that touches the blockchain. Three roles, one contract.

**Contract**

| Field | Type | Example | Absent |
|---|---|---|---|
| Contract address | 64-char hex, editable | `cb2eed75ab…153f892c` | empty, with guidance |
| Network | enum | `preprod` | — |

**Ledger state** — read back after every action, this is the evidence:

| Field | Type | Example |
|---|---|---|
| This issuer's status | enum | `ACTIVE` \| `REVOKED` \| `UNREGISTERED` |
| Registered issuers | number | `1` |
| Credentials in vault | 64-char hex[] | `1` |
| Revoked credentials | 64-char hex[] | `1` |
| Accepted proofs | bigint | `1` |
| Spent challenges | 64-char hex[] | `2` |
| Authority hash | 64-char hex | `653ed89c35…5b02faf7` |

**Issuer column** (authority key)

| Field | Type | Example |
|---|---|---|
| Issuer slug | string, editable, autocompletes from registry | `northstar-academy` |
| Derived issuer id | 64-char hex, read-only | `a2b527777a…056b70d8` |
| Registry match | string | `Recorded against Northstar Academy.` |
| Credential title | string, editable | `Bootcamp completion` |
| Holder's commitment | 64-char hex, pasteable | empty = use own |
| Actions ×3 | button + state + reason | Register · Issue · Revoke |

**Holder column** (holder key)

| Field | Type | Example |
|---|---|---|
| My commitment | 64-char hex + copy | `d1ea783d50…4a9d297b` |
| Valid until | timestamp | `2026-09-10 16:30Z` |
| Challenge to prove with | 64-char hex, pasteable | empty = fresh nonce |
| Action ×1 | button + state + reason | Prove eligibility |

**Verifier column**

| Field | Type | Example |
|---|---|---|
| Challenge | 64-char hex + generate + copy | `7f3a…` |
| On-chain status | enum | `used` \| `not used yet` \| `read the ledger` |

`used` is the verifier's entire check: the challenge *they* issued now appears in
the ledger's spent list. Give this moment real weight — it is the payoff of the
whole product, and currently it is a small line of text.

**Every action carries a reason when it is unavailable**, in the contract's own
words: `Issuer is already registered`, `Credential has been revoked`,
`Credential has expired`, `No such credential for this issuer and expiry`,
`Issuer may no longer issue credentials`. These are not errors — they are the
chain describing its state. Design them as information.

**Diagnostics** (secondary, currently collapsed):

| Field | Type | Example |
|---|---|---|
| DUST balance / cap | bigint pair | `0 of 0` |
| Network | enum | `preprod` |
| Prover | URL | `https://proofpass.example/proof-server` |
| Indexer | URL | `https://blockfrost.lw.iog.io/midnight-preprod/` |
| Node | URL | `https://blockfrost.lw.iog.io/midnight-preprod-rpc/` |

---

## 6. States every surface must have

Not decoration. Each of these is reachable today and several take **30–90
seconds**, which makes the waiting state a real design problem, not a spinner.

1. **Signed out** — database surfaces show seeded, badged data.
2. **No wallet** — on-chain actions disabled, with the reason visible. A disabled
   control that does not say why reads as a broken page; this cost real debugging
   time before it was fixed.
3. **Wallet connected, no funds** — fees are paid in DUST, which regenerates over
   time. `0 of 0` is common and is not an error.
4. **Empty** — nothing stored yet. Say so; never fill with invented rows.
5. **Working** — proving takes 30–90 seconds and uploads a 2.7 MB key. Progress
   must feel accounted for.
6. **Failed** — surface the contract's own message verbatim.
7. **Succeeded** — an action changed ledger state. Show what changed, not just
   that something did.

---

## 7. Values you will be laying out

Design for these shapes; they are unavoidable and they break naive layouts:

- **64-character hex** appears everywhere. Needs truncation with the full value
  available on hover or copy. Monospace is appropriate.
- **Long URLs** in diagnostics, unbreakable.
- **bigints** for counters and balances — no decimal formatting.
- **Wallet addresses** ~60 chars, prefixed `mn_addr_…` or `mn_shield-…`.
- **Sparse counts** — most numbers are 0, 1, or 2. This app will not look busy.
  Design for a real, quiet dataset, not a dashboard mock full of activity.

---

## 8. What does not exist — do not design for it

- Notifications, or any inbox
- Search results (the palette exists but returns navigation only)
- Multi-user, teams, sharing, or roles beyond the three above
- Credential images, logos, or issuer branding
- Historical trends beyond 8 days of verifications
- Attribute-level selective disclosure (not built; flag it if you design it)
- Any monetary value, price, or fee in currency
- Export, print, or PDF
- Onboarding or empty-state illustrations of features that do not ship

---

## 9. Deliverable

1. A visual direction: type scale, colour tokens for light **and** dark,
   spacing, elevation, motion — as CSS custom properties.
2. Layouts for: Overview, Credentials, Proof requests, Activity, Settings, and
   the On-chain workflow. The last one matters most.
3. The seven states in section 6, shown at least once each.
4. The approval dialog, which is where consent happens and where the product's
   claim is most visible.
5. Notes on anything you designed that needs data or a feature that does not yet
   exist, so it is not mistaken for something ready to build.

Judge your result by one question: **can someone who has never seen this app tell
which numbers came from a blockchain, which came from a database, and which are
demo data — without being told?**
