# Algo Safe — Security Audit Report

## 1. Audit Metadata

**AI Model**: Claude Fable 5 (claude-fable-5)
**Provider**: Anthropic
**Audit Date**: 2026-07-16
**Commit Hash**: `c0ef2e240e27ac127cff546977f69b597b58ac95`
**Commit Date**: 2026-07-13 13:43:32 +02:00
**Previous audit**: [2026-07-12 Claude Fable 5](./2026-07-12-audit-report-ai-claude-fable-5.md) against commit `d2baaab` (contract v3.0.0). The only contract-source change since then is the v3.1.0 remediation set produced in that audit's same-session remediation, now committed.

### Contract Bytecode Hashes

Computed from the base64-decoded `byteCode.approval`/`byteCode.clear` in the ARC-56 JSON files after a fresh `pnpm build` at this commit (`pnpm run compute-bytecode-hashes` plus an equivalent pass over the validator artifact):

**AlgoSafe** (`smart_contracts/algo_safe/contract.algo.ts`):
- **Approval Program SHA256**: `0ec5f00067169dae3414cffd9f2e04d8e2a91884d7fd0eb903c31aa409da6ead` (7,043 bytes)
- **Clear Program SHA256**: `ed90f0d2da1f1d1abd773c45230651a292a90edbc12a7bf859a493a12a640ce7` (4 bytes)

**AlgoSafeTxnValidator** (`smart_contracts/algo_safe_validator/contract.algo.ts`):
- **Approval Program SHA256**: `0dd692344f80e7d5770f47bcde26c31eaaf24d45b5d177dfcbc7241742e188b1` (418 bytes)
- **Clear Program SHA256**: `ed90f0d2da1f1d1abd773c45230651a292a90edbc12a7bf859a493a12a640ce7` (4 bytes)

The validator approval hash matches the pin in `validator-hash.generated.ts` (`VALIDATOR_APPROVAL_SHA256_HEX`), which `createApplication` enforces on-chain, and `sync-validator-hash.ts` reported "up to date" during the build. The AlgoSafe approval hash matches the committed `clients/0ec5f000…/` folder and `LATEST_CONTRACT_HASH` in `src/versioned-clients.generated.ts`.

**CONTRACT_VERSION**: `BIATEC-ALGO-SAFE-v3.1.0` (`contract.algo.ts:150`) — correctly bumped from v3.0.0 at the previously audited commit, per the mandatory contract change workflow. Exactly **one** new `clients/<hash>/` folder (`0ec5f000…`) was added in the commit range since the last audit. ✔

### Build & Test Execution (fresh, this audit)

- `pnpm build` — clean; puya-ts 1.1.0 / puya 5.3.2; `check-program-size: OK — AlgoSafe approval program: 7043 bytes (gate 7800, AVM ceiling 8192, margin 1149)`; working tree unchanged after build (build is reproducible against the committed artifacts).
- `pnpm test` (Vitest, unit + e2e against a running LocalNet): **89 tests passed, 0 failed** across 4 test files (`contract.e2e.spec.ts` 81, `on-chain.e2e.spec.ts` 2, `version.spec.ts` + `get-client.spec.ts` 6). Duration ≈ 247 s. See §Appendix A for the summary.

---

## 2. Executive Summary

This audit reviews commit `c0ef2e2`, the first commit containing contract **v3.1.0** — the remediation release for the 2026-07-12 Fable-5 audit of v3.0.0. The audit (a) independently re-verified every v3.1.0 remediation against the committed code and its regression tests, and (b) performed a fresh full-file review of `contract.algo.ts` (1,520 lines), the `AlgoSafeTxnValidator` library contract, the shared types module, and the off-chain library (`src/*.ts`), plus a fresh build, bytecode-hash verification, program-size check, and full test-suite run on LocalNet.

**All prior findings are confirmed fixed at this commit**:

| Prior finding | Fix verified at | Regression test |
|---|---|---|
| M-01 — custodian guards did not bound `ACT_APPL`/`ACT_ACFG` | `_assertCustodianActions` (`contract.algo.ts:1239-1244`) enforced at `_seedGroup:476`, `_createGroup:1441`, `ADM_SET_POLICY:1315` | "custodian groups cannot be created with, or widened to, actions beyond pay/axfer" ✔ |
| L-01 — `_createGroup` accepted zero-address initial member | `contract.algo.ts:1436` | "creating a group with the zero address as initial member is rejected" ✔ |
| L-02 — `ADM_ADD_REKEYED_ADDR` accepted zero address | `contract.algo.ts:1293`; `buildMigrationRekeyPayload` throws (`src/migration.ts:279-281`) | "registering the zero address as a rekeyed address is rejected" ✔ |
| I-01 — `_createGroup` bitmask bounds | `contract.algo.ts:1437-1438` | "group creation rejects bitmask values beyond the defined ACT_*/PRIV_* bits" ✔ |
| I-04 — validator pin-rejection untested | — | "createApplication rejects an app that is not the pinned validator" ✔ |

**No Critical or High severity findings were identified in this audit.** The proposal state machine, access control (including execution-time re-checks), spending-limit and guard accounting, the validator hash-pinning architecture, and the off-chain codec/constant surface were all re-verified sound. Four new lower-severity findings were identified, all in the MBR-economics / client-tooling periphery rather than the custody core:

- **[M-01]** Terminal proposals created with a far-future `expiryRound` can never be pruned — and the library's exported `FAR_EXPIRY` constant (used throughout the README's examples) makes permanent MBR loss the default integration pattern.
- **[L-01]** A custodian group can opt the safe into arbitrary ASAs (0-amount transfers bypass the guard-existence check), enabling bounded, recoverable MBR-lock griefing by a compromised custodian.
- **[L-02]** The box-enumeration helpers cap at 10,000 boxes with no pagination; approval boxes accumulate for the life of the safe, so long-lived busy safes will eventually break migration tooling and group-detail views.
- **[I-01…I-03]** Informational: silent `nonParticipation` keyreg conversion in `algosdkTxnsToSafeTxnGroup`; a documentation wording inaccuracy about epoch invalidation; a migration edge for pre-v3.1.0 custodian groups holding now-forbidden action bits.

The compiled approval program is **7,043 / 8,192 bytes (1,149-byte margin, 14%)**, comfortably under both the AVM ceiling and the 7,800-byte CI gate.

---

## Remediation Update (2026-07-16, contract v3.2.0)

All findings from this report were remediated same-day, shipping as contract **v3.2.0** (working tree; approval hash `3f8d0cb07960bf2c8af42fb41b7d7fc2673dd831d987e80ee0e0c43fcefaa0ec`, 7,054/8,192 bytes, CI size gate green). **93/93 contract tests pass** on LocalNet (4 new regressions: split M-01 prune test, L-01 opt-in-without-guard test, 2 unit tests for I-01 in a new `src/safe-tx.spec.ts`). Frontend `tsc --noEmit` and Jest suites pass unchanged — no frontend code changes were required.

| ID | Status | Remediation |
|---|---|---|
| M-01 | **Fixed** | `pruneProposal` no longer requires past-expiry for `STATUS_EXECUTED` proposals (`contract.algo.ts:751-764`) — only `STATUS_CANCELLED` still does, kept as a deliberate review-retention window. `FAR_EXPIRY` re-documented as test/convenience-only in `src/constants.ts` and `README.md` (a cancelled proposal created with it still forfeits MBR until past-expiry). Regression tests split into an EXECUTED-immediate-prune case and a CANCELLED-still-gated case. |
| L-01 | **Fixed** | `_deductFromGuard` now asserts guard existence for `(custodianGroupId, assetId)` **before** its zero-amount early return (`contract.algo.ts:1023-1030`) — a custodian can no longer opt the safe into an unguarded ASA via a 0-amount transfer. Regression test: 0-amount opt-in rejected without a guard, succeeds once a 0-locked guard exists. `PRODUCT-DESCRIPTION.md`'s Asset Guards section documents the precondition. |
| L-02 | **Fixed (client library)** | `getApplicationBoxNames`/`listBoxNames` (`src/on-chain.ts`, `src/migration.ts`) now throw a clear, actionable error when algod's non-paginated boxes response exactly fills the request cap, instead of risking a silently truncated read. `fetchSafeCloneConfig` additionally cross-checks each group's enumerated member-box count against its on-chain `memberCount` and aborts loudly on mismatch. Indexer-backed pagination (the root-cause fix for unbounded approval-box growth) remains a follow-up — tracked as R-43, still Partially Mitigated. |
| I-01 | **Fixed** | `algosdkTxnsToSafeTxnGroup` now throws on a keyreg with `nonParticipation: true` instead of silently downgrading it to a plain go-offline. New unit tests in `src/safe-tx.spec.ts`; the existing e2e regression for keyreg mapping was updated to expect the throw. |
| I-02 | **Fixed (doc)** | `CLAUDE.md`/`PRODUCT-DESCRIPTION.md` corrected: epoch-invalidated proposals must be cancelled and re-created, never re-approved. |
| I-03 | **Fixed** | `fetchSafeCloneConfig` masks a cloned custodian group's `allowedActions` to `ACT_PAY \| ACT_AXFER` (with a logged warning) before it ever reaches `deployClonedSafe`, preventing the mid-migration `_seedGroup` revert on a pre-v3.1.0 custodian holding now-forbidden action bits. |

