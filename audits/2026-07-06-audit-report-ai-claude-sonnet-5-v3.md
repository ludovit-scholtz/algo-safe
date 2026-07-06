# Algo Safe — AI Security Audit Report (Follow-Up v3, Fix-and-Verify)

**AI Model**: Claude Sonnet 5 (claude-sonnet-5)
**Provider**: Anthropic
**Audit Date**: 2026-07-06
**Commit Hash**: `9461fe677926e6abec7fa3e48e408bc891072e09`
**Commit Date**: 2026-07-06T20:56:40+02:00
**Prior Audits**:
- [`2026-07-06-audit-report-ai-claude-sonnet-5.md`](./2026-07-06-audit-report-ai-claude-sonnet-5.md) (commit `28cc9d1`, v1.2.0)
- [`2026-07-06-audit-report-ai-claude-sonnet-5-v2.md`](./2026-07-06-audit-report-ai-claude-sonnet-5-v2.md) (commit `181a64a`, v1.3.0)
- [`2026-07-06-audit-report-ai-claude-fable-5.md`](./2026-07-06-audit-report-ai-claude-fable-5.md) (base commit `385b43a`, v1.3.1 → fixes applied to working tree as v1.4.0)

This is a **fresh, from-scratch follow-up audit** of the current `HEAD` (`9461fe6`), which is the **committed** form of the fixes the fable-5 audit applied to its working tree. This report independently re-verifies those fixes are correctly and completely committed, then extends the review to find issues not previously reported — including one new Medium-severity denial-of-service finding that was **empirically confirmed against a live LocalNet deployment of this exact commit's bytecode**, and then fixed in this same pass.

**This is now also a fix-and-verify pass**: at the requester's direction, [M-03], [L-04], and [L-05] below have all been **fixed in the working tree** (contract, off-chain library, and documentation respectively) after this audit found them. See "Commit Status" and each finding's updated status.

### Commit Status

