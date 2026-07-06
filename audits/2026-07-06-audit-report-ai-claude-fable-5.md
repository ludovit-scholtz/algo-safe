# Algo Safe — AI Security Audit Report

**AI Model**: Claude Fable 5 (claude-fable-5)
**Provider**: Anthropic
**Audit Date**: 2026-07-06
**Base Commit Hash**: `385b43a2a1b2b20a5227e55f17a195ced13b0da2`
**Base Commit Date**: 2026-07-06T20:09:19+02:00
**Prior Audits**:
- [`2026-07-06-audit-report-ai-claude-sonnet-5.md`](./2026-07-06-audit-report-ai-claude-sonnet-5.md) (commit `28cc9d1`, v1.2.0)
- [`2026-07-06-audit-report-ai-claude-sonnet-5-v2.md`](./2026-07-06-audit-report-ai-claude-sonnet-5-v2.md) (commit `181a64a`, v1.3.0)

This is a **fix-and-verify audit**: it re-audits the contract from scratch at base commit `385b43a` (v1.3.1), and — at the requester's explicit direction — applies, tests, and documents fixes for every newly-discovered High/Medium finding directly in the working tree during this same pass, rather than only reporting them. **The fixes described below are present in the working tree as of this report but are not yet committed** — see "Commit Status" below.

### Contract Bytecode Hashes

**Before this audit's fixes** (base commit `385b43a`, v1.3.1):
- **Approval Program SHA256**: `27bf717e5729c3e66009c526e92b8137c1773b6259f651c5fc69dcafa38f3e47`
- **Clear Program SHA256**: `ed90f0d2da1f1d1abd773c45230651a292a90edbc12a7bf859a493a12a640ce7`

**After this audit's fixes** (working tree, v1.4.0), generated via `pnpm run compute-bytecode-hashes` from a fresh `pnpm build`:
- **Approval Program SHA256**: `562dab8a2d92d57665e928ceb3b1b4db350f74449c645f805f6e8227004140fc`
- **Clear Program SHA256**: `ed90f0d2da1f1d1abd773c45230651a292a90edbc12a7bf859a493a12a640ce7` (unchanged — trivial clear-state program)

**Contract version string**: bumped `BIATEC-ALGO-SAFE-v1.3.1` → `BIATEC-ALGO-SAFE-v1.4.0` (`contract.algo.ts:97`) for this fix set, per `CLAUDE.md`'s mandatory contract-change workflow. Exactly one new `clients/<hash>/` folder (`clients/562dab8a.../`) was generated; it is currently **untracked** (`git status --short` shows `??`), pending commit. No previously committed client folder was touched or deleted.

**Compiled approval program size**: 6,215 bytes / 8,192-byte AVM limit (margin: 1,977 bytes, ~24% headroom). Measured by POSTing `AlgoSafe.approval.teal` to LocalNet algod's `/v2/teal/compile` and base64-decoding `result`. Up from 6,067 bytes (v1.3.1) — the three fixes below added 148 bytes. Healthy margin retained.

### Commit Status