**Version-registry housekeeping**: `src/version.ts`'s `MODERN_ABI_CONTRACT_HASHES` gained the v3.1.0 hash (`0ec5f000…`) alongside the new v3.2.0 `LATEST_CONTRACT_HASH` and the existing v3.0.0 entry — v3.2.0 is a non-breaking hardening release over v3.1.0, so both older hashes must stay classified as "modern ABI" rather than being silently demoted to the legacy code path.

---

## 3. Scope and Methodology

**In scope** (all at commit `c0ef2e2`):

- `projects/algo-safe-contracts/smart_contracts/algo_safe/contract.algo.ts` (1,520 lines — full-file review)
- `projects/algo-safe-contracts/smart_contracts/algo_safe_validator/contract.algo.ts` (118 lines — full-file review)
- `projects/algo-safe-contracts/smart_contracts/shared/types.ts` (101 lines — full-file review)
- `projects/algo-safe-contracts/src/*.ts` — `safe-tx.ts`, `constants.ts`, `version.ts`, `validator.ts`, `on-chain.ts`, `migration.ts`, `admin.ts`, `get-client.ts`, `latest-client.ts`, `versioned-clients.generated.ts`
- `contract.e2e.spec.ts` (81 tests) — coverage mapping
- Documentation: `CLAUDE.md`, `PRODUCT-DESCRIPTION.md`, package `README.md` (spot review for v3.0.0/v3.1.0 accuracy)

**Out of scope**: `algo-safe-frontend` (except where `CLAUDE.md` documents known debt), the X402 packages, generated clients (verified for registry consistency only).

**Methodology**: diff-driven review of the changes since the previously audited commit (`git diff d2baaab..HEAD` — contract delta is exactly the v3.1.0 remediation set), followed by a from-scratch pass over the full contract against the `AI-AUDIT-INSTRUCTIONS.md` checklist: proposal-lifecycle state machine enumeration, access-control gate mapping (proposal-time vs execution-time), box-key collision analysis, two-pass inner-transaction data-flow tracing (validate → account → stage → submit), spending-limit/guard accounting including close-out live-balance paths, admin-change application matrix (all 14 change types), codec/constant drift verification between `shared/types.ts` and `src/safe-tx.ts`/`src/constants.ts`, and a fresh LocalNet build/test run.

---

## 4. Findings

### [M-01] Terminal Proposals With Far-Future Expiry Can Never Be Pruned; `FAR_EXPIRY` Makes Permanent MBR Loss the Default Pattern

**Severity**: Medium
**Status**: Open
**Component**: AlgoSafe (contract.algo.ts) + client library/docs
**File**: `smart_contracts/algo_safe/contract.algo.ts:757`, `src/constants.ts:58`, `README.md:482` (and every README example)

**Description**:
`pruneProposal` requires **both** a terminal status and a past expiry:

```ts
assert(proposal.status === STATUS_EXECUTED || proposal.status === STATUS_CANCELLED, 'proposal not terminal')
assert(Global.round > proposal.expiryRound, 'not yet expired')
```

