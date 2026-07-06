# Algo Safe — AI Security Audit Report (Follow-Up)

**AI Model**: Claude Sonnet 5 (claude-sonnet-5)
**Provider**: Anthropic
**Audit Date**: 2026-07-06
**Commit Hash**: `181a64ad8ccb327ae317b012035abee916920f01`
**Commit Date**: 2026-07-06T19:35:51+02:00
**Prior Audit**: [`2026-07-06-audit-report-ai-claude-sonnet-5.md`](./2026-07-06-audit-report-ai-claude-sonnet-5.md) (commit `28cc9d1`) — this report verifies the fixes applied since that audit and re-audits the contract from scratch.

### Contract Bytecode Hashes

Generated via `pnpm run compute-bytecode-hashes` from `smart_contracts/artifacts/algo_safe/AlgoSafe.arc56.json` after a fresh `pnpm build`.

**AlgoSafe.algo.ts**:
- **Approval Program SHA256**: `7e9528e198e8827f7acbd54acdf41c3ed9ca41622936d449f4574580401c33cf`
- **Clear Program SHA256**: `ed90f0d2da1f1d1abd773c45230651a292a90edbc12a7bf859a493a12a640ce7` (unchanged — clear-state program is trivial and untouched by this change)

This hash matches `LATEST_CONTRACT_HASH` in `src/versioned-clients.generated.ts`. The build reproduced the already-committed `clients/7e9528e1.../` folder exactly (`git status` showed no diff after `pnpm build`), confirming the committed artifacts are current.

**Contract version string**: `BIATEC-ALGO-SAFE-v1.3.0` (`contract.algo.ts:97`) — correctly bumped from `v1.2.0`, per `CLAUDE.md`'s mandatory contract-change workflow. Exactly one new `clients/<hash>/` folder (`7e9528e1...`) was added in this commit range, and no previously-committed client folder was deleted — the workflow was followed correctly.

**Compiled approval program size**: 6,062 bytes / 8,192-byte AVM limit (margin: 2,130 bytes, ~26% headroom). This is down from 5,391 bytes / ~34% headroom at the last audit — the new governance-lockout bookkeeping, `pruneProposal`, and the live-threshold re-check added ~671 bytes. Still a healthy margin, but worth tracking if further features are added.

---

## Executive Summary

This is a **follow-up audit** verifying the fixes applied in commit `181a64a` for the four findings from the prior audit (C-01, M-01, M-02, L-01). **All four are confirmed fixed and covered by new regression tests.** However, this audit identified **one new High-severity finding introduced by the C-01 fix itself**: `appendTransactionGroupPayload` now authorizes the caller by checking `Txn.sender === proposal.proposer` (an identity match against a value frozen at proposal-creation time) instead of re-verifying the caller is a *current* member of the group — the membership check (`_assertMember`) that used to gate this method was removed rather than kept alongside the new proposer check. A member who creates a transaction-group proposal, is later removed from the group (e.g. as incident response to a suspected key compromise), can still call `appendTransactionGroupPayload` on their own now-orphaned proposal and swap its content for an arbitrary payload, then execute it — as long as no second, independent approval was recorded before their removal. This was **empirically confirmed** against a live LocalNet deployment of this exact commit's bytecode: a removed 1-of-2 group member drained 3 ALGO by appending a new payment to their own already-`STATUS_READY` proposal after being removed, then executing it.

The three governance/robustness fixes (M-01 governance-lockout guard, M-02 live-threshold defense-in-depth, L-01 box pruning) were reviewed line-by-line and are sound; no residual issues were found beyond one minor status-semantics note (new [L-02] below). The full test suite (41 tests, 4 files, up from 28/2) passes, including six new regression tests that directly encode the prior audit's findings — but none of them cover the new [H-01] scenario, which is why it went undetected.

