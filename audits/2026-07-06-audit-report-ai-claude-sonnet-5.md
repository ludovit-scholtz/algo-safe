# Algo Safe — AI Security Audit Report

**AI Model**: Claude Sonnet 5 (claude-sonnet-5)
**Provider**: Anthropic
**Audit Date**: 2026-07-06
**Commit Hash**: `28cc9d1a64277c8dcf4080f6dfa10357e88f45d5`
**Commit Date**: 2026-07-06T15:08:45+02:00

### Contract Bytecode Hashes

Generated via `pnpm run compute-bytecode-hashes` from `smart_contracts/artifacts/algo_safe/AlgoSafe.arc56.json` after a fresh `pnpm build`.

**AlgoSafe.algo.ts**:
- **Approval Program SHA256**: `5e990dc32389d1e858570d22be22b068b646dcd8823dcc154ce95c5042b2b50c`
- **Clear Program SHA256**: `ed90f0d2da1f1d1abd773c45230651a292a90edbc12a7bf859a493a12a640ce7`

This hash matches `LATEST_CONTRACT_HASH` in `src/versioned-clients.generated.ts` — the audited bytecode is exactly what a client requesting `'latest'` would connect to. `contract.algo.ts` was not modified in this audit session, so no `CONTRACT_VERSION` bump or new `clients/<hash>/` folder was required (build reproduced the already-committed artifact with no `git status` diff under `clients/`).

**Contract version string**: `BIATEC-ALGO-SAFE-v1.2.0` (`contract.algo.ts:97`)

**Compiled approval program size**: 5,391 bytes / 8,192-byte AVM limit (margin: 2,801 bytes, ~34% headroom)

---

## Executive Summary

Algo Safe is a single-contract, policy-driven smart account: an M-of-N signer group governs a proposal lifecycle (`ACTIVE → READY → EXECUTED/CANCELLED`) for both fund movement (payments, ASA transfers, app calls, key registration, asset configuration) and its own governance (creating groups, adding/removing members, changing thresholds/privileges/policy). All ~1,000 lines of on-chain logic live in `smart_contracts/algo_safe/contract.algo.ts`.

The audit found **one Critical vulnerability**: the multi-chunk payload mechanism for transaction-group proposals (`appendTransactionGroupPayload`) allows **any** member of the proposing group — not just the original proposer — to add or silently overwrite transaction chunks **after** the proposal has already collected approvals and reached `STATUS_READY`, without invalidating those approvals or requiring re-approval. This breaks the fundamental custody guarantee of the product: that every signer approves the *same* set of transactions. A single malicious or compromised member of any M-of-N group (M > 1) can use this to drain the safe using approvals that were honestly given for an unrelated, benign transaction.

Two Medium-severity governance-robustness issues were also found (a self-inflicted governance-lockout footgun, and threshold changes not retroactively applying to already-approved pending proposals), plus a Low/Informational box-storage growth issue (no cleanup of executed/cancelled proposal data). The full test suite (28 tests, 2 files) passes, but none of the 26 e2e scenarios exercise the append-after-approval attack path — this is a genuine, previously untested gap, not a regression the suite would have caught.

**Recommendation**: Treat the Critical finding as a release blocker for any group with threshold > 1 that uses (or could ever use) `proposeTransactionGroup`/`appendTransactionGroupPayload` — i.e., effectively all production use of the transaction-group proposal type.

---

## Scope and Methodology

**In scope**: `projects/algo-safe-contracts/smart_contracts/algo_safe/contract.algo.ts` (the entire on-chain trust boundary), `contract.e2e.spec.ts`, and the off-chain TypeScript library in `projects/algo-safe-contracts/src/` (transaction builders/codecs, version detection, versioned-client registry).

**Out of scope**: `projects/algo-safe-frontend` (React UI) was not reviewed in depth; the X402 client/facilitator/shop packages were not reviewed. These are noted only where they interact directly with the audited contract's trust model.

**Methodology**: Manual line-by-line review of `contract.algo.ts` against the proposal-lifecycle state machine, cross-referenced with `CLAUDE.md`'s documented architecture and known PuyaTs/AVM gotchas; verification of the ARC4 codec definitions in `safe-tx.ts` against the on-chain struct field orders; a fresh build and full test-suite run against LocalNet; and a compiled-bytecode size check against the AVM's 8,192-byte program limit.