`STATUS_EXECUTED` and `STATUS_CANCELLED` are terminal, immutable states — nothing can ever read a pruned terminal proposal's boxes again, so the past-expiry requirement adds no safety; it only delays MBR reclamation. Meanwhile the library exports `FAR_EXPIRY = 4_000_000_000n` (~350 years of rounds ahead of MainNet's current height) and the package README uses it in **every** proposal example, describing it as "a comfortably future round … provided for tests/convenience". Any proposal created with `FAR_EXPIRY` (or any far-future round) locks its proposal box, payload-chunk boxes, and admin-payload box MBR **permanently** once it reaches a terminal state.

Two adjacent facts compound the impact: (a) approval boxes are never deleted by any code path (a previously disclosed design limitation — 2026-07-06-v2 audit), and (b) proposals stranded by a membership-epoch bump (see I-02) can only ever be cancelled, then hit this same wall.

**Impact**:
No fund-loss or access-control path. Permanent, irrecoverable loss of box MBR (~10,000–40,000 µALGO per proposal depending on payload size) on every terminal proposal created with a far-future expiry — which is the documented default. This mirrors the severity rationale of prior findings R-35/R-36 ("permanent and irrecoverable" MBR loss ⇒ Medium, not Low).

**Proof of Concept**:
1. Create any proposal with `expiryRound: FAR_EXPIRY` (as in `README.md:438`).
2. Execute or cancel it.
3. `pruneProposal(pid, …)` reverts with `'not yet expired'` — and will keep reverting for ~3 centuries.