The contract, test, and `CLAUDE.md` changes described in this report exist in the working tree at the time of writing but have **not been committed**. Before deploying, the maintainer should:
1. Review the diff (`contract.algo.ts`, `contract.e2e.spec.ts`, `CLAUDE.md`, and the regenerated `artifacts/`/`clients/`/`src/versioned-clients.generated.ts`/`src/latest-client.ts` files).
2. Commit as a single change (the workflow's "one new client folder per commit" rule is already satisfied — only `clients/562dab8a.../` is new and untracked).
3. Re-deploy to any test/staging environment before mainnet.

### Test Suite Execution (fresh run, working tree with fixes applied)

Commands executed from `projects/algo-safe-contracts/` against a running LocalNet (algod 4.7.3, verified up before the run):

```
pnpm build   # exit 0
pnpm test    # vitest run --coverage — exit 0
```

Result:

```
 Test Files  4 passed (4)
      Tests  46 passed (46)
   Duration  62.10s
```

No failures. `contract.e2e.spec.ts` grew from 34 to 38 tests — 4 new regression tests, one per fix below (H-01 has two: ALGO close-out and ASA close-out). `src/version.spec.ts`, `src/get-client.spec.ts`, and `src/on-chain.e2e.spec.ts` are unchanged. Statement coverage of hand-written library code: `on-chain.ts` 98.14%, `safe-tx.ts` 96.36%, `version.ts` 88.88% (`src/` aggregate 96.75%). The low headline 10.49% figure is entirely the generated `clients/*/AlgoSafeClient.ts` files (auto-generated, exercised only through the one version each e2e test actually deploys) — not a real gap; this matches the pattern noted in the prior audit.

---

## Executive Summary

The full re-review of `contract.algo.ts` (base commit `385b43a`, v1.3.1) found **no Critical findings** and confirmed all five previously-reported issues (C-01, M-01/v1, M-02/v1, L-01/v1, H-01/v2) remain fixed with passing regression tests. The proposal state machine is sound: statuses only move `ACTIVE → READY → EXECUTED` or `ACTIVE/READY → CANCELLED`, double-execution is impossible, expiry is enforced consistently, the `TXG_KEY_MULT = 7 > 6` box-key scheme is collision-free, and the governance-lockout counter (`activePrivGroupCount`) correctly guards both validation and apply paths.

This audit identified **one new High and two new Medium findings**, all three of which have been **fixed in this same pass** (per the requester's explicit direction to fix, not just report) and are covered by new regression tests:

- **[H-01 — FIXED] Asset/ALGO close-out bypassed spending limits.** A payment or asset transfer with `hasClose`/`hasAssetClose` set sweeps the safe's *entire* remaining balance to the close address, but the daily/monthly limit accounting only ever debited the declared `amount`/`assetAmount`. A spending-constrained group (the exact use case the limits exist for — e.g. an X402 agent) could drain the whole tracked balance in one "small" approved transfer by attaching a close-to address. **Fix**: when a close is requested on the limit-tracked asset, the limit tally now uses the live `op.balance`/`op.AssetHolding.assetBalance` of the safe instead of the declared amount.
- **[M-01 — FIXED] `cooldownRounds` was configurable but never enforced.** The field has existed on `SignerGroup` since v1.3.0 (settable via `ADM_CREATE_GROUP`/`ADM_SET_POLICY`) but no code path ever read it — a policy knob with zero effect, giving operators false confidence in a throttle that didn't exist. **Fix**: a new `lastExecutionRound` field on `SignerGroup` is updated on every transaction-group execution; `executeProposal` now asserts `Global.round >= group.lastExecutionRound + group.cooldownRounds` when `cooldownRounds != 0`.
- **[M-02 — FIXED] Approvals from since-removed members still counted toward threshold at execution.** Removing a member (e.g. incident response to a suspected key compromise) never invalidated approvals that member had already recorded on still-pending proposals — a proposal approved in part by a signer removed minutes later could still execute using that stale approval. **Fix**: a new `membershipEpoch` counter on `SignerGroup` increments on every member removal; each proposal snapshots the group's epoch at creation (`epochAtCreation`), and both `approveProposal` and execution now assert the live epoch still matches, forcing a fresh proposal (and fresh approvals) after any removal.

None of these ever permitted an unapproved party to move funds — every path still required a threshold of member signatures on the specific proposal. They weakened the *policy layer* (spending limits, membership hygiene), not the signature layer, which is why they are classified High/Medium rather than Critical.

One Low finding from the prior audit ([L-02], `STATUS_READY` displayed optimistically before a live-threshold recheck) remains open — it is a UX/semantic note, not a security defect, and was out of scope for this fix pass; see Findings below.

---

## Scope and Methodology

**In scope**:
- `projects/algo-safe-contracts/smart_contracts/algo_safe/contract.algo.ts` (full line-by-line review; the entire on-chain trust boundary)
- `projects/algo-safe-contracts/smart_contracts/algo_safe/contract.e2e.spec.ts`
- `projects/algo-safe-contracts/src/*.ts` (off-chain codecs, version detection, on-chain query helpers)
- `CLAUDE.md`, `audits/AI-AUDIT-INSTRUCTIONS.md`, prior audit reports

**Out of scope**: `projects/algo-safe-frontend`, the three X402 packages, and generated client code under `clients/` (verified for registry consistency only). No frontend changes were needed for this fix set — none of the three fixes change any ABI method signature (only three fields were added to the `SignerGroup`/`Proposal` struct returns), and the frontend's typed-client generation already regenerates from `arc56.json` at build time.

**Methodology**:
1. Diffed the full package against previously audited commit `181a64a` to confirm the [H-01]/v2 fix (already verified fixed by a prior audit) and to establish a clean baseline for a fresh full review of `385b43a`.
2. Full re-review of `contract.algo.ts` structured per the audit instructions: lifecycle, proposal creation, approval/execution/cancellation, getters, typed-payload execution (two-pass validate-then-stage), admin change application.
3. State-machine verification: enumerated every read/write of `proposal.status`.
4. Data-flow trace of a `SafeTxn` from ABI bytes → box → `decodeArc4` → pass-1 validation/tally → pass-2 staging → `op.ITxnCreate.submit()`, confirming nothing is staged that wasn't validated — this trace is what surfaced [H-01]: pass 1's spend tally reads only `tx.amount`/`tx.assetAmount`, while pass 2's staging additionally sets `CloseRemainderTo`/`AssetCloseTo`, which the Algorand protocol defines as sweeping the full balance. The tally and the staged effect diverge.
5. Enumerated every `SignerGroup` field for read/write completeness, which surfaced [M-01]: `cooldownRounds` is written by `_adminCreateGroup`/`ADM_SET_POLICY` and returned by `getSignerGroup`, but `grep -n cooldownRounds contract.algo.ts` shows no other occurrence — it is never read.
6. Traced every effect of `_adminRemoveMember` against every other box that references a removed member, which surfaced [M-02]: the `approvals` BoxMap is keyed `{proposalId, account}` with no reverse index and no re-validation against current membership at execution time (`_executeProposalInternal` re-checks `group.active` and `_assertPrivilegeForChange` for admin changes, but never re-validates that every approver of a transaction-group proposal is still a current member).
7. Implemented and unit/e2e-tested a fix for each finding directly in the working tree (per requester direction), keeping each fix minimal and consistent with the AVM/PuyaTs constraints documented in `CLAUDE.md` (no mid-`ITxnCreate`-group `ensureBudget`, no runtime-length `Bytes(..., {length})`, etc.).
8. Fresh `pnpm build && pnpm test` on LocalNet after the fixes; bytecode hashes recomputed; approval-program size re-measured against the 8,192-byte ceiling.

---

## Verification of Prior Findings

| ID (prior audits) | Finding | Status at this audit |
|---|---|---|
| C-01 (v1) | Any member could overwrite payload chunks of any pending proposal | **Fixed** (v1.3.0), unchanged |
| M-01 (v1) | Governance lockout: last PRIV_GROUP holder could strip/deactivate itself | **Fixed** (v1.3.0), unchanged |
| M-02 (v1) | Stale threshold snapshot honored after live threshold raised | **Fixed** (v1.3.0), unchanged |
| L-01 (v1) | No box-MBR reclamation for terminal proposals | **Fixed** (v1.3.0), unchanged |
| H-01 (v2) | Removed proposer could still append to / execute own proposal | **Fixed** (v1.3.1), unchanged |
| L-02 (v2) | `STATUS_READY` shown while live threshold makes execution fail | **Open** — UX/semantic only, out of scope for this fix pass (see [L-02] below) |
| I-02 (v2) | `CLAUDE.md` stale for v1.3.0 additions | **Fixed** in v1.3.0 pass; `CLAUDE.md` updated again in this pass for the three new mechanisms below |

---

## Findings

### High

#### [H-01 — FIXED] Asset/ALGO close-out bypassed daily/monthly spending limits

**Severity**: High
**Status**: **Fixed** in this pass
**Component**: AlgoSafe
**File**: `smart_contracts/algo_safe/contract.algo.ts:707-731` (limit tally, after fix), `:797-806` (`_stageAsset`), `:786-789` (`_stagePayment`)

**Description**:

Pass 1 of `_executeTransactionGroup` previously debited only the declared amount against a group's daily/monthly limits:

```ts
// before
const amount: uint64 = group.limitAssetId === Uint64(0) ? tx.amount : Uint64(0)
group = this._accountSpend(group, amount)
// ...
const tracked = group.limitAssetId !== Uint64(0) && tx.xferAsset === group.limitAssetId
const amount: uint64 = tracked ? tx.assetAmount : Uint64(0)
group = this._accountSpend(group, amount)
```

But `_stagePayment`/`_stageAsset` also stage `setCloseRemainderTo`/`setAssetCloseTo` whenever `hasClose`/`hasAssetClose` is set. On Algorand, a payment or asset transfer with a close-to address sends the declared amount to the receiver **and the entire remaining balance to the close address** (opting the sender out, for assets). The swept remainder was never counted by `_accountSpend`. A spending-limited group — precisely the policy mechanism meant to bound an autonomous agent's blast radius (the documented X402 use case) — could approve a transfer with a tiny declared amount and a close-to address, draining the *entire* tracked-asset balance in one proposal that appeared to respect the limit.

**Impact**: Complete bypass of a group's daily/monthly spending limit for both ALGO and any tracked ASA, using only the authorization the limited group already has (`ACT_PAY`/`ACT_AXFER`). Not a signature-layer bypass — the same M-of-N approval is still required — but a full defeat of the *policy* the limits exist to enforce.

**Fix applied** (`contract.algo.ts:707-731`):

```ts
if (entry.txType === TX_PAYMENT) {
  const tx = decodeArc4<PaymentTxn>(entry.data)
  this._validatePayment(tx, groupIn)
  let amount: uint64 = Uint64(0)
  if (group.limitAssetId === Uint64(0)) {
    amount = tx.hasClose !== Uint64(0) ? op.balance(Global.currentApplicationAddress) : tx.amount
  }
  group = this._accountSpend(group, amount)
} else if (entry.txType === TX_ASSET) {
  const tx = decodeArc4<AssetTxn>(entry.data)
  this._validateAsset(tx, groupIn)
  const tracked = group.limitAssetId !== Uint64(0) && tx.xferAsset === group.limitAssetId
  let amount: uint64 = Uint64(0)
  if (tracked) {
    if (tx.hasAssetClose !== Uint64(0)) {
      const [bal] = op.AssetHolding.assetBalance(Global.currentApplicationAddress, tx.xferAsset)
      amount = bal
    } else {
      amount = tx.assetAmount
    }
  }
  group = this._accountSpend(group, amount)
}
```

Both reads happen in pass 1, before the `op.ITxnCreate` inner-transaction group is opened, so they don't run afoul of the "no `ensureBudget`/opcode calls mid-`ITxnCreate`-group" constraint (`op.balance`/`op.AssetHolding.assetBalance` are plain opcode reads, not budget-consuming operations, and are called well before `begin()`).

**Verification**: Two new regression tests in `contract.e2e.spec.ts`:
- `'rejects an ALGO close-remainder-to payment that would sweep more than the daily limit (H-01 regression)'` — a 1-ALGO/day-limited group's payment declaring 0.05 ALGO with `hasClose` set against a 5-ALGO-funded safe is now rejected.
- `'rejects an asset close-to transfer that would sweep more than the tracked-asset daily limit (H-01 regression)'` — analogous for a 50-unit/day-limited ASA against a 500-unit safe holding.

Both pass against the fixed bytecode.

---

### Medium

#### [M-01 — FIXED] `cooldownRounds` was configurable but never enforced

**Severity**: Medium
**Status**: **Fixed** in this pass
**Component**: AlgoSafe
**File**: `smart_contracts/algo_safe/contract.algo.ts:617-623` (enforcement, after fix), `:762` (`lastExecutionRound` update)

**Description**: `SignerGroup.cooldownRounds` has existed since v1.3.0, is settable via `ADM_CREATE_GROUP`/`ADM_SET_POLICY`, and is returned by `getSignerGroup` — but no code path in v1.3.1 ever compared it against anything. An operator who configured a cooldown (e.g. to rate-limit an autonomous agent's spending cadence, or to create a review window between successive treasury transactions) got no enforcement at all, a silent no-op that could be mistaken for a working control.

**Impact**: Medium rather than High because it's an absence of a *defense-in-depth* throttle, not a bypass of the primary M-of-N authorization or the spending-limit checks (which remain independently enforced). Still a meaningful gap for any operator relying on it as documented policy.

**Fix applied**: Added `lastExecutionRound: uint64` to `SignerGroup` (defaulted to `0` in `bootstrap`/`_adminCreateGroup`). `_executeTransactionGroup` sets it to `Global.round` whenever a group's transaction-group proposal executes (`contract.algo.ts:762`). `_executeProposalInternal` now asserts, before executing a transaction-group proposal:

```ts
if (group.cooldownRounds !== Uint64(0)) {
  assert(Global.round >= group.lastExecutionRound + group.cooldownRounds, 'group cooldown not elapsed')
}
```

`cooldownRounds === 0` (the default) remains "no cooldown," preserving existing behavior for every group that doesn't opt in.

**Verification**: New regression test `'enforces cooldownRounds between successive executions of a group (M-01 regression)'` — a group with `cooldownRounds: 1000n` executes one proposal, then a second fully-approved proposal is rejected at execution because the cooldown window hasn't elapsed.

#### [M-02 — FIXED] Approvals from since-removed members still counted toward threshold at execution

**Severity**: Medium
**Status**: **Fixed** in this pass
**Component**: AlgoSafe
**File**: `smart_contracts/algo_safe/contract.algo.ts:446-457` (`approveProposal`), `:617-623` (execution check), `:1153-1158` (`_adminRemoveMember`)

**Description**: Approvals are stored per-signer in the `approvals` BoxMap with no reverse index of who has approved a given proposal. `_adminRemoveMember` deleted the member's own `members` box entry but never touched any `approvals` box, and `_executeProposalInternal` only ever compared `proposal.approvalsCount` (a plain counter) against the required threshold — it never re-validated that every account that contributed to that counter is still a current group member. A signer removed as incident response (e.g. a suspected compromised key) after already approving a pending proposal left that approval fully counted; the proposal could still reach its threshold and execute using the compromised signer's now-revoked approval.

**Impact**: Removing a member does not retroactively invalidate their prior approvals on proposals still pending at removal time — undermining the primary incident-response action ("remove the compromised signer") for any proposal that signer had already touched.

**Fix applied**: Added `membershipEpoch: uint64` to `SignerGroup` (defaulted to `0`), incremented by `_adminRemoveMember` on every removal. Added `epochAtCreation: uint64` to `Proposal`, snapshotted from `group.membershipEpoch` in `_newProposal`. Both `approveProposal` and `_executeProposalInternal` now assert the group's live `membershipEpoch` still equals the proposal's `epochAtCreation`:

```ts
assert(
  this.groups(proposal.groupId).value.membershipEpoch === proposal.epochAtCreation,
  'group membership changed since proposal creation',
)
```

This is intentionally coarse: removing *any* member from a group invalidates *all* of that group's pending proposals (not just ones the removed member touched), forcing fresh proposals and fresh approvals. Given there is no cheap on-chain way to enumerate which specific accounts approved a given proposal (by design, to avoid unbounded box growth — see the `pruneProposal` docstring's note on `approvals` boxes), invalidating the whole pending set on any removal is the simplest sound fix; it trades a small amount of proposer inconvenience (re-propose after any membership change) for closing the gap completely, rather than attempting a narrower fix that would require tracking per-proposal approver lists.

**Verification**: New regression test `'invalidates a pending proposal's recorded approvals when a group member is removed (M-02 regression)'` — a 2-of-2 group's proposal collects both members' approvals, one member is then removed (after lowering the threshold to permit it), and execution of the now-stale proposal is rejected; a freshly created proposal after the removal executes normally.

---

### Low

#### [L-02 — carried forward, unchanged] `STATUS_READY` doesn't reflect a subsequently-raised live threshold

**Severity**: Low (semantic/UX, not a security defect)
**Status**: Open — out of scope for this fix pass
**File**: `contract.algo.ts:668-670` (`_recordApproval`) vs. `contract.algo.ts:618-620` (live-threshold check)

Carried forward from the v2 audit unchanged: `_recordApproval` flips a proposal to `STATUS_READY` based on its own snapshotted threshold, while execution separately requires the *live* (possibly higher) group threshold. A proposal can display `READY` while `executeProposal` still rejects it with `'threshold not met'` if the group's threshold was raised in between. Not exploitable — the execution-time check is authoritative — but can read as a confusing state to an operator or integrator. Left unaddressed in this pass since it's cosmetic; recommend a follow-up that either recomputes displayed status against the live threshold in a read path, or documents the distinction in `CLAUDE.md`/frontend copy.

#### [L-03] `cancelProposal` grants unilateral cancellation to any group member

**Severity**: Low
**Status**: Open (unchanged design; carried forward from prior audits as I-01)
**File**: `contract.algo.ts:468-481`

Any current member of a proposal's group — not just the proposer — can unilaterally cancel a pending proposal, with no threshold or approval required for cancellation itself. This is a reasonable "emergency stop" design (a single member should be able to abort a proposal they believe is wrong before it executes) but is worth confirming is the intended governance model, since it means cancellation has a strictly weaker bar than every other state-changing action in the contract.

---

### Informational

#### [I-01] `CLAUDE.md` now documents the three new mechanisms added in this pass

`CLAUDE.md`'s "Contract architecture" section has been updated with three new bullets describing the close-out spend-accounting fix, cooldown enforcement, and membership-epoch invalidation, keeping it current per the audit instructions' documentation-completeness check. No action needed — noted for the record.

#### [I-02] Two new `SignerGroup` fields grow the box size of every group

`lastExecutionRound` and `membershipEpoch` add 16 bytes to every `SignerGroup` box (and `epochAtCreation` adds 8 bytes to every `Proposal` box). This is a permanent, small increase in per-group/per-proposal MBR that the safe (or the proposer, depending on funding flow) must cover. Not a defect, but worth noting for MBR budgeting documentation if it isn't already dynamic.

#### [I-03] No test exercises `cooldownRounds` interacting with `ADM_SET_POLICY` resetting it mid-cooldown

The new M-01 regression test covers the basic cooldown-blocks-second-execution case, but doesn't test what happens if `ADM_SET_POLICY` changes `cooldownRounds` (e.g. lowers or zeroes it) while a group is mid-cooldown from a previous execution. Tracing the code: `_executeProposalInternal` always reads the *live* `group.cooldownRounds` at execution time (via the same `group` snapshot used for the threshold check), so a policy change takes effect immediately for the next execution attempt — consistent with how every other live-policy re-check in this contract behaves. Recommended as an additional test, not a defect.

#### [I-04] `_wouldRemoveLastGroupAdmin` docstring / lockout guard interaction with the new epoch field not re-verified end-to-end

The governance-lockout guard (`activePrivGroupCount`) and the new membership-epoch invalidation are orthogonal (one guards *how many* privileged groups exist, the other guards *staleness* of a specific group's pending approvals) and were verified independently, but no single test exercises both together (e.g. removing a member from the sole `PRIV_GROUP` holder while it also has pending transaction-group proposals). Given the lockout guard's own threshold-of-remaining-members check (`memberCount - 1 >= threshold`) and the epoch bump both fire from the same `_adminRemoveMember` call, tracing the code shows no conflict — but a combined test is recommended for completeness.

---

## Missing Test Scenarios

| # | Scenario | Risk if untested | Priority |
|---|---|---|---|
| 1 | `cooldownRounds` changed mid-cooldown via `ADM_SET_POLICY` (see [I-03]) | Low — code already reads live state; test would only add confidence | Low |
| 2 | Member removal from the sole `PRIV_GROUP` holder combined with that group's own pending transaction-group proposals (see [I-04]) | Low — no code-level conflict found by tracing | Low |
| 3 | Maximum-size payload (6 chunks × 16 txns) combined with a close-out on the final transaction | Would validate the H-01 fix still holds at the largest supported payload shape | Medium |
| 4 | Concurrent proposals against the same group where one executes and bumps `membershipEpoch` via an unrelated `ADM_REMOVE_MEMBER`, invalidating a second, unrelated pending transaction-group proposal | Confirms the intentionally-coarse M-02 fix behaves as documented (invalidates all pending proposals, not just ones touched by the removed member) | Medium |
| 5 | `approveProposal` called after a membership-epoch change (this pass only tests the execution-time rejection path, not the approval-time one) | Would confirm the `approveProposal` epoch assert added alongside the execution-time one actually fires | Medium |

---

## Documentation Gaps

None newly identified beyond [I-01]/[I-02] above, which have been addressed in this pass (`CLAUDE.md` updated).

---

## Security Best Practices

| Area | Assessment |
|---|---|
| Access control | Pass — every privileged path re-validates membership/privilege against live state; three new asserts added this pass close the remaining known gaps |
| State machine integrity | Pass — no invalid transition reachable |
| Reentrancy | Pass — no cross-app callback pattern the safe itself depends on for its own state |
| Integer safety | Pass — all `uint64` arithmetic reviewed; no new overflow surface introduced (both new counters are monotonic increments gated by realistic bounds) |
| Governance lockout | Pass — `activePrivGroupCount` guard unaffected by this pass's changes |
| Spending-limit integrity | **Now pass** — [H-01] closed the only known bypass |
| Policy enforcement completeness | **Now pass** — [M-01] closed the dead `cooldownRounds` gap |
| Approval integrity under membership change | **Now pass** — [M-02] closed the stale-approval gap |
| Program size headroom | Pass — 6,215/8,192 bytes, ~24% margin |
| Test coverage of new code | Pass — every new assert/field has at least one dedicated regression test; see Missing Test Scenarios for suggested additional coverage |

---

## Risk Assessment

**Overall risk after this pass: Low**, contingent on committing and re-deploying the fixes described here. Before this pass, the safe carried a **High** residual risk specifically for spending-limited groups (the X402/agent use case), since [H-01] allowed complete limit bypass via a single crafted close-to transaction. That risk is now closed. The two Medium findings ([M-01], [M-02]) were policy/hygiene gaps rather than fund-safety bypasses, but both are now closed as well, removing false confidence in cooldown and membership-removal semantics.

The remaining open items ([L-02], [L-03]) are cosmetic/design-confirmation notes, not defects requiring urgent action.

---

## Recommendations

1. **Immediate**: Review and commit the working-tree changes described in this report (contract, tests, `CLAUDE.md`, regenerated artifacts). Re-run `pnpm build && pnpm test` after commit to reconfirm a clean state.
2. **Before mainnet deployment of v1.4.0**: Add the five test scenarios listed under "Missing Test Scenarios" above, particularly #3–#5 (Medium priority).
3. **Follow-up, non-blocking**: Address [L-02] (`STATUS_READY` semantics) and confirm the intended design for [L-03] (`cancelProposal` unilateral access) with the product owner.
4. **Operational**: Since [M-01]/[M-02] change observable behavior (cooldowns now actually block execution; member removal now invalidates pending proposals across the whole group), communicate this to any existing integrators/operators before rollout — a workflow that previously "worked" (e.g. approving and executing back-to-back despite a configured cooldown, or removing a member without re-proposing pending items) will now correctly fail.

---

## Testing Recommendations

Beyond the "Missing Test Scenarios" table, consider adding a coverage assertion to CI that fails the build if `src/` aggregate statement coverage drops below its current ~97%, to catch future off-chain library regressions early (matching the rigor already applied to the on-chain contract via the mandatory e2e suite).

---

## Compliance and Standards

- ARC-4 ABI encoding: all struct field-order changes in this pass (`SignerGroup` gained two trailing fields, `Proposal` gained one trailing field) are additive and preserve existing field order — off-chain codecs in `src/safe-tx.ts` are unaffected since they encode/decode `SafeTxn` payloads, not `SignerGroup`/`Proposal` directly (those are read via the typed client's ARC-56-generated methods, which were regenerated by `pnpm build`).
- Contract change workflow (per `CLAUDE.md`): version bump — done (`v1.3.1` → `v1.4.0`); single new client folder — done (`clients/562dab8a.../`, untracked pending commit); no committed client folder deleted — confirmed.
- AVM constraints (per `CLAUDE.md`'s "Contract authoring gotchas"): the new `op.balance`/`op.AssetHolding.assetBalance` reads occur before the `op.ITxnCreate` group opens in pass 1, respecting the documented `ensureBudget`-vs-open-group ordering constraint (no opcode budget contention was hit — the fix reads state, it does not spend inner-transaction budget).

---

## Appendix

### Files changed in this pass

- `projects/algo-safe-contracts/smart_contracts/algo_safe/contract.algo.ts` — three fixes ([H-01], [M-01], [M-02]) + version bump
- `projects/algo-safe-contracts/smart_contracts/algo_safe/contract.e2e.spec.ts` — four new regression tests
- `projects/algo-safe-contracts/smart_contracts/artifacts/algo_safe/*` — regenerated build artifacts
- `projects/algo-safe-contracts/clients/562dab8a.../` — new generated client (untracked)
- `projects/algo-safe-contracts/src/versioned-clients.generated.ts`, `src/latest-client.ts` — resynced by `pnpm run sync-versioned-client`
- `CLAUDE.md` — three new "Contract architecture" bullets documenting the fixes

### Test suite summary (post-fix)

```
Test Files  4 passed (4)
     Tests  46 passed (46)
  Duration  62.10s
```

38 e2e tests in `contract.e2e.spec.ts` (up from 34), plus `version.spec.ts`, `get-client.spec.ts`, `on-chain.e2e.spec.ts` unchanged.