The contract, test, library, and documentation changes described in this report exist in the **working tree** at the time of writing but have **not been committed**. Before deploying:
1. Review the diff (`contract.algo.ts`, `contract.e2e.spec.ts`, `src/on-chain.ts`, `CLAUDE.md`, and the regenerated `artifacts/`/`clients/`/`src/versioned-clients.generated.ts`/`src/latest-client.ts` files).
2. Commit as a single change (the workflow's "one new client folder per commit" rule is already satisfied — only `clients/e3892f8c.../` is new and untracked).
3. Re-deploy to any test/staging environment before mainnet.

### Contract Bytecode Hashes

**Before this pass's fixes** (commit `9461fe6`, v1.4.0):
- **Approval Program SHA256**: `562dab8a2d92d57665e928ceb3b1b4db350f74449c645f805f6e8227004140fc`
- **Clear Program SHA256**: `ed90f0d2da1f1d1abd773c45230651a292a90edbc12a7bf859a493a12a640ce7`

This matched `LATEST_CONTRACT_HASH` in `src/versioned-clients.generated.ts` at the start of this audit, and `pnpm build` reproduced the already-committed `clients/562dab8a.../` folder byte-for-byte before any fix was applied — confirming no drift between the fable-5 audit's "working tree" and what was actually committed as `9461fe6`.

**After this pass's fixes** (working tree, v1.4.1), generated via `pnpm run compute-bytecode-hashes` from a fresh `pnpm build`:
- **Approval Program SHA256**: `e3892f8ccd5dc96059f48bf6f5cfaa59b1f224701217279e634f690248156784`
- **Clear Program SHA256**: `ed90f0d2da1f1d1abd773c45230651a292a90edbc12a7bf859a493a12a640ce7` (unchanged — trivial clear-state program)

**Contract version string**: bumped `BIATEC-ALGO-SAFE-v1.4.0` → `v1.4.1` (`contract.algo.ts:104`) for this fix set, per `CLAUDE.md`'s mandatory contract-change workflow. Exactly one new `clients/<hash>/` folder (`clients/e3892f8c.../`, 7 files) was generated; it is currently **untracked** (`git status --short` shows `??`), pending commit. No previously committed client folder was touched or deleted.

**Compiled approval program size**: 6,235 bytes / 8,192-byte AVM limit (margin: **1,957 bytes, ~24% headroom**). Up from 6,215 bytes before this pass — the two new `cooldownRounds` bound asserts added 20 bytes. Healthy margin retained.

### Test Suite Execution

**Before fixes** (fresh run against commit `9461fe6`, unmodified):

```
pnpm build   # exit 0 — reproduces the committed clients/562dab8a.../ folder exactly
pnpm test    # vitest run --coverage
```

```
 Test Files  4 passed (4)
      Tests  46 passed (46)
   Duration  62.08s
```

No failures. Breakdown: `contract.e2e.spec.ts` (38 tests), `src/on-chain.e2e.spec.ts` (2 tests), `src/get-client.spec.ts` (4 tests), `src/version.spec.ts` (2 tests) = 46, matching the fable-5 report exactly — confirms commit `9461fe6` introduced no test regressions or omissions relative to what the fable-5 audit reviewed as its working tree.

**After fixes** (working tree, LocalNet still up, `docker ps` re-verified):

```
pnpm build            # exit 0
npx tsc --noEmit       # exit 0, no type errors from the on-chain.ts SignerGroup import change
pnpm test              # vitest run --coverage
```

```
 Test Files  4 passed (4)
      Tests  48 passed (48)
   Duration  73.05s
```

`contract.e2e.spec.ts` grew from 38 to 40 tests — two new regression tests for [M-03] (see that finding). No other file changed test count; `src/on-chain.e2e.spec.ts`'s existing two tests continue to pass unchanged against the updated `mapSignerGroup` (they don't assert on the newly-added fields, but the type change didn't break them).

Statement coverage of hand-written library code: `on-chain.ts` 98.14%, `safe-tx.ts` 96.36%, `version.ts` 88.88% (`src/` aggregate 96.75%), unchanged by the [L-04] fix (it added fields to an existing, already-covered function rather than new branches). The low headline aggregate figure is entirely the generated `clients/*/AlgoSafeClient.ts` files (auto-generated, exercised only through the one version each e2e test actually deploys) — not a real gap, consistent with every prior audit's note on this.

---

## Executive Summary

This audit re-reviewed `contract.algo.ts` line-by-line from scratch (not as a diff) against commit `9461fe6`, independently re-verified that all previously reported findings across three prior audits (C-01, M-01/M-02/v1, L-01/v1, H-01/v2, and the fable-5 pass's H-01/M-01/M-02) are present, correctly wired, and unchanged in the actual **committed** bytecode — not just in a working tree — and then extended the review into areas the prior audits touched only lightly: the interaction of the three new v1.4.0 mechanisms (close-out spend accounting, cooldown enforcement, membership-epoch invalidation) with each other and with cross-group admin privilege scope, and the off-chain TypeScript library's exposure of the two new `SignerGroup` fields.

**One new Medium-severity finding** was identified, **empirically confirmed** against a live LocalNet deployment of this exact commit, and then **fixed in this same pass**:

- **[M-03 — FIXED] Unbounded `cooldownRounds` enabled a denial-of-service via an AVM arithmetic-overflow panic.** `_validateAdminChange` never bounded `cooldownRounds` when a group was created (`ADM_CREATE_GROUP`) or its policy changed (`ADM_SET_POLICY`). `_executeProposalInternal`'s cooldown check computes `group.lastExecutionRound + group.cooldownRounds` unconditionally once `cooldownRounds != 0`. Setting `cooldownRounds` to a very large value (verified with `uint64` max, `18446744073709551615`) caused every subsequent `executeProposal` call for that group's transaction-group proposals to fail — not with the clean `'group cooldown not elapsed'` assert, but with a raw AVM `logic eval error: + overflowed` panic, confirmed live against this commit's compiled bytecode before the fix. This permanently (for all practical purposes) froze the group's ability to execute any transaction-group proposal until a follow-up `ADM_SET_POLICY` change lowered `cooldownRounds` again. **Fix**: `_validateAdminChange` now asserts `change.cooldownRounds <= MAX_COOLDOWN_ROUNDS` (a new constant, 10,000,000 rounds) on both `ADM_CREATE_GROUP` and `ADM_SET_POLICY`.

Two Low findings were also identified and fixed:

- **[L-04 — FIXED] The off-chain `on-chain.ts` library exposed a stale `SignerGroup` shape.** `RawSignerGroup`/`AlgoSafeSignerGroupRecord` (a hand-maintained mirror type, not derived from the generated ABI client) were missing `lastExecutionRound`, `membershipEpoch` (added in v1.4.0), and also `dailyPeriodStart`/`monthlyPeriodStart` (pre-existing since v1.3.0). **Fix**: `RawSignerGroup` now aliases the generated `SignerGroup` type imported from `latest-client.ts` (the same pattern already used for `AdminChange` in `admin.ts`), and `AlgoSafeSignerGroupRecord`/`mapSignerGroup` now surface all four previously-missing fields.
- **[L-05 — DOCUMENTED] `PRIV_GROUP`/`PRIV_POLICY` are safe-wide privileges, not scoped to the holding group.** Any group holding `PRIV_GROUP` can create/modify/deactivate **any** group in the safe (not just itself), and any group holding `PRIV_POLICY` can change **any** group's spending policy/cooldown, via `change.targetGroupId`. This is architecturally consistent with the existing `activePrivGroupCount` cross-safe lockout guard, confirming it's intentional — so the resolution here is documentation, not a code change. **Fix**: `CLAUDE.md`'s "Contract architecture" section now states this explicitly, alongside the new `cooldownRounds` bound.

All previously reported findings remain fixed with no regressions; no Critical or High findings were identified in this pass. The proposal state machine, box-key collision-freedom, governance-lockout guard, and the three v1.4.0 mechanisms (close-out accounting, cooldown, membership-epoch) were all re-verified sound in combination — the only gap found was the missing upper bound on the `cooldownRounds` input itself, not a flaw in how it's later used, and that gap is now closed.

---

## Scope and Methodology

**In scope**: `projects/algo-safe-contracts/smart_contracts/algo_safe/contract.algo.ts` (full line-by-line re-review, not a diff), `contract.e2e.spec.ts`, and `projects/algo-safe-contracts/src/*.ts` (off-chain codecs, version detection, on-chain query helpers). `CLAUDE.md` and prior audit reports were reviewed for accuracy against the current contract.

**Out of scope**: `projects/algo-safe-frontend` and the three X402 packages, unchanged from every prior audit's scope statement. Generated code under `clients/` was checked only for registry consistency (hash matching, one-folder-per-commit), not reviewed line-by-line (it is machine-generated from the ARC-56 spec).

**Methodology**:
1. Read `contract.algo.ts` in full (1,185 lines) as a fresh document, not as a diff against the fable-5 report — to avoid anchoring on what that report already flagged and to give a genuine independent second opinion.
2. Cross-checked every prior finding (C-01, M-01/M-02/v1, L-01/v1, H-01/v2, H-01/M-01/M-02/fable-5) against the actual code at `9461fe6` by reading the specific lines involved, not by trusting commit messages or prior report prose.
3. Traced every field of `SignerGroup`/`Proposal` for read/write completeness (the same technique the fable-5 audit used to find its M-01), which surfaced that `cooldownRounds` is written (`_adminCreateGroup`, `ADM_SET_POLICY`) with no upper-bound validation anywhere in `_validateAdminChange`.
4. Reasoned about the AVM's `+` opcode semantics (fails the transaction on overflow rather than wrapping) applied to `group.lastExecutionRound + group.cooldownRounds`, then **wrote and ran a standalone, temporary e2e test** (not committed — added, executed, and removed in this same session, following the same empirical-verification convention as the fable-5 audit's own PoC) against a live LocalNet deployment of this commit's bytecode to confirm the theory. The test: create a group, execute one payment (sets `lastExecutionRound`), set `cooldownRounds` to `uint64` max via `ADM_SET_POLICY`, then attempt a second execution. Confirmed result below.
5. Traced privilege-check call sites (`_assertPrivilegeForChange`, `proposeAdminChange`, `_executeProposalInternal`) to confirm whether `change.targetGroupId` is ever compared against the proposing `groupId` — it is not, anywhere — surfacing [L-05].
6. Read `src/on-chain.ts`, `src/safe-tx.ts`, `src/admin.ts`, `src/constants.ts` end-to-end and cross-checked every bitmask constant and struct field against `contract.algo.ts` and the generated ARC-56 spec (`clients/562dab8a.../AlgoSafeClient.ts`), surfacing [L-04].
7. Fresh `pnpm build && pnpm test` on LocalNet against unmodified `9461fe6`; bytecode hashes recomputed; approval-program size re-measured.
8. **Fixed [M-03], [L-04], and [L-05] in the working tree** (per the requester's follow-up direction to fix, not just report), added two regression tests for [M-03], re-ran `pnpm build`, `npx tsc --noEmit`, and `pnpm test`, and recomputed bytecode hashes/program size on the fixed working tree.

### Empirical Verification of [M-03]

A temporary test (added to `contract.e2e.spec.ts`, run via `npx vitest run ... -t "TEMP-POC"`, then fully reverted — `git status --short` confirmed a clean diff afterward) produced:

```
stderr: + overflowed. at:2586. Error resolving execution info via simulate in transaction 0:
transaction GBKZW342MRDF2SWZ7LLITTWF3WAHAVYASVHCZ2SBR73TQHTT7PFA: logic eval error: + overflowed.
Details: app=26799, pc=2658, opcodes=btoi; frame_dig 67; +
```

The subsequent call in the same test — a fresh `ADM_SET_POLICY` lowering `cooldownRounds` back to `0`, followed by re-attempting `executeProposal` on the same still-`READY` proposal — **succeeded**, confirming the freeze is a real but recoverable operational hazard, not a permanent fund lock.

---

## Verification of Prior Findings

| ID (prior audits) | Finding | Status at `9461fe6` |
|---|---|---|
| C-01 (v1) | Any member could overwrite payload chunks of any pending proposal | **Fixed**, unchanged — `appendTransactionGroupPayload` still requires `Txn.sender === proposal.proposer` and `approvalsCount === 1` (`contract.algo.ts:414-415`) |
| M-01 (v1) | Governance lockout: last `PRIV_GROUP` holder could strip/deactivate itself | **Fixed**, unchanged — `activePrivGroupCount` guard via `_wouldRemoveLastGroupAdmin` (`contract.algo.ts:1002-1016`) |
| M-02 (v1) | Stale threshold snapshot honored after live threshold raised | **Fixed**, unchanged — `requiredThreshold` takes the max of snapshot and live threshold (`contract.algo.ts:626`) |
| L-01 (v1) | No box-MBR reclamation for terminal proposals | **Fixed**, unchanged — `pruneProposal` (`contract.algo.ts:499-519`) |
| H-01 (v2) | Removed proposer could still append to / execute own proposal | **Fixed**, unchanged — `this._assertMember(proposal.groupId)` added to `appendTransactionGroupPayload` (`contract.algo.ts:413`) |
| L-02 (v2) | `STATUS_READY` shown while a subsequently-raised live threshold makes execution fail | **Open, unchanged** — `_recordApproval` still flips status using the proposal's own snapshotted `threshold` (`contract.algo.ts:686`), not the live group threshold; see below |
| H-01 (fable-5) | Asset/ALGO close-out bypassed daily/monthly spending limits | **Fixed**, unchanged — live `op.balance`/`op.AssetHolding.assetBalance` tally on close (`contract.algo.ts:728-751`) |
| M-01 (fable-5) | `cooldownRounds` configurable but never enforced | **Fixed**, unchanged — enforced at `contract.algo.ts:635-637`, `lastExecutionRound` updated at `:768` |
| M-02 (fable-5) | Approvals from since-removed members still counted at execution | **Fixed**, unchanged — `membershipEpoch`/`epochAtCreation` check at `approveProposal` (`:460-463`) and execution (`:632`) |
| L-03 (fable-5) | `cancelProposal` grants unilateral cancellation to any group member | **Open, unchanged** — `contract.algo.ts:483-485`; reasonable "emergency stop" design, still worth confirming intent |

All ten prior items were independently re-derived from the current code (not copy-checked from prior report text) and match. No regressions.

---

## Findings

### Medium

#### [M-03 — FIXED] Unbounded `cooldownRounds` enabled denial-of-service via AVM arithmetic-overflow panic

**Severity**: Medium
**Status**: **Fixed** in this pass
**Component**: AlgoSafe
**File**: `smart_contracts/algo_safe/contract.algo.ts:634-637` (enforcement, unchanged), `:1025-1060` (`_validateAdminChange`, bound added at `:1031` and `:1043`), `:1125-` (`_adminCreateGroup`), `:1075-` (`ADM_SET_POLICY` apply)

**Description**:

`cooldownRounds` is a plain `uint64` carried on `AdminChange` and copied verbatim onto `SignerGroup` by both `_adminCreateGroup` and the `ADM_SET_POLICY` branch of `_applyAdminChange`. Before this fix, `_validateAdminChange` validated `threshold`, `allowedActions`, and `adminPrivileges` for these change types, but **never validated `cooldownRounds`** — any `uint64` value, including values approaching `2^64 - 1`, was accepted.

`_executeProposalInternal` enforces the cooldown as:

```ts
if (group.cooldownRounds !== Uint64(0)) {
  assert(Global.round >= group.lastExecutionRound + group.cooldownRounds, 'group cooldown not elapsed')
}
```

The AVM's `+` opcode fails the entire transaction if the addition overflows 64-bit unsigned range (it does not wrap). Once `group.lastExecutionRound + group.cooldownRounds` exceeds `uint64::MAX`, **every future `executeProposal` call for that group's transaction-group proposals failed** — not with the intended `'group cooldown not elapsed'` message, but with an unhandled AVM panic. Even short of actual overflow, any `cooldownRounds` value larger than any realistically reachable round difference (e.g. `10^15`) had the same practical effect: the group's transaction-group execution frozen for the foreseeable future of the chain.

**Impact**: A group's ability to execute transaction-group proposals (payments, asset transfers, app calls, key registrations, asset configs) could be **completely and indefinitely frozen** by a single `ADM_SET_POLICY` (or `ADM_CREATE_GROUP`) call carrying an oversized `cooldownRounds`. Because privilege for `ADM_SET_POLICY` is checked against the *proposing* group's `adminPrivileges`, not the *target* group's (see [L-05]), **any group holding `PRIV_POLICY` anywhere in the safe** — not just the frozen group's own administrators — could trigger this against any other group, whether by a fat-fingered value (e.g. confusing rounds with seconds, or seconds with milliseconds) or deliberately. This was a denial-of-service on the contract's core spending function, not a fund-loss bug: it was self-healing via a follow-up `ADM_SET_POLICY` lowering `cooldownRounds` (empirically confirmed before the fix — see "Empirical Verification" above), but that follow-up fix itself required the same safe-wide `PRIV_POLICY` privilege, so an operator without an already-privileged, uncompromised policy group had no way to recover.

**Proof of Concept** (empirically run against `9461fe6`'s compiled bytecode *before* the fix; see Methodology above for full detail):

```typescript
// 1. Create group "Agent" (threshold 1, ACT_PAY) with cooldownRounds = 0.
// 2. Propose + execute one payment — succeeds, sets lastExecutionRound.
// 3. ADM_SET_POLICY on "Agent": cooldownRounds = 18446744073709551615n (uint64 max).
// 4. Propose a second payment, then executeProposal(secondPid):
//    => "logic eval error: + overflowed" (raw AVM panic, not 'group cooldown not elapsed').
// 5. ADM_SET_POLICY on "Agent" again: cooldownRounds = 0n.
// 6. executeProposal(secondPid) now succeeds — confirms the freeze was recoverable.
```

**Fix applied** (`contract.algo.ts:1031`, `:1043`):

```ts
const MAX_COOLDOWN_ROUNDS: uint64 = Uint64(10_000_000) // ~1 year at current block times
// ...
} else if (change.changeType === ADM_CREATE_GROUP) {
  // ... existing asserts ...
  assert(change.cooldownRounds <= MAX_COOLDOWN_ROUNDS, 'cooldown too large')
} else if (change.changeType === ADM_SET_POLICY) {
  // ... existing asserts ...
  assert(change.cooldownRounds <= MAX_COOLDOWN_ROUNDS, 'cooldown too large')
}
```

`MAX_COOLDOWN_ROUNDS` (10,000,000 rounds, roughly a year at current Algorand block times) is generously above any realistic throttle use case while staying far below the range where the cooldown check's addition could overflow `uint64`. The rejection now happens at proposal-creation time via a clean assert, before the oversized value can ever reach `_executeProposalInternal`'s `+`.

**Verification**: Two new regression tests in `contract.e2e.spec.ts`:
- `'rejects a cooldownRounds value above the configured maximum on group creation (M-03 regression)'` — `ADM_CREATE_GROUP` with `cooldownRounds: 10_000_001n` is rejected.
- `'rejects a cooldownRounds value above the configured maximum via ADM_SET_POLICY, closing the overflow DoS (M-03 regression)'` — the exact `uint64::MAX` value from the PoC above is now rejected by `ADM_SET_POLICY` at proposal time (no overflow panic reachable), while `cooldownRounds: 10_000_000n` (the boundary) is accepted and confirmed via `getSignerGroup`.

Both pass against the fixed bytecode; the full 48-test suite (up from 46) passes with no regressions.

**Recommendation** (addressed): Given [L-05], also consider (as a separate product decision, not part of this fix) whether `ADM_SET_POLICY` should require the *target* group's own privilege rather than the *proposing* group's — see that finding for the tradeoffs. This was left unchanged, since [L-05] concluded the cross-group scope is intentional.

---

### Low

#### [L-04 — FIXED] Off-chain `on-chain.ts` exposed a stale `SignerGroup` shape

**Severity**: Low
**Status**: **Fixed** in this pass
**Component**: `projects/algo-safe-contracts/src/on-chain.ts`
**File**: `src/on-chain.ts:12-31` (`AlgoSafeSignerGroupRecord`), `:51-56` (`RawSignerGroup`, now a `SignerGroup` alias), `:74-95` (`mapSignerGroup`)

**Description**:

`RawSignerGroup` and `AlgoSafeSignerGroupRecord` were hand-written TypeScript types meant to mirror the on-chain `SignerGroup` struct, used via an `as RawSignerGroup` cast on the typed client's `getSignerGroup` response. Because this was a type-level cast rather than a derived type, it did not error when the on-chain struct grew: the ARC-56 spec and generated client confirmed `SignerGroup` includes `lastExecutionRound` and `membershipEpoch` (added in v1.4.0), and has included `dailyPeriodStart`/`monthlyPeriodStart` since v1.3.0 — but `RawSignerGroup` had none of the four, and `mapSignerGroup` copied over only the fields it knew about.

**Impact**: `fetchAlgoSafeSignerGroups`/`fetchAlgoSafeSignerGroupDetail` — the library's public read API — could not surface a group's cooldown-remaining (`lastExecutionRound` vs. `cooldownRounds`) or its membership-epoch (useful to detect "this group has pending proposals that will be rejected as stale on next approval/execution due to a recent member removal"), even though the ABI call already returned this data. This was a client-library completeness gap, not a contract security bug — the underlying `getSignerGroup` ABI call itself was always correct and complete.

**Fix applied**:

```ts
// on-chain.ts
import type { SignerGroup } from './latest-client'
// ...
// SignerGroup is imported from the latest deployed contract's ABI shape;
// older deployed versions that predate a field simply won't populate it at
// runtime — same tolerance already applied to Proposal.numPayloads elsewhere.
type RawSignerGroup = SignerGroup
```

`AlgoSafeSignerGroupRecord` gained `dailyPeriodStart: number`, `monthlyPeriodStart: number`, `lastExecutionRound: number`, `membershipEpoch: number`; `mapSignerGroup` now populates all four via `Number(group.<field>)`, consistent with the existing `cooldownRounds: Number(...)` convention. `RawSignerGroup` is no longer a hand-maintained mirror — it now aliases the generated `SignerGroup` type re-exported from `latest-client.ts` (the same pattern `admin.ts` already used for `AdminChange`), so a future struct change will surface as a type error in `mapSignerGroup` instead of silently under-mapping.

**Verification**: `npx tsc --noEmit` passes with no errors from this change. The existing `src/on-chain.e2e.spec.ts` tests (2 tests, unchanged) continue to pass — they assert on other fields (`threshold`, `memberCount`, etc.) via `toMatchObject`, which tolerates the additional fields without needing updates. Full suite: 48/48 passing.

---

### Low (design confirmation)

#### [L-05 — DOCUMENTED] `PRIV_GROUP` / `PRIV_POLICY` are safe-wide privileges, not scoped to the holding group

**Severity**: Low
**Status**: **Documented** in this pass (confirmed intentional design, not a code defect)
**File**: `smart_contracts/algo_safe/contract.algo.ts:425-444` (`proposeAdminChange`), `:988-994` (`_assertPrivilegeForChange`), `:614-649` (`_executeProposalInternal`'s re-check)

**Description**:

`proposeAdminChange(groupId, change, ...)` checks the caller's privilege against `this.groups(groupId)` — the **proposing** group — via `_assertPrivilegeForChange(change.changeType, group)`. `_executeProposalInternal` re-checks the same way at execution time (`:642`, again against `this.groups(proposal.groupId)`, the proposing group). Nowhere does the contract compare `change.targetGroupId` to `groupId`/`proposal.groupId`. This means **any group holding `PRIV_GROUP` can create/modify/add-or-remove-members-from/deactivate any other group in the safe**, and **any group holding `PRIV_POLICY` can change any other group's `allowedActions`/`limitAssetId`/`dailyLimit`/`monthlyLimit`/`cooldownRounds`** — not just its own.

This is almost certainly intentional: it's the only way the existing `activePrivGroupCount` global counter (which tracks *all* active `PRIV_GROUP`-holding groups safe-wide, to prevent total governance lockout — see `CLAUDE.md`'s "Governance lockout guard") makes sense as a design. A purely self-scoped privilege model wouldn't need a safe-wide counter at all. No test in `contract.e2e.spec.ts` exercises the cross-group case explicitly (e.g. a `PRIV_POLICY`-only group, holding no `PRIV_GROUP`, successfully changing a *different* group's spending policy), so this is confirmed by code-tracing rather than by an existing regression test.

**Impact**: This is a real security-relevant property that isn't stated anywhere in `CLAUDE.md`, the contract's docstrings, or `PRODUCT-DESCRIPTION.md` (not reviewed in this pass, but worth checking). An integrator setting up multiple groups with different trust levels (e.g. a tightly-bounded X402 agent group alongside a human treasury committee) needs to know that granting *any* group `PRIV_POLICY` gives that group's signers the ability to alter *every other* group's spending limits and cooldowns — including groups they have no other relationship to. This also directly amplifies [M-03]'s blast radius, as noted there.

**Resolution applied**: Given the architectural consistency with `activePrivGroupCount` (a purely self-scoped privilege model would have no use for a safe-wide counter), this audit treated the cross-group scope as intentional and documented it rather than changing the access-control logic. `CLAUDE.md`'s "Contract architecture" section now states, alongside the `SignerGroup` bitmask bullet: *"`adminPrivileges` is safe-wide, not self-scoped: ... any group holding `PRIV_GROUP` can create/modify/deactivate any group in the safe, and any group holding `PRIV_POLICY` can change any group's spending policy/cooldown, not just its own."* No code change was made — if a future product decision reverses this (requiring `change.targetGroupId === groupId` for group-scoped changes), that remains a distinct, deliberate change with the UX tradeoffs noted above, not something this audit should silently impose.

**Outstanding**: The cross-group case (a `PRIV_POLICY`-only group changing a *different* group's policy) still has no dedicated regression test — see Missing Test Scenarios #2, unchanged by this fix pass since it's a test-coverage gap, not the defect itself.

---

### Informational

#### [I-05] Close-out spend tally can over-count (never under-count) when a close-type entry follows other spends in the same payload batch

`_executeTransactionGroup`'s pass 1 reads `op.balance`/`op.AssetHolding.assetBalance` fresh at the moment each close-type entry is processed, before any inner transaction has actually moved money (pass 2 doesn't submit until the very end). If a close-type entry appears *after* an earlier non-close spend in the same batch, the close's tally uses the **pre-batch** balance rather than the balance net of the earlier spend — over-counting the swept amount against the daily/monthly limit relative to what will actually leave on-chain. This is conservative (a legitimate proposal could be rejected as exceeding the limit when the real net effect wouldn't), not a bypass — no scenario was found where the tally *under*-counts a close's real effect. Not a security defect; worth knowing if an operator reports an unexpected `'daily limit exceeded'` rejection on a multi-entry batch containing a close.

#### [I-06] ALGO `CloseRemainderTo` from the safe's own account will very likely fail in practice due to box-MBR minimum balance

The safe's app account permanently holds box storage (groups, members, proposals, etc.) once bootstrapped, which imposes a nonzero minimum-balance requirement. An Algorand `CloseRemainderTo` payment empties the sender's ALGO balance to (at most) its minimum balance requirement; since the safe's requirement is never zero after bootstrap, an actual full ALGO close is unlikely to succeed except in contrived low-box-count scenarios. This makes the ALGO half of the [H-01/fable-5] fix somewhat moot in practice (the underlying transaction type is rarely usable), while the ASA half (`AssetCloseTo`) remains fully realistic and necessary (opting out of an ASA doesn't interact with ALGO box-MBR the same way). The fix is correct and cheap either way; this is purely a "how exploitable is this in practice" note, not a call to revert anything.