**Recommendation**: Treat [H-01] as a release blocker with the same urgency class as the original C-01, though its blast radius is materially narrower (limited to a removed member's own still-editable proposal, not any member of any pending proposal). The fix is a one-line re-addition of the membership check alongside the existing proposer/approval-count checks.

---

## Scope and Methodology

**In scope**: `projects/algo-safe-contracts/smart_contracts/algo_safe/contract.algo.ts` (full re-review, not just the diff), `contract.e2e.spec.ts`, and the off-chain TypeScript library in `projects/algo-safe-contracts/src/` (including the two new spec files added since the last audit).

**Out of scope**: `projects/algo-safe-frontend` and the X402 packages, unchanged from the prior audit's scope statement.

**Methodology**: (1) Diffed `contract.algo.ts` and the whole `algo-safe-contracts` package against the previously audited commit (`28cc9d1`) to identify exactly what changed. (2) Verified each of the four prior findings (C-01, M-01, M-02, L-01) was actually fixed by tracing the new code paths, not just trusting the diff or commit message. (3) During that verification, traced every caller of `_assertMember` before and after the diff and noticed `appendTransactionGroupPayload` lost its membership check — this seeded the new [H-01] finding, which was then confirmed by writing and running a standalone PoC e2e test against a live LocalNet deployment (removed afterward, not committed, per the same convention as the prior audit's C-01 PoC). (4) Re-ran the full build and test suite fresh. (5) Recomputed bytecode hashes and program size.

### Test Suite Execution (fresh run against this commit)

```
pnpm build && pnpm test
```

```
 Test Files  4 passed (4)
      Tests  41 passed (41)
   Duration  52.76s (tests 54.49s)
```

Up from 2 files / 28 tests at the last audit. The two new files are `src/get-client.spec.ts` (4 tests — directly closes the prior audit's "Missing Test: `get-client.ts` coverage" gap) and `src/on-chain.e2e.spec.ts` (2 tests — directly closes the prior audit's "`on-chain.ts` coverage" gap, raising its statement coverage from 3.7% to 98.14%). `contract.e2e.spec.ts` gained 6 new tests (33 total), one per prior finding plus a proposer-identity-only isolation test.

Coverage: `on-chain.ts` 98.14%, `safe-tx.ts` 96.36%, `version.ts` 88.88% (statement coverage). `admin.ts`, `constants.ts`, `get-client.ts`, `index.ts`, `latest-client.ts`, `artifacts.ts`, and `versioned-clients.generated.ts` do not appear as individual rows in the v8 coverage table at all (not 0% — simply absent), which looks like a reporting quirk of this project's coverage setup rather than a real gap, since `get-client.ts`'s four documented behaviors (default-latest, `'latest'` string, every known hash, unknown-hash error) are each directly asserted by `get-client.spec.ts`. Aggregate statement coverage across `src/` is 96.75% by the tool's own math even though not every file is broken out — worth a quick look at the `coverage.include`/`all` setting in `vitest.config.ts` if precise per-file numbers are needed, but not a functional test gap.

---

## Findings

### High

#### [H-01] `appendTransactionGroupPayload` authorizes by proposer identity alone, not current group membership — a removed member can still mutate and execute their own in-flight proposal

**Severity**: High
**Status**: Open (newly introduced by the commit fixing C-01)
**Component**: AlgoSafe
**File**: `smart_contracts/algo_safe/contract.algo.ts:392-414` (`appendTransactionGroupPayload`)

**Description**:

The C-01 fix (correctly) restricts payload appends/overwrites to the original proposer and to proposals with no independent approval yet:

```ts
public appendTransactionGroupPayload(
  proposalId: uint64,
  payloadIndex: uint64,
  payload: SafeTxnGroup,
  ensureBudgetValue: uint64,
): void {
  ...
  assert(proposal.payloadType === PT_TRANSACTION_GROUP, 'not a tx group')
  assert(proposal.status === STATUS_ACTIVE || proposal.status === STATUS_READY, 'proposal not pending')
  assert(Txn.sender === proposal.proposer, 'only proposer can append')
  assert(proposal.approvalsCount === Uint64(1), 'cannot modify payload after independent approval')
  this._storePayloadGroup(proposalId, payloadIndex, payload)
  ...
}
```

Before the fix, this method called `this._assertMember(proposal.groupId)` — which checks that `Txn.sender` is a *current* member of the group (`contract.algo.ts:589-592`). The fix **replaced** that call with the proposer-identity check rather than **adding** the proposer/approval-count checks alongside it. `proposal.proposer` is captured once at proposal creation (`contract.algo.ts:644`, `_newProposal`) and never re-validated against the group's current membership. If the proposer is later removed from the group via a governed `ADM_REMOVE_MEMBER` change, `Txn.sender === proposal.proposer` still evaluates true for that same address, and nothing else in the method re-checks whether they are still a member.

**Impact**:

A member who proposes a transaction-group proposal, and is subsequently removed from the group (the standard incident-response action for a suspected compromised or offboarded signer), retains the ability to rewrite the content of their own still-pending proposal — as long as no second, independent approval landed before their removal. For a 1-of-N group with threshold 1 (an explicitly supported and tested configuration — see the existing "splits a 6-payment group across two payload slots" test, which relies on exactly this multi-slot-append-before-independent-approval pattern), the proposer's own auto-approval already satisfies the threshold at creation time, so the proposal is `STATUS_READY` from the moment it's created. Removing the proposer from the group does **not** cancel or otherwise invalidate that proposal. The removed member can then:

1. Call `appendTransactionGroupPayload` to append (or, for slots 2–6, overwrite) a chunk with an arbitrary transaction — this succeeds because `Txn.sender === proposal.proposer` still holds and `approvalsCount` is still 1.
2. Call `executeProposal` — this succeeds because the proposal is still `STATUS_READY`, the group is still active, and `approvalsCount (1) >= requiredThreshold (1)`. Neither check re-verifies that the proposer is a current group member.

This is a direct, unconditional (once the precondition state exists) fund-loss path requiring no mistake or cooperation from any honest party — unlike the higher-threshold case (see below), it does not depend on an honest member later approving unreviewed content.

For groups with threshold > 1, the same append-after-removal succeeds, but the proposal cannot reach/stay at `STATUS_READY` on the removed member's approval alone (they cannot approve again after removal, since `approveProposal` does check current membership). It would still require an honest remaining member to approve the (now attacker-controlled) content without noticing the proposer had been removed — a real but more avoidable risk.

**Proof of Concept — empirically confirmed against a live LocalNet deployment**:

1. Deploy and bootstrap a safe; fund it with 10 ALGO.
2. Governance creates a 1-of-2 "Treasury" group: `attacker` (initial member, `ACT_PAY`) + `bystander` (added second).
3. `attacker` calls `proposeTransactionGroup` with a small 0.1 ALGO payment to a decoy. Auto-approval (threshold = 1) brings it straight to `STATUS_READY`.
4. Governance (the 1-of-1 admin group) calls `ADM_REMOVE_MEMBER` to remove `attacker` from the Treasury group — `isMember(treasuryGroupId, attacker)` now returns `false`.
5. `attacker` calls `appendTransactionGroupPayload(pid, payloadIndex=2, [3 ALGO payment to an attacker-controlled account])` — **this call succeeds** despite `attacker` no longer being a group member.
6. `attacker` calls `executeProposal` — **this succeeds**, moving both the original 0.1 ALGO decoy payment and the appended 3 ALGO payment.

**Actual result** (captured from the live LocalNet run): the attacker-controlled payout account received exactly 3,000,000 microALGO, confirming the drain executed after removal. The PoC test file (`smart_contracts/algo_safe/poc-audit-2.e2e.spec.ts`) was written for this verification and removed afterward (not committed), following the same convention as the prior audit's C-01 PoC.

**Recommendation**:

1. **Re-add the membership check alongside the existing ones** — require both current membership and proposer identity:
   ```ts
   this._assertMember(proposal.groupId)
   assert(Txn.sender === proposal.proposer, 'only proposer can append')
   assert(proposal.approvalsCount === Uint64(1), 'cannot modify payload after independent approval')
   ```
   This is a minimal, low-risk fix that closes the gap without disturbing the legitimate 1-of-1/1-of-N-threshold-1 multi-slot use case (a current member who is also the proposer still passes both checks).
2. Add an e2e regression test encoding the PoC above (remove-then-append-then-execute) so this class of bug cannot regress silently, following the pattern of the six regression tests already added for C-01/M-01/M-02/L-01.
3. Consider whether `_adminRemoveMember` should proactively cancel any of the removed member's own pending proposals (defense in depth beyond the membership check above) — this would also improve the operational story for admins who might not think to manually run `cancelProposal` on every pending proposal from a member they are removing.
4. Update the method's docstring once fixed to state the membership requirement explicitly (currently it describes only the proposer-identity and approval-count rules).

---

### Fixed Since Prior Audit (verified)

#### [C-01 — FIXED] Transaction-group proposal payload could be mutated after approvals were collected

**Original severity**: Critical. **Status**: Fixed, verified.

`appendTransactionGroupPayload` now requires `Txn.sender === proposal.proposer` and `proposal.approvalsCount === Uint64(1)` (`contract.algo.ts:406-407`), exactly matching the prior audit's recommendation. Verified via code review and the new regression test `'rejects appending a transaction-group payload chunk after an independent approval (C-01 regression)'`, which reproduces the original exploit scenario and asserts the append is now rejected. **Caveat**: see [H-01] above — the fix removed the membership check that used to accompany this method, reopening a narrower but still serious related gap.

#### [M-01 — FIXED] No safeguard against a group revoking its own last `PRIV_GROUP` privilege

**Original severity**: Medium. **Status**: Fixed, verified.

A new `activePrivGroupCount` global counter (`contract.algo.ts:261`) tracks the number of active groups currently holding `PRIV_GROUP`, maintained incrementally at every site that can change a group's `adminPrivileges` or `active` flag (`_adminCreateGroup`, and both branches of `_applyAdminChange` for `ADM_SET_PRIVILEGES`/`ADM_SET_ACTIVE`). A new helper, `_wouldRemoveLastGroupAdmin` (`contract.algo.ts:964-978`), blocks any `ADM_SET_PRIVILEGES` or `ADM_SET_ACTIVE` change that would strip `PRIV_GROUP` from, or deactivate, the last remaining active holder. The check is applied both at proposal-validation time (`_validateAdminChange`, upfront UX) and — critically — re-checked against fresh state at `_applyAdminChange` time, closing the same race-condition class the original M-02 finding was about (two concurrent proposals each individually valid at creation time, but not both safe to execute).

Traced the counter bookkeeping for consistency: every mutation site that can change `adminPrivileges`/`active` recomputes `hadGroupPriv`/`willHaveGroupPriv` (or `wasActive`/`willBeActive`) from fresh on-chain state before adjusting the counter, and `_adminCreateGroup` always creates new groups with `active = 1`, so the increment-on-create logic (gated only on the `PRIV_GROUP` bit) is correct. No path was found that could desynchronize the counter from reality. Verified via the three new regression tests covering: self-revocation by the sole holder (privileges and active-flag paths), and the two-group case where revocation is allowed while a second holder exists but blocked once it would become the last one.

`PRODUCT-DESCRIPTION.md` was also updated with a "Governance safety" paragraph documenting the guard and recommending topology best practices (maintaining ≥2 `PRIV_GROUP` holders) — this closes the corresponding prior documentation gap as well.

#### [M-02 — FIXED, defense in depth] Proposal threshold was snapshotted at creation

**Original severity**: Medium. **Status**: Mitigated.

`_executeProposalInternal` now computes `requiredThreshold = max(proposal.threshold, group.threshold)` (`contract.algo.ts:614`) and checks approvals against that, rather than the stale snapshot alone. Verified via the new regression test, which raises a group's threshold after a proposal is already `STATUS_READY` under the old (lower) snapshot and confirms `executeProposal` now correctly rejects it until a second, independent approval is recorded. This is intentionally conservative in the other direction too: if a threshold is *lowered* after proposal creation, the *higher* snapshot value still applies, so a threshold reduction can never make an in-flight proposal easier to execute than what its original approvers signed up for.

One residual, non-security semantic note is captured below as [L-02].

#### [L-01 — FIXED] No cleanup of executed/cancelled proposal data

**Original severity**: Low. **Status**: Fixed.

A new `pruneProposal(proposalId, ensureBudgetValue)` method (`contract.algo.ts:487-507`) deletes a proposal's box and its transaction-group/admin payload boxes once the proposal is terminal (`STATUS_EXECUTED`/`STATUS_CANCELLED`) and past its `expiryRound`, reclaiming MBR. Access is gated by current group membership (`_assertMember`). Approval boxes are intentionally left alone (documented in the docstring — there's no on-chain index of who approved, so they can't be enumerated for deletion; this is a reasonable, disclosed limitation, not a bug). Verified via the new regression test, which confirms pruning is rejected both before execution and before expiry, and succeeds (with both the proposal and its payload boxes becoming unreadable afterward) only once both conditions are met.

#### [I-01 — unchanged, no action taken] `cancelProposal` grants unilateral cancellation to any group member

**Status**: Open, informational, unchanged from prior audit — appears to remain an intentional design choice (it is in fact the compensating control the M-02 mitigation and the H-01 recommendation above both lean on). No change needed unless the product intends otherwise.

---

### Low / Informational (new)

#### [L-02] `STATUS_READY` no longer guarantees a proposal is immediately executable if the group's threshold was raised afterward

**Severity**: Low (semantic/UX, not a security defect)
**File**: `contract.algo.ts:665-667` (`_recordApproval`, status transition) vs. `contract.algo.ts:614-615` (`_executeProposalInternal`, live-threshold check)

`_recordApproval` still flips `proposal.status` to `STATUS_READY` based on the proposal's own snapshotted `threshold` (`updated.approvalsCount >= updated.threshold`), while `_executeProposalInternal`'s M-02 fix separately requires the *live* (possibly higher) `group.threshold`. This means a proposal can display `STATUS_READY` (e.g. to a frontend or an integrator polling `getProposal`) while `executeProposal` still rejects it with `'threshold not met'` if the group's threshold was raised in between. Not exploitable and not a fund-safety issue — the execution-time check is what actually matters — but it can surface as a confusing "Ready but won't execute" state to an operator. Consider either recomputing `status` against the live threshold in a read path, or documenting that `STATUS_READY` reflects the threshold at last-approval time, not necessarily the current one.

#### [I-02] `CLAUDE.md` not updated for the new methods and global state added in v1.3.0

**Severity**: Informational
**File**: `CLAUDE.md` — "Contract architecture" section

`pruneProposal`, `getActivePrivGroupCount`, and the `activePrivGroupCount` global-state field are not mentioned in `CLAUDE.md`'s contract architecture summary (unlike `PRODUCT-DESCRIPTION.md`, which was correctly updated with the user-facing governance-safety note for M-01). This is a minor internal-documentation gap for future contributors/auditors using `CLAUDE.md` as an orientation document, not a user-facing risk.

#### [I-03] Compiled program size margin eroded from ~34% to ~26% headroom

**Severity**: Informational

6,062 / 8,192 bytes (671 bytes added for the governance-lockout counter/guard, `pruneProposal`, and the live-threshold check). Still comfortably within limits; noted per the audit checklist's guidance to flag margin erosion so it's tracked across future changes rather than discovered only when the limit is finally hit.

---

## Missing Test Scenarios

### Missing Test: Removed proposer mutates and executes their own in-flight proposal (H-01 regression test)

**Description**: Verify that a member who is removed from a group after proposing a transaction-group proposal can no longer append/overwrite its payload or benefit from its execution.

**Risk if Untested**: The High finding above ships undetected — exactly what happened here.

**Test Steps** (mirrors the PoC in [H-01]):
1. Create a 1-of-2 (or N-of-M) group with `attacker` and at least one other member.
2. `attacker` proposes a small payment; auto-approval reaches `STATUS_READY` (threshold 1) or leaves it `STATUS_ACTIVE` (threshold > 1).
3. Governance removes `attacker` from the group.
4. Attempt `appendTransactionGroupPayload` as `attacker` with a different payload.
5. Assert this call is rejected (once [H-01] is fixed) or currently succeeds (documenting the exploit as a regression guard pre-fix).
6. If threshold was 1, also assert `executeProposal` is rejected post-fix.

**Priority**: Critical (tied to H-01's severity)

### Carried forward from prior audit (still not covered)

These gaps from the prior audit were **not** addressed by this commit's new tests, which focused specifically on the four numbered findings:

- **Malformed/adversarial ARC4 `data` for a declared `txType`** — still no test that a `SafeTxn` entry whose `data` doesn't decode cleanly as the struct implied by `txType` fails safely. Priority: Medium.
- **Maximum-size payload (6 chunks × 16 txns)** — still only tested at 2 slots, not the documented maximum. Priority: Low.
- **Proposal expiry exact-boundary behavior** (`Global.round === proposal.expiryRound`) — still untested. Priority: Low.

---

## Documentation Gaps

### Documentation Gap: `CLAUDE.md` contract architecture summary is stale for v1.3.0

See [I-02] above.

**Recommended Documentation**: Add `pruneProposal` and `getActivePrivGroupCount` to the "Read-only getters" / lifecycle method lists in `CLAUDE.md`'s "Contract architecture" section, and a one-line mention of the `activePrivGroupCount`-backed governance-lockout guard.

**Location**: `CLAUDE.md` — "Contract architecture" section

**Priority**: Low

### Documentation Gap (carried forward, partially closed): `appendTransactionGroupPayload` docstring should state the membership requirement once [H-01] is fixed

The docstring was correctly rewritten to describe the proposer-identity and `approvalsCount === 1` rules (closing the prior audit's documentation gap about the old, contradictory docstring), but it should be extended to also state the current-membership requirement once [H-01]'s fix is applied, so the documented contract matches the enforced one.

**Location**: `contract.algo.ts:383-390`

**Priority**: High (tied to H-01)

---

## Security Best Practices — Compliance Assessment

| Practice | Status | Notes |
|---|---|---|
| Access control on privileged state changes | ⚠️ Partial | [H-01]: `appendTransactionGroupPayload` authorizes by frozen proposer identity, not current membership. |
| Re-validation of authorization at execution time | ✅ | `_executeProposalInternal` re-reads `group.active`, re-checks admin privilege for admin changes, and (new) enforces the live threshold via `_wouldRemoveLastGroupAdmin`/`requiredThreshold`. |
| Threshold integrity | ✅ | M-02's snapshot gap is now mitigated with a live-threshold floor; see [L-02] for a residual status-display nuance only. |
| Governance lockout protection | ✅ | New `activePrivGroupCount` guard, verified against direct self-revocation, deactivation, and the two-group race scenario. |
| Replay/double-execution protection | ✅ | Unchanged — `STATUS_EXECUTED` remains a one-way terminal transition. |
| Box storage key collision safety | ✅ | `TXG_KEY_MULT = 7 > 6` unchanged and still correctly sized. |
| Box storage growth / MBR reclamation | ✅ | New `pruneProposal` closes the prior L-01 gap for proposal/payload boxes (approval boxes remain, by disclosed design). |
| Inner-transaction budget handling | ✅ | Two-pass validate-then-stage pattern unchanged and still correct. |
| Resource limits matching AVM consensus params | ✅ | Unchanged from prior audit; still correct. |
| Program size within AVM limit | ✅ | 6,062 / 8,192 bytes; see [I-03] for the margin-erosion note. |
| Test suite currency and coverage | ✅ | Suite grew from 28 to 41 tests, closing both the C-01/M-01/M-02/L-01 regression gaps and the `on-chain.ts`/`get-client.ts` coverage gaps flagged previously — but see the new [H-01] gap above. |

---

## Risk Assessment

**Overall Risk: High**, driven by the new [H-01] finding. The prior audit's Critical finding (C-01) is genuinely and verifiably fixed, and the Medium/Low findings (M-01, M-02, L-01) are also fixed with good regression-test coverage — this was a substantive, well-executed remediation pass, not a superficial patch. However, the C-01 fix itself introduced a new access-control gap in the same method: a member who is removed from a group can still edit and, for threshold-1 groups, immediately execute their own already-approved proposal with arbitrary new content. This is narrower than C-01 (it requires the attacker to be the specific proposal's own proposer, and for the pure no-honest-approver-needed path, a threshold-1 group) but is still a direct, empirically-confirmed fund-loss vector reachable through a very ordinary operational sequence: removing a member from a signer group while they have a pending proposal.

Every deployed safe with a threshold-1 group (an explicitly supported, encouraged configuration for fast single-approval workflows) should be considered exposed if it ever removes a member without first manually cancelling that member's pending proposals, until [H-01] is fixed and a fresh audit/bytecode-hash confirms the fix.

---

## Recommendations (prioritized)

1. **[Immediate / blocking]** Fix [H-01]: re-add `this._assertMember(proposal.groupId)` inside `appendTransactionGroupPayload`, alongside (not instead of) the existing proposer-identity and `approvalsCount === 1` checks. Bump `CONTRACT_VERSION` to `v1.3.1` (or next appropriate version), rebuild, add the regression test from "Missing Test Scenarios," and re-run the full suite plus a fresh bytecode-hash audit before any group relies on multi-chunk transaction-group proposals or threshold-1 groups.
2. **[Medium]** Consider whether `_adminRemoveMember` should proactively cancel the removed member's own pending proposals as defense in depth beyond the membership-check fix.
3. **[Low]** Update `CLAUDE.md`'s contract architecture section for `pruneProposal`/`getActivePrivGroupCount`/the lockout guard (I-02).
4. **[Low]** Document the `STATUS_READY`-vs-live-threshold nuance (L-02), or recompute status against the live threshold in a read path.
5. **[Low]** Backfill the three still-open test gaps carried forward from the prior audit (malformed ARC4 payload, max-size 6×16 payload, expiry exact-boundary).

---

## Testing Recommendations

The six new regression tests added in this commit are high quality and directly encode the prior audit's findings — this is exactly the right pattern to continue. The gap that let [H-01] through is a category the prior audit's own recommendation ("add a small suite of adversarial/state-machine tests... multi-actor race conditions") anticipated but didn't fully cover: specifically, tests that combine a *membership change* with an *in-flight proposal* from the removed/changed member. Recommend adding a small family of tests around "governance action X happens while member M has proposal P pending," varying X across removal, privilege change, and policy change, and M's role across proposer/approver.

---

## Compliance and Standards

- **ARC-4** ABI encoding: no changes to any transaction-type struct in this commit; previously-verified field-order consistency between `contract.algo.ts` and `safe-tx.ts` codecs remains valid (spot-checked that no `*_CODEC` type strings changed in this diff).
- **ARC-28** events: `pruneProposal` and the governance-lockout guard do not emit new events. Consider whether a `ProposalPruned` event (mirroring `ProposalCancelled`) would help off-chain indexers track box lifecycle, and whether an event on the new `activePrivGroupCount` transitions would aid monitoring dashboards watching for governance-health metrics. Neither is a security requirement, both are minor observability improvements.
- **AVM protocol limits**: program size, app-call resource limits, and inner-transaction group size re-verified against current Algorand consensus parameters; no regressions.

---

## Appendix

### Repository Context

```
git log -1 --format="%H %cI"
181a64ad8ccb327ae317b012035abee916920f01 2026-07-06T19:35:51+02:00
```

- `smart_contracts/algo_safe/contract.algo.ts`: 1,141 lines (up from 1,034; sole on-chain contract)
- `smart_contracts/algo_safe/contract.e2e.spec.ts`: 1,618 lines, 33 test cases (up from 1,291 lines / 26 tests)
- `src/*.ts` (off-chain library): 969 lines total, including two new spec files (`get-client.spec.ts`, `on-chain.e2e.spec.ts`) added since the prior audit
- Committed contract versions in `clients/`: 6 (`1a77ba21...`, `1bf721b1...`, `5e990dc3...`, `7e9528e1...` [current/latest], `ebd1cf10...`, `f555578c...`) — exactly one new hash added since the prior audit, none removed, matching the mandatory "one new client connector per commit, never delete committed clients" workflow.

### Verification Notes / Limitations

- LocalNet was already running (`algokit_sandbox_algod` and peers, up ~8h at audit time via Docker); no LocalNet setup was needed.
- `pnpm build` was run fresh and reproduced the committed bytecode/client artifacts exactly (no `git status` diff), confirming the committed `clients/7e9528e1.../` folder is current.
- The full suite (`pnpm build && pnpm test`) was executed fresh against this exact commit; results reported above are from that run, not cached.
- [H-01] was first identified by diffing the pre-fix and post-fix `appendTransactionGroupPayload` bodies and noticing `_assertMember` was removed rather than supplemented, then confirmed by tracing that no other check in the method or in `executeProposal`/`_executeProposalInternal` re-validates the proposer's current membership. It was then **empirically confirmed** by writing and running a standalone PoC e2e test (`smart_contracts/algo_safe/poc-audit-2.e2e.spec.ts`) against a live LocalNet deployment of this exact commit's compiled bytecode — the drain succeeded exactly as predicted by the static analysis. The PoC file was removed after the run; it was not committed.
- The frontend (`projects/algo-safe-frontend`) and X402 packages were not audited in either this or the prior audit; findings remain scoped to the contract and its direct TypeScript client library.
- The v8 coverage report's omission of several fully-exercised `src/*.ts` files (see "Test Suite Execution" above) was not root-caused beyond noting it appears to be a reporting artifact rather than a real coverage gap; worth a quick look at `vitest.config.ts`'s coverage settings if precise per-file numbers become important for future audits.