### Test Suite Execution (fresh run against this commit)

```
pnpm build && pnpm test
```

```
 Test Files  2 passed (2)
      Tests  28 passed (28)
   Duration  40.06s (tests 39.00s)
```

All 28 tests (26 in `contract.e2e.spec.ts` against a real LocalNet deployment via `algorandFixture`, 2 unit tests in `src/version.spec.ts`) pass. LocalNet (`algokit_sandbox_algod` and peers) was already running via Docker at audit time. No test failures to analyze.

Statement/branch coverage from `pnpm test -- --coverage` is low in aggregate (~10.6% statements) but this is dominated by the large generated `AlgoSafeClient.ts` files under `clients/*` and `smart_contracts/artifacts/*` being included in the coverage report; the actual hand-written library code (`safe-tx.ts` 96%, `version.ts` 89%) is well covered. `on-chain.ts` (3.7%) and `get-client.ts` (0%) are essentially untested — see Missing Test Scenarios.

---

## Findings

### Critical

#### [C-01] Transaction-group proposal payload can be mutated after approvals are collected, bypassing the M-of-N guarantee

**Severity**: Critical
**Status**: Open
**Component**: AlgoSafe
**File**: `smart_contracts/algo_safe/contract.algo.ts:381-402` (`appendTransactionGroupPayload`), interacting with `contract.algo.ts:430-442` (`approveProposal`) and `contract.algo.ts:552-574` (`_executeProposalInternal`)

**Description**:

`appendTransactionGroupPayload` stores an additional payload chunk (slots 2–6) for an existing `PT_TRANSACTION_GROUP` proposal:

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
  this._assertMember(proposal.groupId)
  this._storePayloadGroup(proposalId, payloadIndex, payload)
  ...
}
```

Three properties combine into a critical bug:

1. **No proposer restriction.** `_assertMember` only checks that `Txn.sender` is *a* member of the proposal's group — not that they are `proposal.proposer`. Any member can append to any pending proposal created by anyone else in the same group.
2. **`STATUS_READY` is explicitly permitted.** The assert allows appending even after the proposal has already met its approval threshold (`STATUS_READY`). The method's own docstring ("Must be called before the proposal reaches STATUS_READY so all chunks are present when the proposal is executed") contradicts the code it documents.
3. **No approval invalidation.** Neither `appendTransactionGroupPayload` nor `_storePayloadGroup` (`contract.algo.ts:848-852`, which unconditionally overwrites `this.transactionGroups(key).value` whether or not that slot already existed) resets `proposal.approvalsCount`, `proposal.status`, or the individual `approvals` boxes. Approvals given for the payload as it existed at approval time remain valid forever after, regardless of later payload changes.

**Impact**:

Any single member of an M-of-N group (M > 1) with `ACT_PAY`/`ACT_AXFER`/etc. permission can drain funds the honest majority never agreed to move:

1. Attacker (a group member) calls `proposeTransactionGroup` with slot 1 = an innocuous, small, legitimate-looking payment. This auto-approves the attacker (1 approval).
2. One or more honest members review the visible proposal (only slot 1 exists at this point) and call `approveProposal`, bringing `approvalsCount` to the group's threshold. `proposal.status` flips to `STATUS_READY`.
3. Attacker calls `appendTransactionGroupPayload(proposalId, payloadIndex=2, payload=[largePaymentToAttacker], ...)`. This succeeds: the proposal is `PT_TRANSACTION_GROUP`, status is `STATUS_READY` (explicitly allowed), and the attacker is a group member (no proposer check). `numPayloads` advances from 1 to 2.
4. Attacker (or anyone — `executeProposal` has no membership check by design, matching common permissionless-execution patterns) calls `executeProposal`. `_executeTransactionGroup` iterates every payload slot up to `numPayloads` and stages **both** the original small payment **and** the newly appended large payment, backed only by approvals that were given before the malicious chunk existed.

The same mechanism also allows **silently replacing** the content of an *already-set* slot 2–6 (not just adding new slots), since `_storePayloadGroup` overwrites unconditionally — so even a proposal that started multi-chunk and was fully reviewed in that form can have any non-slot-1 chunk swapped out before execution.

This is a complete bypass of the core custody invariant the entire product is built on ("every privileged change is itself a governed proposal approved under the same threshold rules" — `CLAUDE.md`), for the transaction-group proposal type specifically. `PT_ADMIN` proposals are **not** affected — `proposeAdminChange` stores the entire `AdminChange` struct atomically at creation with no append/update method.

**Proof of Concept — empirically confirmed against a live LocalNet deployment** (not just static analysis): a standalone e2e test was written mirroring the existing `contract.e2e.spec.ts` conventions (`algorandFixture`, real deployed `AlgoSafe` app) and run against this exact commit's compiled bytecode:

1. Deploy and bootstrap a safe; fund it with 30 ALGO.
2. Governance creates a 2-of-2 "Treasury" group with an `attacker` account and an `honestMember` account, both with `ACT_PAY`.
3. `attacker` calls `proposeTransactionGroup` with slot 1 = a 0.5 ALGO payment to a decoy recipient (auto-approves the attacker, 1 of 2).
4. `honestMember` fetches `getTransactionGroup(pid, 1)`, confirms only the single 0.5 ALGO payment is visible, and calls `approveProposal` — `getProposal` confirms `approvalsCount = 2` and `status = 2` (`STATUS_READY`).
5. `attacker` then calls `appendTransactionGroupPayload(pid, payloadIndex=2, [19 ALGO payment to an attacker-controlled account])` — **this call succeeds** with no error, despite the proposal already being `STATUS_READY` with both approvals recorded.
6. `attacker` calls `executeProposal` — it succeeds and executes **both** payments in one atomic inner-transaction group.

**Actual result** (captured from the live LocalNet run):

```
DECOY RECEIVED: 500000n        (0.5 ALGO — the payment honestMember actually reviewed and approved)
ATTACKER PAYOUT RECEIVED: 19000000n   (19 ALGO — appended after approval, never seen by honestMember)
```

Both transfers executed from a single `executeProposal` call backed by exactly 2 approvals, only one of which (the attacker's own auto-approval) was ever given with knowledge of the 19 ALGO transfer. `honestMember`'s approval — the one that made the proposal's execution possible at all — was for a proposal that, at approval time, could only move 0.5 ALGO. This is a live, reproducible fund-drain, not a theoretical concern.

The PoC test file was written to `smart_contracts/algo_safe/poc-audit.e2e.spec.ts` for this verification and removed afterward (not committed) so as not to alter the repository as a side effect of the audit; the reproduction steps above are sufficient to reconstruct it, and a permanent version of it is recommended as the regression test in "Missing Test Scenarios" below.

**Recommendation**:

The fix must account for the fact that append-after-auto-approval is the *only* way multi-slot payloads currently work for 1-of-1 groups (the existing "splits a 6-payment group across two payload slots" test relies on this, since a 1-of-1 group reaches `STATUS_READY` immediately on creation). A blanket "no appends once `STATUS_READY`" rule would break that legitimate case. Instead:

1. **Restrict `appendTransactionGroupPayload` to `Txn.sender === proposal.proposer`.** Only the proposer who is assembling the payload should ever be able to add to it.
2. **Block appends once any approval beyond the proposer's own auto-approval exists**, i.e. `assert(proposal.approvalsCount === Uint64(1), 'cannot modify payload after independent approval')`. This preserves the 1-of-1 multi-slot use case (only ever 1 approval — the proposer's own) while closing the window entirely for any group where a second, independent signer has approved.
3. As defense in depth, consider committing to a hash of the full intended payload set at proposal-creation time (or requiring all chunks up front in a single call when they fit) so `approveProposal` can be extended in the future to bind an approval to specific payload content rather than to a proposal ID alone.
4. Fix the docstring to match whichever behavior is implemented (currently it describes the *intended* safe behavior, not the actual one).
5. Add an e2e regression test encoding the PoC above so this class of bug cannot regress silently.

---

### Medium

#### [M-01] No safeguard against a group revoking its own last `PRIV_GROUP` privilege (governance lockout)

**Severity**: Medium
**Status**: Open
**Component**: AlgoSafe
**File**: `contract.algo.ts:895-901` (`_assertPrivilegeForChange`), `contract.algo.ts:903-928` (`_validateAdminChange`, `ADM_SET_PRIVILEGES` branch), `contract.algo.ts:960-964` (`_applyAdminChange`, `ADM_SET_PRIVILEGES` branch)

**Description**: `ADM_SET_PRIVILEGES` changes are validated only for `targetGroupId` existing and `change.adminPrivileges <= PRIV_ALL` — there is no system-wide check that at least one active signer group retains `PRIV_GROUP` after the change. If the only group holding `PRIV_GROUP` votes (through its own legitimate threshold) to strip its own `adminPrivileges` down to 0 or to `PRIV_POLICY`-only, no group anywhere can ever propose `ADM_CREATE_GROUP`, `ADM_ADD_MEMBER`, `ADM_REMOVE_MEMBER`, `ADM_CHANGE_THRESHOLD`, or `ADM_SET_PRIVILEGES` again — `_assertPrivilegeForChange`'s `else` branch (everything except `ADM_SET_POLICY`) requires `PRIV_GROUP` on the proposing group.

**Impact**: This is not attacker-exploitable without control of the group's own threshold (it requires the legitimate M-of-N approval of the affected group itself), so it is a **footgun**, not a privilege-escalation bug. Because the contract is intentionally non-upgradable (`CLAUDE.md`: "non-updatable and non-deletable for custody safety"), there is no recovery path once this happens — membership, thresholds, and privileges are frozen forever. Existing `allowedActions`/`active` policy on surviving groups is unaffected, so already-authorized payments/transfers/app calls can still execute; only the ability to evolve governance is lost.

**Recommendation**: Before applying `ADM_SET_PRIVILEGES` (and `ADM_SET_ACTIVE`, which can deactivate a group entirely — `_applyAdminChange`'s final branch), assert that at least one *other* active group still holds `PRIV_GROUP`, or that the change target isn't the sole remaining `PRIV_GROUP` holder. This requires iterating groups, which has a cost — consider tracking a global counter of "groups with `PRIV_GROUP` AND active" incrementally instead of scanning at change time.

#### [M-02] Proposal threshold is snapshotted at creation; raising a group's threshold doesn't retroactively protect pending proposals

**Severity**: Medium
**Status**: Open
**Component**: AlgoSafe
**File**: `contract.algo.ts:131` (`Proposal.threshold` field), `contract.algo.ts:587` (`_newProposal` capturing `threshold: group.threshold`), `contract.algo.ts:556` (`_executeProposalInternal` checking `proposal.approvalsCount >= proposal.threshold`)

**Description**: A proposal's required threshold is captured once, at creation time, into the `Proposal` record itself. If a group's admins later raise the group's `threshold` (via `ADM_CHANGE_THRESHOLD`) — for example, in urgent response to a suspected compromised signer — any proposal that was already created (and possibly already `STATUS_READY`) under the old, lower threshold remains executable at that old threshold. The live `group.threshold` is never re-consulted for an in-flight proposal.

**Impact**: Reduced ability to respond to an in-progress compromise: raising the threshold does not retroactively invalidate proposals already approved under the weaker rule. This is mitigated by `cancelProposal`, which any group member (not just the proposer) can call on any `ACTIVE`/`READY` proposal — so a vigilant group can cancel suspicious pending proposals as a manual compensating control, but there's no automatic protection.

**Recommendation**: Document this behavior explicitly (it may be an intentional "snapshot" design, similar to nonce-based systems, rather than a bug) so operators understand that raising a threshold is not sufficient on its own to stop an in-flight proposal — they must also explicitly cancel it. Consider whether `_executeProposalInternal` should optionally re-check against the live `group.threshold` (taking the max of the two) for defense in depth.

---

### Low / Informational

#### [L-01] No cleanup of executed/cancelled proposal data — permanent box storage growth

**Severity**: Low
**Status**: Open
**Component**: AlgoSafe
**File**: `contract.algo.ts` — entire file has exactly one `.delete()` call (`contract.algo.ts:1028`, member removal); `proposals`, `approvals`, `transactionGroups`, and `adminPayloads` boxes are never deleted once created, even after a proposal reaches its terminal `EXECUTED` or `CANCELLED` state.

**Description/Impact**: Every proposal, its approvals, and its transaction-group payload chunks permanently consume box storage (and the safe's MBR) for the life of the application, with no way to reclaim it. For a long-lived, active safe with many proposals over time, this is a slow, unbounded MBR liability funded by the safe's own ALGO balance. Not directly fund-threatening at any single point, but worth surfacing as an operational cost that grows with usage and has no mitigation today.

**Recommendation**: Consider an optional, permissioned "prune" method that deletes boxes for proposals in a terminal state (`EXECUTED`/`CANCELLED`) past their `expiryRound`, refunding the reclaimed MBR to the safe. Low priority; not a security defect.

#### [I-01] `cancelProposal` grants unilateral cancellation to any group member

**Severity**: Informational
**File**: `contract.algo.ts:452-466`

Any member of a proposal's group (not just the proposer) can cancel it at any time before execution. This is very likely intentional (fast unilateral response to a suspicious pending proposal, and it directly mitigates M-02 above), but it also means a single member can grief a group by reflexively cancelling legitimate proposals they disagree with, with no counter-vote mechanism. Confirm this is the intended tradeoff; if not, consider requiring proposer-or-threshold-of-members to cancel.

---

## Missing Test Scenarios

### Missing Test: Payload mutation after independent approval (C-01 regression test)

**Description**: Verify that appending or overwriting a transaction-group payload chunk after a *second, independent* member has approved is rejected.

**Risk if Untested**: The Critical finding above ships to production undetected — exactly what happened here.

**Test Steps**:
1. Create a 2-of-2 (or 2-of-3) group.
2. Propose a small payment (slot 1); proposer auto-approves.
3. Second member calls `approveProposal` — proposal reaches `STATUS_READY`.
4. Attempt `appendTransactionGroupPayload` with a large drain payment.
5. Assert this call is rejected (once fixed) or, on current code, demonstrate that it currently succeeds and the drain payment executes (documenting the exploit as a regression guard).

**Expected Behavior** (post-fix): Step 4 raises an assertion error; the proposal executes only slot 1.

**Priority**: Critical

### Missing Test: Governance lockout via self-revoked `PRIV_GROUP` (M-01)

**Description**: A sole `PRIV_GROUP`-holding group votes to strip its own `adminPrivileges`; verify whether the contract currently permits this and, post-fix, that it's rejected.

**Priority**: Medium

### Missing Test: Threshold raised after a proposal is already `STATUS_READY` (M-02)

**Description**: Create a proposal under threshold=1, raise the group's threshold to 2 via governance, then attempt `executeProposal` and confirm current behavior (executes under the old snapshot).

**Priority**: Medium

### Missing Test: Proposal expiry exact-boundary behavior

**Description**: Approve/execute exactly at `Global.round === proposal.expiryRound` (the assert uses `<=`, so this round should still be valid) vs. one round later (should fail).

**Priority**: Low

### Missing Test: Malformed/adversarial ARC4 `data` for a declared `txType`

**Description**: Store a `SafeTxn` entry whose `data` bytes don't decode cleanly as the struct implied by `txType` (e.g. truncated or wrong-shape bytes) and confirm the contract fails safely (reverts) rather than misinterpreting fields.

**Priority**: Medium

### Missing Test: `on-chain.ts` and `get-client.ts` coverage

**Description**: `src/on-chain.ts` (3.7% statement coverage) and `src/get-client.ts` (0% coverage) have essentially no unit tests. These are the helpers most likely to be used directly by the frontend and by integrators; untested error paths here (e.g., missing box, non-existent proposal/group) risk surfacing as confusing runtime errors rather than clear client-side messages.

**Priority**: Medium

### Missing Test: Maximum-size payload (6 chunks × 16 txns) at the resource/budget boundary

**Description**: The existing test splits 6 payments across 2 slots; there's no test at the actual documented maximum (`MAX_GROUP_TXNS = 16` per slot, 6 slots), which is the scenario most likely to hit opcode-budget or inner-transaction-count limits in practice.

**Priority**: Low

---

## Documentation Gaps

### Documentation Gap: `appendTransactionGroupPayload` docstring contradicts its own implementation

**Missing/Incorrect Information**: The docstring states appends "must be called before the proposal reaches STATUS_READY," but the code's assert explicitly allows `STATUS_READY`. This is not merely stale documentation — it actively misleads a reader auditing or integrating against the method into believing a safety property exists that the code does not enforce.

**User Impact**: An integrator (or a future contributor) reading only the docstring would reasonably assume the described safeguard exists and build a mental model of the system's security around it — precisely how C-01 likely went unnoticed.

**Recommended Documentation**: Once C-01 is fixed, update the docstring to state the actual enforced rule (e.g. "must be called by the original proposer, and only while `approvalsCount === 1`"). Until fixed, the docstring should carry an explicit warning of the current gap so integrators don't rely on the described-but-unenforced behavior.

**Location**: `contract.algo.ts:376-380`

**Priority**: Critical (tied to C-01)

### Documentation Gap: No documented governance-lockout risk in `CLAUDE.md` or `PRODUCT-DESCRIPTION.md`

**Missing Information**: Neither doc mentions that revoking the last `PRIV_GROUP`-holding group's own privilege is possible and irreversible given the contract's non-upgradability.

**User Impact**: Safe operators designing their governance topology (e.g., how many admin groups to create, whether to ever reduce an admin group's own privileges) have no warning of this footgun.

**Recommended Documentation**: Add a short "Governance safety" note to `PRODUCT-DESCRIPTION.md`'s Signer Groups section warning operators to always maintain at least one group with `PRIV_GROUP` and never approve a change that would remove it from the last such group.

**Location**: `PRODUCT-DESCRIPTION.md` — Signer Groups section

**Priority**: Medium

---

## Security Best Practices — Compliance Assessment

| Practice | Status | Notes |
|---|---|---|
| Access control on privileged state changes | ⚠️ Partial | Membership/privilege checks exist throughout, but C-01 shows the *payload a signature applies to* isn't actually pinned, which is a more subtle access-control gap than a missing membership check. |
| Re-validation of authorization at execution time | ✅ | `_executeProposalInternal` re-reads the group's current `active` flag and (for admin changes) re-checks privilege against current state. |
| Threshold integrity | ⚠️ Partial | Threshold itself can't be set below 1 or above member count (good), but see M-02 for the snapshot issue. |
| Replay/double-execution protection | ✅ | `STATUS_EXECUTED` is a one-way terminal transition; re-execution is blocked by the `STATUS_READY` precondition in `_executeProposalInternal`. |
| Box storage key collision safety | ✅ | `TXG_KEY_MULT = 7 > 6` (max payload index) is correctly sized; verified no aliasing between `(proposalId, payloadIndex)` pairs. |
| Inner-transaction budget handling | ✅ | Two-pass validate-then-stage pattern correctly keeps `ensureBudget` calls outside the open `op.ITxnCreate` group, per the documented PuyaTs constraint. |
| Resource limits matching AVM consensus params | ✅ | `MAX_APP_ARGS`/`MAX_APP_ACCOUNTS`/`MAX_APP_FOREIGN_APPS`/`MAX_APP_FOREIGN_ASSETS`/`MAX_APP_TOTAL_REFS`/`MAX_APP_TOTAL_ARG_LEN` match current Algorand protocol limits and are enforced before staging. |
| Asset-config create-vs-reconfigure handling | ✅ | `_stageAssetConfig` correctly avoids setting `ConfigAsset` to 0 on create, matching the documented AVM gotcha. |
| Program size within AVM limit | ✅ | 5,391 / 8,192 bytes, healthy margin. |
| Test suite currency and coverage | ⚠️ Partial | Suite passes fully, but has a real, non-hypothetical gap (C-01) plus low coverage on two off-chain helper files. |

---

## Risk Assessment

**Overall Risk: High**, driven entirely by C-01. A contract whose stated purpose is "M-of-N signer groups govern transactions... the contract never trusts a single caller for a privileged change" (`CLAUDE.md`) currently allows exactly that for any transaction-group proposal in any group with threshold > 1: a single caller can unilaterally determine the final content executed, regardless of how many other signers approved. Every deployed safe using groups with threshold > 1 for payments/transfers/app calls/keyreg/asset-config should be considered exposed until C-01 is fixed and a fresh audit/bytecode hash confirms the fix.

The Medium findings (M-01, M-02) are governance-robustness issues, not fund-theft vectors on their own, and are appropriately lower priority. The Low/Informational findings are operational/cost concerns.

---

## Recommendations (prioritized)

1. **[Immediate / blocking]** Fix C-01: restrict `appendTransactionGroupPayload` to the original proposer and to proposals with no independent approvals yet (`approvalsCount === 1`). Bump `CONTRACT_VERSION`, rebuild, add the regression test from "Missing Test Scenarios," and re-run the full suite plus a fresh bytecode-hash audit before any group with threshold > 1 relies on multi-chunk transaction-group proposals.
2. **[High]** Add the governance-lockout guard for M-01 (require at least one surviving `PRIV_GROUP` holder after any `ADM_SET_PRIVILEGES`/`ADM_SET_ACTIVE` change), or, at minimum, document the risk prominently and add a warning test.
3. **[Medium]** Document the threshold-snapshot behavior (M-02) clearly, and consider whether pending proposals should re-check the live threshold.
4. **[Medium]** Backfill unit coverage for `on-chain.ts` and `get-client.ts`.
5. **[Low]** Consider an optional box-pruning method for terminal-state proposals to bound long-term MBR growth (L-01).
6. **[Low]** Confirm the `cancelProposal` unilateral-cancellation behavior (I-01) is an intentional product decision and document it as such.

---

## Testing Recommendations

Beyond the specific missing-test entries above, add a small suite of adversarial/state-machine tests distinct from the existing "happy path" e2e tests — the current 26 tests are almost entirely positive-path or single-actor-negative-path (e.g., "rejects approvals from non-members"); very few test *multi-actor race conditions* within a single proposal's lifecycle (approve-then-mutate, approve-then-privilege-change, approve-then-threshold-change). This class of test is exactly where C-01, M-01, and M-02 live, and is the highest-leverage area for future test investment.

---

## Compliance and Standards

- **ARC-4** ABI encoding: reviewed and consistent between on-chain structs and off-chain codecs in `safe-tx.ts` (spot-checked field order for all five transaction types).
- **ARC-28** events: emitted consistently for all state-changing operations (`SafeCreated`, `GroupCreated`, `MemberAdded`, `MemberRemoved`, `GroupUpdated`, `ProposalCreated`, `ProposalApproved`, `ProposalExecuted`, `ProposalCancelled`) — good observability for off-chain indexing/monitoring, and notably `ProposalCreated`/`ProposalApproved` do **not** currently emit anything that would let an off-chain indexer detect a post-approval payload mutation (there's no `PayloadAppended` event), which is both a monitoring gap related to C-01 and worth adding regardless of the on-chain fix, as defense in depth for detection.
- **AVM protocol limits**: program size, app-call resource limits, and inner-transaction group size all verified against current Algorand consensus parameters.

---

## Appendix

### Repository Context

```
git log -1 --format="%H %cI"
28cc9d1a64277c8dcf4080f6dfa10357e88f45d5 2026-07-06T15:08:45+02:00
```

- `smart_contracts/algo_safe/contract.algo.ts`: 1,034 lines (sole on-chain contract)
- `smart_contracts/algo_safe/contract.e2e.spec.ts`: 1,291 lines, 26 test cases
- `src/*.ts` (off-chain library): 3,222 lines total across `admin.ts`, `artifacts.ts`, `constants.ts`, `get-client.ts`, `index.ts`, `latest-client.ts`, `on-chain.ts`, `safe-tx.ts`, `version.ts`, `versioned-clients.generated.ts`
- Committed contract versions in `clients/`: 5 (`1a77ba21...`, `1bf721b1...`, `5e990dc3...` [current/latest], `ebd1cf10...`, `f555578c...`)

### Verification Notes / Limitations

- LocalNet was already running (`algokit_sandbox_algod` and peers, up 7h at audit time); no LocalNet setup was needed.
- The full suite (`pnpm build && pnpm test`) was executed fresh against this exact commit; results reported above are from that run, not cached.
- The frontend (`projects/algo-safe-frontend`) and X402 packages were not audited; findings are scoped to the contract and its direct TypeScript client library.
- C-01 was first identified by manual trace of the exact assert conditions in `appendTransactionGroupPayload`, `approveProposal`, and `_executeProposalInternal`, cross-checked against the one existing e2e test that exercises multi-slot payloads (`splits a 6-payment group across two payload slots...`) to confirm the append-after-`STATUS_READY` path is real, reachable production behavior (that test itself appends after the 1-of-1 group's proposal is already `STATUS_READY`, which is what first surfaced the gap). It was then **empirically confirmed** by writing and running a standalone exploit test against a live LocalNet deployment of this exact commit's compiled bytecode (see the Proof of Concept in finding C-01) — the drain succeeded exactly as predicted by the static analysis. The exploit test file was removed after the run; it was not committed.