**Recommendation**:
1. In the next contract version, drop the past-expiry requirement for terminal proposals (or keep it only for `STATUS_CANCELLED` if a review-retention window is desired for cancelled-but-contested proposals; `STATUS_EXECUTED` needs no retention gate the ledger doesn't already provide). This is a one-line change; remember the mandatory `CONTRACT_VERSION` bump + single new client folder.
2. Until then, change the README/client guidance to recommend bounded expiries (e.g. current round + a few days of rounds) and re-document `FAR_EXPIRY` as test-only, with an explicit warning that it forfeits MBR reclamation.

**References**: R-35/R-36 severity precedent in `audits/RISK-REGISTRY.md`.

---

### [L-01] Custodian Groups Can Opt the Safe Into Arbitrary ASAs — 0-Amount Transfers Bypass the Guard-Existence Check

**Severity**: Low
**Status**: Open
**Component**: AlgoSafe (contract.algo.ts)
**File**: `smart_contracts/algo_safe/contract.algo.ts:1023-1031` (`_deductFromGuard`)

**Description**:
`_deductFromGuard` early-returns before checking that a guard exists:

```ts
private _deductFromGuard(custodianGroupId: uint64, assetId: uint64, amount: uint64): void {
  if (amount === Uint64(0)) return
  assert(this.assetGuards(guardKey).exists, 'no guard for custodian+asset')
  ...
}
```

A custodian group holding `ACT_AXFER` (one of the only two bits it may hold after v3.1.0) can therefore execute **0-amount asset transfers of any asset ID with no guard configured** — including the canonical ASA opt-in (0-amount self-transfer). The containment model says a custodian is bounded by admin-configured per-asset guards precisely because the custodian protocol may be compromised; opt-ins are the one value-affecting action that escapes that boundary.

**Impact**:
A compromised custodian (the feature's explicit threat model) can opt the safe into arbitrary ASAs, each locking 100,000 µALGO of the safe's balance in MBR (up to 16 per proposal, repeatable every cooldown window), and pollute the safe's holdings with spam/scam tokens. The lock is **recoverable** — any group with `ACT_AXFER` can opt back out via a close-out transfer — which bounds this to griefing rather than loss, hence Low.

**Recommendation**:
Move the guard-existence assert above the zero-amount early return, i.e. require a guard box to exist for `(custodianGroupId, assetId)` even when the deducted amount is 0. This makes "admin sets a guard (even `lockedAmount: 0`) → custodian may opt in / touch that asset" the rule, matching the containment model with negligible program-size cost. Add an e2e test: custodian 0-amount opt-in with no guard reverts; with a 0-locked guard succeeds.

---

### [L-02] Box-Enumeration Helpers Cap at 10,000 Boxes With No Pagination; Approval-Box Accumulation Makes the Cap Reachable

**Severity**: Low
**Status**: Open
**Component**: Client library (`src/migration.ts`, `src/on-chain.ts`)
**File**: `src/migration.ts:25,78-83`, `src/on-chain.ts:66,256,309`

**Description**:
`listBoxNames` (used by `fetchSafeCloneConfig` → migration), `listAssetGuards`, and `listMemberAddressesForGroup` all call `algodClient.getApplicationBoxes(appId).max(10_000)`. algod's boxes endpoint does not paginate: when an application has more boxes than `max`, the request fails (or, depending on node version/configuration, returns a bounded subset). Because **approval boxes are never deleted by any contract path** (each approval permanently adds one box) and `pruneProposal` is optional and (per M-01) often impossible, a busy safe's box count grows without bound — e.g. ~5 proposals/day × 3 approvals ≈ 5,500 boxes/year.

**Impact**:
At scale, `fetchSafeCloneConfig` (the upgrade/migration path), `listRekeyedAddresses`, `listAssetGuards`, and the frontend's group-detail member enumeration stop working for exactly the oldest, most valuable safes. If a node build were ever to truncate rather than error, `fetchSafeCloneConfig` could silently clone a group with missing members — mostly fail-closed (`_seedGroup` asserts `threshold <= memberCount`), but a silent member drop is possible when the threshold still fits. Availability/integration risk, no direct fund loss.

**Recommendation**:
1. Enumerate boxes via the indexer (`/v2/applications/{id}/boxes` with `next` token pagination) or loop algod requests with prefix filtering where possible; at minimum, detect the over-limit failure and surface a clear, actionable error.
2. In `fetchSafeCloneConfig`, cross-check each cloned group's collected member count against the group box's `memberCount` field and abort on mismatch — this converts any silent-truncation scenario into a loud failure.
3. Longer term, consider a contract path to reclaim approval-box MBR (e.g. `pruneProposal` accepting a caller-supplied approver list to delete `approvals` boxes alongside the proposal), which addresses the root growth.

---

### [I-01] `algosdkTxnsToSafeTxnGroup` Silently Converts a Permanent Non-Participation Keyreg Into a Plain Go-Offline

**Severity**: Informational
**Status**: Open
**Component**: Client library (`src/safe-tx.ts`)
**File**: `src/safe-tx.ts:391-407`

The `KeyRegTxn` payload struct has no `nonParticipation` field, so the safe cannot express Algorand's permanent non-participation opt-out. When converting a native `algosdk` keyreg with `nonParticipation: true`, the mapper classifies it `online: 0n` and silently stages a plain (reversible) go-offline instead of the requested (irreversible) opt-out. The conversion helpers' contract is to "fail loudly (not silently drop) on unsupported types" — this input is semantically unsupported and should `throw`, matching the `Unsupported transaction type` behavior. (The direction of the silent change is at least the safe one: reversible instead of irreversible.)

---

### [I-02] Documentation: Epoch-Invalidated Proposals Cannot Be "Re-Approved" — They Must Be Re-Created

**Severity**: Informational
**Status**: Open
**Component**: Documentation (`CLAUDE.md`, `PRODUCT-DESCRIPTION.md`)

`CLAUDE.md` says removing a member means pending proposals "must be re-approved from scratch". In fact both `approveProposal` (`contract.algo.ts:712-715`) and execution (`:819`) assert the group's **live** `membershipEpoch` equals the proposal's `epochAtCreation`, so after any member removal every pending proposal of that group is permanently stranded — it can only be cancelled (and pruned, subject to M-01), never approved or executed again. The behavior is correct and conservative; the documentation should say "re-created", not "re-approved", so integrators don't build a re-approval flow that cannot work.

---

### [I-03] Cloning a Pre-v3.1.0 Safe Whose Custodian Group Holds Now-Forbidden Action Bits Fails Mid-Migration

**Severity**: Informational
**Status**: Open
**Component**: Client library (`src/migration.ts`)
**File**: `src/migration.ts:239-249` (`deployClonedSafe`), `contract.algo.ts:476`

A custodian group created on a v3.0.0 safe could legally hold `ACT_APPL`/`ACT_ACFG`/`ACT_KEYREG`. `fetchSafeCloneConfig` clones `allowedActions` verbatim, so `deployClonedSafe` onto v3.1.0 reverts at `_seedGroup` with `'custodian actions limited to pay/axfer'` — after the new safe has already been deployed and funded, leaving a half-seeded, unfinalized app. Fail-closed (nothing can act on the unfinalized safe), but a confusing operator experience. Recommend `fetchSafeCloneConfig`/`deployClonedSafe` mask custodian seeds' actions to `ACT_PAY|ACT_AXFER` (with a logged warning) or pre-validate and fail before deploying anything.

---

### Verified Non-Issues (checked and confirmed sound this audit)

- **State machine**: `STATUS_EXECUTED` reachable only from `STATUS_READY` inside `_executeProposalInternal` after all checks; terminal states never re-enterable; `approvalsCount`/`READY` flip logic correct; `requiredThreshold = max(snapshot, live)` is conservative in both directions (threshold raises block execution until re-approved to the higher bar; lowers don't relax an existing proposal).
- **Execution-time re-checks**: group liveness (`active`), membership epoch, privilege (`_assertPrivilegeForChange` re-run for admin changes), pause, cooldown, and payload validation (validator C2C with the group's **live** bitmasks) are all enforced at execution time, not proposal time.
- **Two-pass inner-txn pattern**: `ensureBudget` only ever runs before `op.ITxnCreate.begin()`; pass 2 stages exactly the decoded structs pass 1 validated (same boxes, same decode); an unknown `txType` cannot reach pass 2's silent skip because the validator `err`s on it in pass 1.
- **Close-out accounting**: live-balance read for `hasClose` in pass 1 can only over-count (conservative) relative to what pass 2 sweeps, never under-count — all inner transactions move value out.
- **Box keys**: `TXG_KEY_MULT = 7 >` max slot index 6; monotonic IDs never reused; composite keys are fixed-width.
- **Guard accounting**: `_deductFromGuard` runs in pass 1 and reverts atomically with any pass-2 failure (nonzero-amount path; see L-01 for the zero-amount gap).
- **Validator architecture**: on-chain sha256 pin at `createApplication` verified against freshly compiled bytecode; the pinned program rejects update and delete (no such handlers → ARC-4 router rejection), so the one-time check is sound; rekey requires `ACT_REKEY` + `PRIV_GROUP` + non-custodian, checked in the validator with live group state.
- **Codec/constant drift**: all six `*_CODEC` ARC4 type strings in `safe-tx.ts` match `shared/types.ts` field-for-field; every `ACT_*`/`PRIV_*`/`GT_*`/`TX_*`/`ADM_*` value in `src/constants.ts` matches the contract; `MODERN_ABI_CONTRACT_HASHES` correctly contains both v3.0.0 and v3.1.0 hashes so v3.0.0 safes aren't demoted to the legacy path.
- **`VALIDATOR_DEPLOYMENTS` placeholders**: the `0n` TestNet/MainNet entries are falsy, so `resolveValidatorAppId` correctly *throws* rather than attempting to verify app 0.

---

## 5. Missing Test Scenarios

### Missing Test: Custodian 0-Amount Opt-In Without a Guard

**Description**: Custodian group with `ACT_AXFER`, no guard for asset X, proposes a 0-amount self-transfer of X (opt-in). Current behavior: succeeds (L-01). Desired post-fix behavior: reverts `'no guard for custodian+asset'`.
**Risk if Untested**: L-01 regression goes unnoticed; the containment boundary silently excludes opt-ins.
**Priority**: High (ships with the L-01 fix)

### Missing Test: Prune Blocked Forever by Far-Future Expiry

**Description**: Execute a proposal created with `FAR_EXPIRY`, then attempt `pruneProposal` — assert the `'not yet expired'` revert. Documents M-01's current behavior; flips to a positive test when M-01 is fixed.
**Priority**: Medium

### Missing Test: Clone-Config Member-Count Cross-Check

**Description**: `fetchSafeCloneConfig` on a safe where enumerated member boxes disagree with the group's `memberCount` (simulated) should fail loudly (L-02 recommendation 2).
**Priority**: Medium

### Carried over from prior audits (still open)

- Malformed/adversarial ARC4 `data` bytes vs. declared `txType` (fuzz-style; R-16 remains "Monitoring").
- Daily/monthly limit rollover exactly at the period boundary (R-10).
- Box-MBR under-funding surfaces as a clean atomic failure (R-24).
- Maximum-size payload execution (6 chunks × 16 txns aggregate at `MAX_GROUP_TXNS`) — partial coverage exists (2-slot split, append-cap regression); full-boundary execution still unexercised.

---

## 6. Documentation Gaps

### Documentation Gap: `FAR_EXPIRY` Guidance (M-01)

**Missing Information**: README presents `FAR_EXPIRY` as convenience without disclosing that terminal proposals with far-future expiry permanently forfeit box-MBR reclamation.
**User Impact**: Integrators copying README examples leak MBR on every proposal.
**Location**: `projects/algo-safe-contracts/README.md` (§ "Proposal expiry", all examples)
**Priority**: Medium

### Documentation Gap: Custodian Opt-In Scope (L-01)

**Missing Information**: Neither `PRODUCT-DESCRIPTION.md` nor `CLAUDE.md` mentions that 0-amount transfers (opt-ins) escape guard gating.
**User Impact**: Operators assume the guard boundary covers all custodian asset actions.
**Location**: `PRODUCT-DESCRIPTION.md` custodian section; `CLAUDE.md` custodian bullet.
**Priority**: Medium (or resolved by the L-01 code fix)

### Documentation Gap: Epoch Invalidation Wording (I-02)

**Missing Information**: "re-approved from scratch" → "re-created".
**Location**: `CLAUDE.md` (Membership-epoch bullet), `PRODUCT-DESCRIPTION.md` if mirrored.
**Priority**: Low

**Positive note (R-33)**: the v3.0.0/v3.1.0 documentation gap flagged last audit is closed at this commit — `CLAUDE.md` carries the v3.1.0 breaking-changes bullet and `PRODUCT-DESCRIPTION.md` now documents the validator library architecture and the v3 read-surface. The structural risk (no CI doc-sync check) remains — see R-33.

---

## 7. Security Best Practices — Compliance Assessment

- **Access control**: all proposing/approving/executing paths gate on live box-membership; privileges re-checked at execution. ✔
- **State machine**: terminal states verified one-way; no mutation of `groupId`/`payloadType`/`proposer` post-creation. ✔
- **Checks-effects-interactions (AVM form)**: all accounting (limits, guards, `lastExecutionRound`) is written before the inner-txn group is opened; failures revert atomically. ✔
- **Reentrancy**: protocol-enforced (AVM forbids app self-call, and `_validateApp` additionally rejects it explicitly). ✔
- **Program size**: 7,043 / 8,192 bytes with an enforced 7,800-byte CI gate. ✔
- **Project workflow compliance**: `CONTRACT_VERSION` bumped, exactly one new committed `clients/<hash>/` folder, `versioned-clients.generated.ts` in sync, `MODERN_ABI_CONTRACT_HASHES` extended, working tree clean after a fresh build. ✔
- **PuyaTs gotchas** (per `CLAUDE.md`): `ensureBudget` sequencing, `Uint64(arr.length)` wrapping, no runtime-`N` `Bytes(x, {length: N})`, tagged-envelope payloads, acfg create never sets `ConfigAsset`, no app create/update path — all re-verified. ✔

---

## 8. Risk Assessment

Per `AI-AUDIT-INSTRUCTIONS.md`, this section defers to **[`audits/RISK-REGISTRY.md`](./RISK-REGISTRY.md)**, updated by this audit (header, re-scores, and Change Log row dated 2026-07-16):

- **R-38** (custodian guard containment) and **R-40** (zero-address gaps) — confirmed **Mitigated** at the committed v3.1.0 code; summary rows normalized to match.
- **R-39** (validator deployment surface) — remains **Partially Mitigated**: the pin-rejection e2e test is committed, but `VALIDATOR_DEPLOYMENTS` still holds `0n` placeholders for TestNet/MainNet.
- **R-33** (doc lag) — remains **Partially Mitigated** at 12%: this release's docs are in sync, but no mechanical CI check exists yet.
- **New entries**: **R-41** (far-future-expiry prune lock / M-01), **R-42** (custodian ungoverned opt-ins / L-01), **R-43** (box-enumeration cap at scale / L-02).
- Dominant residual risks remain operational, unchanged: **R-02** key compromise (35%), **R-04** threshold misconfiguration (20%), **R-22** frontend misrepresentation (15%) — none addressable by contract code.

---

## 9. Recommendations (Prioritized)

1. **Fix L-01** (guard-existence before the zero-amount early return) — smallest change, closes the last gap in the custodian containment model. Bundle with its e2e test.
2. **Fix M-01** in the same contract release (terminal proposals prunable regardless of expiry), and update README expiry guidance immediately (doc change needs no release).
3. **Harden the enumeration helpers (L-02)**: memberCount cross-check in `fetchSafeCloneConfig` now; indexer pagination as follow-up.
4. **Make `algosdkTxnToSafeTxn` throw on `nonParticipation: true`** (I-01).
5. **Sanitize or pre-validate custodian action bits in clone tooling** (I-03).
6. **Populate `VALIDATOR_DEPLOYMENTS`** after the first TestNet/MainNet validator deployments (R-39).
7. **Add the CI doc-sync check** (grep docs for `CONTRACT_VERSION`) to close R-33 structurally.

---

## 10. Testing Recommendations

See §5. Priorities: the L-01 regression test ships with its fix; the M-01 behavior test documents the current limitation; carried-over fuzz (R-16), period-boundary (R-10), MBR-underfunding (R-24), and full 16-txn boundary-execution scenarios remain worthwhile additions.

---

## 11. Compliance and Standards

- **ARC-4** ABI encoding/routing: compliant (typed clients generated from ARC-56; tagged-envelope payloads are plain ARC-4 tuples).
- **ARC-28** events: emitted for every state mutation reviewed (group/member/proposal/guard/pause lifecycle).
- **ARC-56** app spec: generated and committed per version under `clients/<hash>/`.
- **AVM constraints**: program size, inner-txn limits, box MBR semantics, and consensus resource limits (`MAX_APP_*`) verified against current protocol values (R-26 monitoring note stands).

---

## 12. Appendix

### A. Test Execution Record

- Environment: Windows 11, Docker Desktop 29.6.1, AlgoKit LocalNet (algod + indexer running; indexer last round 12,186 at start).
- Commands: `pnpm build` then `pnpm test` from `projects/algo-safe-contracts/` (Vitest `--coverage`).
- Result: **4 test files passed, 89/89 tests passed, 0 failed**, duration ≈ 247 s. No test-harness anomalies observed; the e2e spec deployed the freshly compiled v3.1.0 contract and pinned validator on LocalNet for every scenario.
- Program size (from the build's `check-program-size` gate): **7,043 bytes** approval program; gate 7,800; AVM ceiling 8,192; margin 1,149 bytes.

### B. Files Reviewed

| File | Lines | Review depth |
|---|---|---|
| `smart_contracts/algo_safe/contract.algo.ts` | 1,520 | Full |
| `smart_contracts/algo_safe_validator/contract.algo.ts` | 118 | Full |
| `smart_contracts/shared/types.ts` | 101 | Full |
| `src/safe-tx.ts` | 433 | Full |
| `src/on-chain.ts` | 389 | Full |
| `src/migration.ts` | 286 | Full |
| `src/version.ts` / `src/validator.ts` / `src/constants.ts` / `src/admin.ts` / `src/get-client.ts` / `src/latest-client.ts` | ~360 | Full |
| `contract.e2e.spec.ts` | 3,795 | Test-name mapping + targeted reads |
| `CLAUDE.md` / `PRODUCT-DESCRIPTION.md` / `README.md` | — | Targeted (version accuracy, new-surface docs) |

### C. Verification Notes / Limitations

- The e2e suite runs against LocalNet, not TestNet/MainNet; no deployed non-local instance was audited (none is registered — `VALIDATOR_DEPLOYMENTS` is still placeholder-only).
- TEAL-level review of the compiled output was limited to size/hash verification (compiler correctness is tracked as R-27).
- Frontend code was out of scope beyond documented integration debt (R-22).
- L-02's algod over-limit behavior (error vs. truncation) is version-dependent; the recommendation is robust to either behavior, but the exact failure mode on a given node build was not empirically exercised in this audit.