#### [I-07] Two new `SignerGroup` fields and one new `Proposal` field grow every group/proposal box (carried forward from fable-5's I-02)

`lastExecutionRound`/`membershipEpoch` (16 bytes) and `epochAtCreation` (8 bytes) are a small, permanent MBR increase per group/proposal. Unchanged assessment from the fable-5 audit: not a defect, worth keeping in mind for MBR-funding documentation.

---

## Missing Test Scenarios

| # | Scenario | Risk if untested | Priority |
|---|---|---|---|
| 1 | ~~`cooldownRounds` at/above a new upper bound, and the old overflow case now failing cleanly~~ | **Done** — added in this pass (see [M-03]'s "Verification") | ~~High~~ Closed |
| 2 | A `PRIV_POLICY`-only group (no `PRIV_GROUP`) changing a *different* group's spending policy/cooldown | Confirms/pins the cross-group privilege scope described in [L-05] (documented, but still untested) | Medium |
| 3 | `approveProposal` called after a membership-epoch change (carried forward from fable-5 #5 — still only the execution-time rejection path is tested, not the approval-time assert at `contract.algo.ts:460-463`) | Would confirm the `approveProposal` epoch assert actually fires, not just the execution-time one | Medium |
| 4 | Maximum-size payload (6 chunks × 16 txns) combined with a close-out on the final transaction (carried forward from fable-5 #3) | Validates the H-01/fable-5 fix still holds at the largest supported payload shape | Medium |
| 5 | Concurrent proposals against the same group where one execution's membership-epoch bump invalidates a second, unrelated pending proposal (carried forward from fable-5 #4) | Confirms the intentionally-coarse M-02/fable-5 fix behaves as documented | Medium |
| 6 | `cooldownRounds` changed mid-cooldown via `ADM_SET_POLICY` (carried forward from fable-5 #1 / I-03) | Low — code already reads live state; test would only add confidence | Low |
| 7 | Member removal from the sole `PRIV_GROUP` holder combined with that group's own pending transaction-group proposals (carried forward from fable-5 #2 / I-04) | Low — no code-level conflict found by tracing | Low |

---

## Documentation Gaps

Both gaps identified in this pass have been **addressed** by updating `CLAUDE.md`'s "Contract architecture" section.

### Documentation Gap: Cross-group scope of `PRIV_GROUP`/`PRIV_POLICY` — Fixed

**Missing Information**: `CLAUDE.md`'s "Contract architecture" section described the `adminPrivileges` bitmask (`GROUP=1, POLICY=2`) but never stated whether these privileges apply only to the holding group or to every group in the safe via `targetGroupId`.

**User Impact**: An integrator could reasonably assume privilege is self-scoped (a natural reading of "signer group... governs transactions and admin changes") and grant `PRIV_POLICY` to a low-trust automation group without realizing it can alter any other group's spending limits.

**Fix applied**: The `SignerGroup` bitmask bullet in `CLAUDE.md` now states explicitly that `adminPrivileges` is safe-wide, not self-scoped, names the exact mechanism (`proposeAdminChange`/`_executeProposalInternal` check the *proposing* group, never `change.targetGroupId`), and cross-references why (`activePrivGroupCount` only makes sense as a design if privilege is safe-wide).

### Documentation Gap: No stated bound on `cooldownRounds` — Fixed

**Missing Information**: Neither `CLAUDE.md` nor the contract's docstrings stated any recommended maximum for `cooldownRounds`, nor that an oversized value could freeze a group.

**User Impact**: An operator configuring a cooldown had no guidance on safe value ranges, and no warning that a unit mix-up (e.g. supplying seconds instead of rounds) could be catastrophic for that group's availability.

**Fix applied**: The "Cooldown enforcement" bullet in `CLAUDE.md` now documents `MAX_COOLDOWN_ROUNDS` (10,000,000 rounds, ~1 year) and the reason it exists (the overflow-DoS this audit found and fixed as [M-03]).

---

## Security Best Practices

| Area | Assessment |
|---|---|
| Access control | Pass, with a design-confirmation now documented — every privileged path re-validates against live state; [L-05] confirmed the privilege scope is safe-wide by design and this is now explicitly documented in `CLAUDE.md` |
| State machine integrity | Pass — no invalid transition reachable; re-verified independently in this pass |
| Reentrancy | Pass — no cross-app callback pattern the safe itself depends on for its own state |
| Integer safety | **Now pass** — [M-03] closed the one unbounded `uint64` input (`cooldownRounds`) capable of overflowing `_executeProposalInternal`'s addition in practice; all other arithmetic (spend amounts, member counts, box keys) was re-checked and found safely bounded by real-world token supply / usage limits |
| Governance lockout | Pass — `activePrivGroupCount` guard unaffected by anything in this pass; independently re-derived, not just copy-checked |
| Spending-limit integrity | Pass — [H-01/fable-5]'s close-out fix re-verified sound, including multi-entry-batch edge cases (see [I-05], over-counts only, never under-counts) |
| Policy enforcement completeness | **Now pass** — [M-03] closed the unbounded-`cooldownRounds` gap; cooldown enforcement itself was already correct |
| Approval integrity under membership change | Pass — [M-02/fable-5] re-verified; approval-time path still lacks a dedicated test (see Missing Test Scenarios #3, unchanged by this pass) |
| Program size headroom | Pass — 6,235/8,192 bytes (~24% margin) after this pass's fixes, up 20 bytes from 6,215 before |
| Off-chain library / contract shape consistency | **Now pass** — [L-04] closed; `on-chain.ts`'s `SignerGroup` type now tracks the generated ABI type instead of a hand-maintained mirror |
| Test coverage of new (v1.4.0/v1.4.1) code | Pass overall — 48/48 tests, including two new regressions for [M-03]; known gaps carried forward from fable-5 remain (see Missing Test Scenarios #2–#7) |

---

## Risk Assessment

**Overall risk after this pass: Low**, contingent on committing and re-deploying the fixes described here. Before this pass, the safe carried a **Low-to-Medium** residual risk driven by [M-03] (a denial-of-service, not a fund-loss vector), amplified by [L-05]'s cross-group scope. [M-03] is now closed; [L-05] is now explicitly documented as intentional rather than left ambiguous. No path to unauthorized fund movement, threshold bypass, double-execution, or permanent governance lockout was found in this pass, before or after the fixes — the proposal state machine, signature/threshold enforcement, and all three v1.4.0 policy mechanisms (close-out accounting, cooldown, membership-epoch) hold up under independent re-derivation.

The remaining open items ([L-02], [L-03], both carried forward unchanged from prior audits, plus the untested-but-not-defective scenarios in Missing Test Scenarios #2–#7) are cosmetic/coverage notes, not defects requiring urgent action.

---

## Recommendations

1. **Immediate**: Review and commit the working-tree changes described in this report (contract, tests, `CLAUDE.md`, `on-chain.ts`, regenerated artifacts/clients). Re-run `pnpm build && pnpm test` after commit to reconfirm a clean state.
2. **Before mainnet deployment of v1.4.1**: Add the test scenarios listed under "Missing Test Scenarios" above, particularly #2 (cross-group `PRIV_POLICY` case, directly tied to [L-05]) and #3 (approval-time epoch check, carried forward from fable-5).
3. **Follow-up, non-blocking**: Resolve [L-02] (`STATUS_READY` semantics) and confirm intent for [L-03] (`cancelProposal` unilateral access) — both carried forward, unchanged, from prior audits.
4. **Operational**: Since [M-03] changes observable behavior (a `cooldownRounds` above 10,000,000 now fails at proposal time instead of being silently accepted), communicate this to any existing integrators/operators before rollout — a workflow that previously "worked" (accepting an arbitrarily large cooldown value without complaint) will now correctly fail at proposal-creation time with a `'cooldown too large'` assert.

---

## Testing Recommendations

Beyond the Missing Test Scenarios table: consider a small "fuzz-ish" test that exercises `ADM_SET_POLICY`/`ADM_CREATE_GROUP` with a spread of large `cooldownRounds` values (just under the new bound, at the bound, just over) once [M-03] is fixed, to pin the boundary precisely rather than relying on a single hand-picked value — the empirical PoC in this audit used `uint64::MAX` specifically because it's the most unambiguous overflow trigger, but the fix's actual bound should be tested at its own edges, not just at the extreme.

---

## Compliance and Standards

- **ARC-4 ABI encoding**: The [M-03] fix adds no new struct fields or method signature changes (it only adds `assert`s inside existing methods) — no ABI shape change, no frontend impact. The [L-04] fix is off-chain TypeScript only, no ABI impact.
- **Contract change workflow** (per `CLAUDE.md`): version bump — done (`v1.4.0` → `v1.4.1`, confirmed at `contract.algo.ts:104`); single new client folder — done (`clients/e3892f8c.../`, currently untracked pending commit); no committed client folder deleted — confirmed. Before this pass's own fixes, this audit also independently re-verified commit `9461fe6`'s workflow compliance for the v1.3.1 → v1.4.0 bump (version bump confirmed, exactly one new client folder confirmed via `git show 9461fe6 --name-status`, no deletions).
- **AVM constraints** (per `CLAUDE.md`'s "Contract authoring gotchas"): the [M-03] fix is two plain `assert`s inside `_validateAdminChange`, which runs entirely outside any `op.ITxnCreate` group — no `ensureBudget`-vs-open-group interaction possible. Also re-checked (unchanged from before this pass) that `op.balance`/`op.AssetHolding.assetBalance` reads in the [H-01/fable-5] close-out fix occur before the `op.ITxnCreate` group opens (`contract.algo.ts:702-796`) — still compliant.

---

## Appendix

### Files read/reviewed in full this pass

- `smart_contracts/algo_safe/contract.algo.ts` (1,185 lines, full read, then edited for [M-03])
- `smart_contracts/algo_safe/contract.e2e.spec.ts` (structure and all test names reviewed; full read of the cooldown/epoch-related tests; edited to add two [M-03] regression tests)
- `src/on-chain.ts` (full read, then edited for [L-04]), `src/on-chain.e2e.spec.ts`, `src/safe-tx.ts`, `src/admin.ts`, `src/constants.ts`, `src/latest-client.ts` (full read)
- `CLAUDE.md` "Contract architecture" section (cross-checked against current code, confirmed accurate and current per `git show 9461fe6 -- CLAUDE.md`; then edited for [L-05] and [M-03]'s documented bound)

### Files changed in this fix pass

- `projects/algo-safe-contracts/smart_contracts/algo_safe/contract.algo.ts` — [M-03] fix (`MAX_COOLDOWN_ROUNDS` constant + two asserts) + version bump to `v1.4.1`
- `projects/algo-safe-contracts/smart_contracts/algo_safe/contract.e2e.spec.ts` — two new [M-03] regression tests
- `projects/algo-safe-contracts/src/on-chain.ts` — [L-04] fix (`SignerGroup` import, four new record fields)
- `projects/algo-safe-contracts/smart_contracts/artifacts/algo_safe/*` — regenerated build artifacts
- `projects/algo-safe-contracts/clients/e3892f8c.../` — new generated client (untracked)
- `projects/algo-safe-contracts/src/versioned-clients.generated.ts`, `src/latest-client.ts` — resynced by `pnpm run sync-versioned-client`
- `CLAUDE.md` — [L-05] cross-group privilege documentation + `MAX_COOLDOWN_ROUNDS` documentation

### Test suite summary

**Before this pass's fixes** (commit `9461fe6`, unmodified):
```
Test Files  4 passed (4)
     Tests  46 passed (46)
  Duration  62.08s
```

**After this pass's fixes** (working tree):
```
Test Files  4 passed (4)
     Tests  48 passed (48)
  Duration  73.05s
```

### Empirical PoC artifact disposition

The temporary `cooldownRounds`-overflow test used to confirm [M-03] (before it was fixed) was added to, run against, and then fully removed from `contract.e2e.spec.ts` within this audit session. `git status --short` confirmed a clean working tree (no diff against `9461fe6`) immediately afterward and before any fix was applied — consistent with the same convention used by the fable-5 audit's own PoC. The two regression tests that now permanently live in `contract.e2e.spec.ts` (see "Files changed in this fix pass") are separate, intentionally-committed additions, not the temporary PoC.
