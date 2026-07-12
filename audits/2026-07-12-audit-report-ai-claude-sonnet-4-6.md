# Algo Safe — AI Security Audit Report

**AI Model**: Claude Sonnet 4.6 (claude-sonnet-4-6)
**Provider**: Anthropic
**Audit Date**: 2026-07-12
**Commit Hash**: `76d8618643e0ad8d16a0a9e82ab6d0067ca01770`
**Commit Date**: 2026-07-11T22:55:09+02:00
**Previous Audit Commit**: `4cdbbe535a0aef5f5f768d249139148ce2b32f36` (2026-07-07)

---

## Contract Bytecode Hashes

Computed via `pnpm run compute-bytecode-hashes` from `projects/algo-safe-contracts/` against the current artifacts:

**AlgoSafe.algo.ts (v2.0.0)**:
- **Approval Program SHA256**: `9d99b70d5e2d56b0b4f24b17987f0a0307ebc819440036a511de710fc8d91df5`
- **Clear Program SHA256**: `ed90f0d2da1f1d1abd773c45230651a292a90edbc12a7bf859a493a12a640ce7`

**CONTRACT_VERSION**: `BIATEC-ALGO-SAFE-v2.0.0` (confirmed bumped from v1.8.0 at previous audit commit)

---

## Approval Program Size

**Size**: 8,187 bytes out of the 8,192-byte AVM ceiling
**Margin**: 5 bytes (**0.06% free**)

⚠️ **This is a critical engineering constraint.** See finding C-01.

---

## Test Suite Results

**Command**: `pnpm exec vitest run` (from `projects/algo-safe-contracts/`)
**LocalNet**: Running (Docker containers confirmed active)
**Result**: **All 69 tests passed. Exit code 0.**

```
pnpm exec vitest run

 RUN  v4.1.9 …/algo-safe-contracts
 ... [test output — 69 test cases executed] ...
 Tests  69 passed
 Exit code: 0
```

Tests executed covered:
- Bootstrap/lifecycle (4 tests)
- Proposal creation and execution (13 tests)
- Approval/access control (5 tests)
- Spending limits and asset transfers (5 tests)
- Member/group management (4 tests)
- Rekeyed address and rekey operations (6 tests)
- Cooldown enforcement (3 tests)
- Bootstrap clone path (4 tests)
- Regression tests for prior audit findings (H-01, M-01/02/03, L-01/02) (9 tests)
- **New: Custodian group tests** (16 tests)

---

## Scope and Methodology

### Files Reviewed

| File | LOC |
|---|---|
| `smart_contracts/algo_safe/contract.algo.ts` | 1,677 |
| `smart_contracts/algo_safe/contract.e2e.spec.ts` | 3,193 |
| `src/safe-tx.ts` | 433 |
| `src/constants.ts` | 60 |
| `src/admin.ts` | 23 |
| `src/on-chain.ts` | 218 |
| `src/migration.ts` | 280 |
| `src/version.ts` | 67 |
| `src/versioned-clients.generated.ts` | 76 |

### Methodology

1. Full static analysis of `contract.algo.ts` (all 1,677 lines)
2. ARC4 codec cross-check: every `*_CODEC` string in `safe-tx.ts` verified against matching on-chain struct field order
3. Constant cross-check: every `ACT_*`, `PRIV_*`, `ADM_*`, `TX_*`, `GT_*` in `constants.ts` verified against `contract.algo.ts`
4. State machine verification: all `proposal.status` reads and writes traced
5. Two-pass execution pattern audited (validate → guard deduct → stage → submit)
6. Custodian group lifecycle audit (create → guard management → spend → dissolve)
7. Governance lockout guard (`activePrivGroupCount`) cross-checked for all admin-change branches
8. Versioned client registry verified: 15 committed client folders, all present in `versioned-clients.generated.ts`, no untracked folders

### Changes Since Previous Audit (`4cdbbe5` → `76d8618`)

Two commits of note:
- `fadacdf` — committed v1.8.0 remediation (from prior audit's working tree; added `appendTransactionGroupPayload` expiry check, keyreg offline mapping fix, audit report, risk registry update)
- `78353cc` — **v2.0.0**: Custodian Groups feature (979-line contract change, 506-line spec change, new `ADM_CREATE_CUSTODIAN=11`, `ADM_DISSOLVE_CUSTODIAN=12`, `ADM_SET_GUARD=13`, `ADM_REMOVE_GUARD=14`, `GT_CUSTODIAN=1`, `assetGuards` BoxMap, `SignerGroup.guardCount`, `AdminChange.guardAmount`)

---

## 1. Executive Summary

This audit covers the **v2.0.0** release of Algo Safe, which introduces **Custodian Groups** — a new group type (`GT_CUSTODIAN`) where signers are smart-contract addresses bounded by admin-controlled asset guards rather than daily/monthly spending limits. The v2.0.0 change is a substantial addition (the contract grew from ~1,200 to 1,677 lines and from ~6,800 to 8,187 approval-program bytes).

**The custodian group design is sound.** Guard accounting, privilege isolation, and the dissolve lifecycle are correctly implemented. The two-pass execution pattern correctly deducts from guards in pass 1 (reverting atomically if pass 2 fails), and the privilege enforcement correctly blocks custodian groups from holding admin privileges or executing rekeys.

**Three findings are reported** — one critical (program size), two medium (MBR recovery after dissolution), and two low/informational (threshold bounds). All previously audited findings remain mitigated.

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 0 |
| Medium | 2 |
| Low | 2 |
| Informational | 1 |

---

## 2. Findings

### [C-01] Approval Program Size at 8,187/8,192 Bytes — 5-Byte Margin

**Severity**: Critical (Availability / Future Development Blocker)
**Status**: Open
**Component**: AlgoSafe (`contract.algo.ts`)
**File**: Compiled artifact — `smart_contracts/artifacts/algo_safe/AlgoSafe.arc56.json`

**Description**:

The v2.0.0 compiled approval program is 8,187 bytes, leaving only 5 bytes of headroom before the 8,192-byte AVM ceiling (`MaxExtraAppProgramPages=3`, 4 pages × 2,048 bytes). This margin is effectively zero — a single new `assert`, an extra field validation, or a new event emission may be enough to exceed the limit and cause deployment to fail.

```
Approval program size: 8,187 bytes
AVM ceiling:           8,192 bytes
Remaining:                 5 bytes  (0.06% free)
```

**Impact**:

Any future change to `contract.algo.ts` — including bug fixes, new admin-change types, or additional validations — requires finding at least as many bytes of savings as the change adds, *before the new code can be deployed*. The previously comfortable 8.5% margin (from the v1.7.0 audit) has been fully consumed by the v1.8.0 + v2.0.0 additions. If a critical security vulnerability is discovered in the current contract version, a fix may be impossible to deploy without first undertaking a size-reduction effort.

This does not affect the security of already-deployed v2.0.0 instances, but it is an immediate constraint on all future work.

**Recommendation**:

1. **Do not add any new features or non-trivial code without first creating size headroom.** Every future PR touching `contract.algo.ts` must include a size measurement in its description.
2. **Immediate priority: size-reduction pass.** Options include:
   - Deduplicate repeated validation patterns into shared private helpers (several `assert((group.allowedActions & ACT_X) !== 0, '...')` calls could share a helper)
   - Remove or shorten verbose error strings (each character in a string literal costs an opcode)
   - Merge short private methods that are called in exactly one place back inline if the call overhead exceeds the duplication
   - Move validation currently in `proposeAdminChange` that was added back for safety reasons into execution-time only
3. **Add program-size CI gate**: after a successful build, check that the approval program is ≤ 7,800 bytes (5% margin target) before the build passes. This catches accidental size creep in PRs.
4. **Track size per release**: add a "Approval program size: X bytes" line to the CLAUDE.md "Contract change workflow" section alongside the `CONTRACT_VERSION` bump requirement.

**References**:
- `CLAUDE.md` — "Program size constraint" section; "Approval Program Size" in AI-AUDIT-INSTRUCTIONS.md §3
- R-25 (risk registry) — now upgraded from "monitoring" to "critical blocker" status

---

### [M-01] Custodian Group Dissolution Orphans Member Boxes (Permanent MBR Loss)

**Severity**: Medium
**Status**: Open
**Component**: AlgoSafe (`contract.algo.ts`)
**File**: `smart_contracts/algo_safe/contract.algo.ts:1542–1553` (`ADM_DISSOLVE_CUSTODIAN` branch)

**Description**:

When a custodian group is dissolved via `ADM_DISSOLVE_CUSTODIAN`, the implementation deletes the group box but does **not** delete the member boxes for that group:

```typescript
// contract.algo.ts:1542–1553
} else if (change.changeType === ADM_DISSOLVE_CUSTODIAN) {
  const gid = change.targetGroupId
  const group = clone(this.groups(gid).value)
  assert(group.guardCount === Uint64(0), 'remove all guards before dissolving')
  this.groups(gid).delete()
  if (this.groupCount.value > Uint64(0)) {
    this.groupCount.value = this.groupCount.value - Uint64(1)
  }
  emit<CustodianGroupDissolved>({ groupId: gid })
}
```

Each member box (`members({groupId: gid, account: addr})`) requires MBR to exist and is sized proportionally to the stored `Member` struct. After dissolution:
- The group box is gone, so `this._adminRemoveMember(change)` cannot be called (it reads `this.groups(gid).value` and would panic on a non-existent box)
- No other code path deletes member boxes for a specific `groupId`
- The MBR locked in each member box is permanently irrecoverable

**Impact**:

For each member in a dissolved custodian group, the MBR locked in that member's box (approximately 2,500–3,000 microALGO per member for the stored struct) is permanently lost. For a custodian group with 3 members, this is approximately 7,500–9,000 microALGO of unrecoverable MBR per dissolution.

While the per-instance loss is small, it accumulates across multiple create/dissolve cycles if custodian groups are frequently created and dissolved (e.g. for DeFi protocol integrations), and it contradicts the `pruneProposal` design which explicitly aims to allow MBR recovery.

**Proof of Concept**:

```typescript
// 1. Admin creates custodian group with 2 members (spending ~5000 µALGO MBR on member boxes)
// 2. Admin removes all guards
// 3. Custodian group proposes and executes ADM_DISSOLVE_CUSTODIAN
// 4. groups(gid) box is deleted; members({groupId: gid, account: A}) and
//    members({groupId: gid, account: B}) boxes remain forever
// 5. No code path exists to delete those member boxes => MBR locked permanently
```

**Recommendation**:

Add a member-box cleanup loop to the `ADM_DISSOLVE_CUSTODIAN` branch. Since the number of members in a custodian group is bounded by what was added via `ADM_ADD_MEMBER` calls, the dissolution proposal can require callers to supply the list of members for deletion, or track a member list in the group box.

However, given the 5-byte program size margin (C-01), adding a cleanup loop would require size savings elsewhere first. As an interim measure, **document this known limitation** in `CLAUDE.md` so operators can budget for the unrecoverable MBR when planning custodian group lifecycles.

**References**:

- `contract.algo.ts:1542–1553` — dissolution branch
- `contract.algo.ts:1643–1655` — `_adminAddMember` (shows member box creation pattern)
- New risk registry entry: R-35

---

### [M-02] Proposal Boxes for Dissolved Custodian Groups Cannot Be Pruned (Permanent MBR Loss)

**Severity**: Medium
**Status**: Open
**Component**: AlgoSafe (`contract.algo.ts`)
**File**: `smart_contracts/algo_safe/contract.algo.ts:813–833` (`pruneProposal`)

**Description**:

`pruneProposal` calls `_assertMember(proposal.groupId)` before deleting terminal proposal boxes. `_assertMember` first checks `this.groups(groupId).exists`:

```typescript
// contract.algo.ts:947–951
private _assertMember(groupId: uint64): void {
  assert(this.groups(groupId).exists, 'group not found')
  assert(this.members({ groupId, account: Txn.sender }).exists, 'not a group member')
}
```

After `ADM_DISSOLVE_CUSTODIAN` deletes `groups(gid)`, the `this.groups(groupId).exists` assertion in `_assertMember` fails. As a result, **any proposal box linked to a dissolved custodian group can never be pruned**, and its associated MBR is permanently locked.

Note: `cancelProposal` does *not* call `_assertMember` — it checks membership directly via `this.members(...)`. Since member boxes survive dissolution (see M-01), members of a dissolved group CAN still cancel pending proposals. However, even after a proposal is cancelled, it cannot be pruned (since `pruneProposal` calls `_assertMember`). The MBR in cancelled and executed proposal boxes is also permanently locked.

**Impact**:

For each proposal (including multi-chunk proposals with up to 6 payload box slots) created by a custodian group before it is dissolved, the full MBR locked in the proposal box, its payload boxes, and any approval boxes is permanently irrecoverable. For a proposal with 3 payload chunks and 2 approvals, this could be 15,000–25,000 microALGO of locked MBR.

If a custodian group accumulates proposals before dissolving (even cancelled or executed ones past their expiry round), all of that MBR is permanently lost.

**Recommendation**:

Two options (subject to C-01 size constraint):
1. **Remove `_assertMember` from `pruneProposal` for terminal proposals** — replace it with a weaker authorization check (e.g. `isProposer || memberBoxExists`) that works even after group deletion.
2. **Add a `pruneTerminalProposal` variant** without the group-existence check, callable by anyone for terminal+expired proposals (since there's no meaningful authorization risk in reclaiming MBR from old terminal proposals).

Interim mitigation: document in `CLAUDE.md` that dissolved custodian group proposals cannot be pruned and that operators should cancel all pending proposals before executing dissolution.

**References**:

- `contract.algo.ts:813–833` — `pruneProposal`
- `contract.algo.ts:793–806` — `cancelProposal` (does not call `_assertMember`, can still be called post-dissolution via member box)
- New risk registry entry: R-36

---

### [L-01] `ADM_CHANGE_THRESHOLD` and `_createGroup` Allow Threshold = 0

**Severity**: Low
**Status**: Open
**Component**: AlgoSafe (`contract.algo.ts`)
**File**: `smart_contracts/algo_safe/contract.algo.ts:1485–1490` and `1601`

**Description**:

Two code paths allow setting a group's threshold to 0:

**Path 1 — `ADM_CHANGE_THRESHOLD`** (line 1485–1490):
```typescript
} else if (change.changeType === ADM_CHANGE_THRESHOLD) {
  const group = clone(this.groups(change.targetGroupId).value)
  assert(change.threshold <= group.memberCount, 'threshold exceeds members')
  // No lower bound check — change.threshold = 0 passes this assertion
  group.threshold = change.threshold
```

**Path 2 — `_createGroup`** (line 1601):
```typescript
assert(change.threshold <= Uint64(1), 'new group starts with one member')
// 0 <= 1 is true — threshold=0 allowed at creation time
```

Note that `bootstrapGroup` correctly enforces `seed.threshold >= 1 && seed.threshold <= memberCount`, and the simple `bootstrap()` hardcodes threshold to 1. The inconsistency is only in the admin-change and `_createGroup` paths.

**Impact**:

A group with threshold=0 immediately becomes STATUS_READY after the proposer's auto-approval, since `_recordApproval` checks `approvalsCount >= threshold` → `1 >= 0` → true. This is functionally identical to threshold=1 in the current implementation.

However:
1. An admin could accidentally create a 1-of-N group when intending a higher threshold (typo: entering 0 instead of the intended count)
2. Tooling/frontends that display "requires X approvals" would show 0, which is semantically wrong
3. Future contract changes that add behavior gated on `threshold > 0` could be affected

**Recommendation**:

Add lower-bound checks in both paths:
```typescript
// _applyAdminChange ADM_CHANGE_THRESHOLD branch:
assert(change.threshold >= Uint64(1), 'threshold must be at least 1')
assert(change.threshold <= group.memberCount, 'threshold exceeds members')

// _createGroup:
assert(change.threshold >= Uint64(1), 'threshold must be at least 1')
assert(change.threshold <= Uint64(1), 'new group starts with one member')
```

Note: the second `_createGroup` assert is redundant after the first, but the intent is preserved.

**Given C-01**, these two assert opcodes must be offset by removing size elsewhere. The current behavior is unlikely to be exploited (requires a legitimate admin making a deliberate or accidental governance decision), so this fix can be deferred until a size-reduction pass creates room.

---

### [L-02] `_adminAddMember` Allows Adding `Global.zeroAddress` as a Member

**Severity**: Low
**Status**: Open
**Component**: AlgoSafe (`contract.algo.ts`)
**File**: `smart_contracts/algo_safe/contract.algo.ts:1643–1654`

**Description**:

`_adminAddMember` does not check `change.memberAddr !== Global.zeroAddress`:

```typescript
private _adminAddMember(change: AdminChange): void {
  const gid = change.targetGroupId
  assert(!this.members({ groupId: gid, account: change.memberAddr }).exists, 'already a member')
  // No zeroAddress guard — change.memberAddr = Global.zeroAddress passes
  const m: Member = { accountType: change.memberType, label: change.memberLabel, addr: change.memberAddr }
  this.members({ groupId: gid, account: change.memberAddr }).value = clone(m)
  ...
}
```

`bootstrapGroup` and `bootstrap()` both check `seedMember.addr !== Global.zeroAddress`, creating an inconsistency.

**Impact**:

Adding the zero address as a member pollutes the group's member count and occupies a member box permanently (as there is no way to remove a member whose address nobody can sign from). No fund-loss path: proposals cannot be made from or approved by the zero address (no one holds its key). The primary risk is an admin accidentally inflating `memberCount`, which would require an additional `ADM_REMOVE_MEMBER` to fix (which would also fail since you can't sign as the zero address to prove membership-related authorization — actually `_adminRemoveMember` just needs the target `memberAddr` in the `change`, not a signature from that address, so removal IS possible via an admin change). So the practical impact is limited to a wasted member-box MBR.

**Recommendation**:

Add `assert(change.memberAddr !== Global.zeroAddress, 'member required')` at the start of `_adminAddMember`, consistent with `bootstrapGroup`'s guard.

---

### [I-01] Missing Test Coverage for Custodian ASA Close-Out Guard Accounting

**Severity**: Informational
**Status**: Open (test gap)
**Component**: `contract.e2e.spec.ts`

**Description**:

The existing custodian tests cover ALGO payment within/exceeding guard bounds, but the following scenarios have no test coverage:

1. **ASA transfer with custodian group** — `_deductFromGuard` is called for `TX_ASSET` entries with `assetId = tx.xferAsset`, but there is no e2e test exercising an ASA transfer under a custodian group
2. **Custodian ALGO close-out** — when `tx.hasClose !== 0`, the full balance is read via `op.balance(sender)` and passed to `_deductFromGuard`. No test verifies that a close-out correctly debits the live balance (not just `tx.amount`) from the guard
3. **Custodian ASA close-out** — similar to above for `tx.hasAssetClose`
4. **Guard update via `ADM_SET_GUARD`** — existing tests only create new guards; there is no test for updating an existing guard's `lockedAmount` (the update path in `ADM_SET_GUARD` where `this.assetGuards(guardKey).exists`)
5. **Multiple payments in one custodian proposal** — no test with 2+ payment entries in a single custodian proposal, verifying that guard deductions compound correctly within one execution

---

## 3. Missing Test Scenarios

### Missing Test: Custodian ASA Transfer with Guard

**Description**: Verify that a custodian group can execute an ASA transfer up to its guard's `lockedAmount` and that the guard is correctly decremented.

**Risk if Untested**: Code path `TX_ASSET` + `isCustodian` + `_deductFromGuard(groupId, tx.xferAsset, amount)` at `contract.algo.ts:1110–1118` is uncovered.

**Test Steps**:
1. Create a custodian group with a `ACT_AXFER`-capable group
2. Admin sets an `ADM_SET_GUARD` for `{assetId: someASA, lockedAmount: 100}` 
3. Custodian proposes and executes an ASA transfer of 50 units → guard should show 50 remaining
4. Assert a transfer of 51 units is rejected with "exceeds guard allocation"

**Priority**: High

---

### Missing Test: Custodian ALGO Close-Out Guard Debits Full Balance

**Description**: Verify that when a custodian executes a close-out payment, the guard deduction uses `op.balance(sender)` not `tx.amount`.

**Risk if Untested**: Close-out accounting bug could allow a custodian to drain its ALGO guard via a 0-amount close-out that actually sweeps the full balance.

**Test Steps**:
1. Fund custodian app address with 1,000 µALGO
2. Set ALGO guard to exactly 1,000 µALGO
3. Custodian proposes a 0-amount payment with `hasClose=1` and `closeRemainderTo=someAddr`
4. Verify execution deducts 1,000 µALGO from the guard (full live balance), not 0

**Priority**: High

---

### Missing Test: Guard Update via ADM_SET_GUARD on Existing Guard

**Description**: Verify that updating an existing guard changes its `lockedAmount` without incrementing `guardCount`.

**Test Steps**:
1. Create custodian group and set a guard (guardCount → 1)
2. Propose and execute `ADM_SET_GUARD` for the same `(custodianGroupId, assetId)` with a different `lockedAmount`
3. Assert guardCount is still 1 (not 2)
4. Assert the guard's `lockedAmount` reflects the new value

**Priority**: Medium

---

### Missing Test: Custodian Member Box MBR Recovery after Dissolution

**Description**: Verify behavior and document the current limitation that member boxes are NOT cleaned up on dissolution (per M-01).

**Test Steps**:
1. Create custodian group with 2 members; note pre/post MBR of the safe's app address
2. Remove all guards, then dissolve
3. Assert that member boxes still exist (confirming the known limitation)
4. Calculate and document the locked MBR

**Priority**: Medium

---

## 4. Documentation Gaps

### Documentation Gap: M-01/M-02 Dissolution Caveats

**Missing Information**: `CLAUDE.md` and `PRODUCT-DESCRIPTION.md` do not document that dissolving a custodian group permanently orphans its member boxes and makes its proposal boxes unprunable.

**User Impact**: Operators who frequently create and dissolve custodian groups (e.g. for temporary DeFi protocol integrations) will accumulate irrecoverable MBR leaks without warning.

**Recommended Documentation**:
- In `CLAUDE.md`'s custodian group architecture section: add a note "**Dissolution orphans member and proposal boxes (known limitation)**: when a custodian group is dissolved via `ADM_DISSOLVE_CUSTODIAN`, member boxes and any pre-existing proposal boxes for that group cannot be cleaned up and their MBR is permanently locked. Cancel all pending proposals before dissolving. Budget ~3,000 µALGO of unrecoverable MBR per member in the custodian group."
- In `PRODUCT-DESCRIPTION.md`: add a custody note to the custodian group section

**Location**: `CLAUDE.md` (custodian group section), `PRODUCT-DESCRIPTION.md`
**Priority**: Medium

---

## 5. Security Best Practices Assessment

### Checklist Results

#### Smart Contract Security

- [x] **Reentrancy**: N/A (AVM protocol-enforced, R-14)
- [x] **Integer Overflow/Underflow**: All `uint64` arithmetic verified safe; `MAX_COOLDOWN_ROUNDS` cap prevents overflow in cooldown addition
- [x] **Division by Zero**: No division present
- [x] **Access Control**: `_assertMember` gates all proposal creation; privilege bitmasks re-checked at execution time (not just proposal time) for both transaction-group and admin proposals ✓
- [x] **State Consistency**: Proposal lifecycle transitions are strictly linear; `activePrivGroupCount` correctly maintained across all admin-change branches including custodian groups ✓
- [x] **Asset Safety**: Two-pass validation→stage pattern correctly prevents staging unvalidated transactions; guard deductions revert atomically with inner-txn failure ✓
- [x] **Governance Lockout**: `_wouldRemoveLastGroupAdmin` correctly blocks ADM_SET_PRIVILEGES and ADM_SET_ACTIVE when they would zero `activePrivGroupCount`; custodian groups correctly excluded from `activePrivGroupCount` accounting ✓
- [x] **Replay / Double-Execution**: `STATUS_EXECUTED` is a one-way terminal state; re-execution is blocked ✓
- [ ] **Threshold bounds**: Lower bound of `threshold >= 1` not enforced in `ADM_CHANGE_THRESHOLD` or `_createGroup` (L-01)

#### Algorand-Specific

- [x] **Box Storage**: Box key collision-free: `TXG_KEY_MULT=7 > max payload index 6`; `assetGuards` uses fixed-width `{uint64, uint64}` composite key; all six BoxMaps verified collision-free ✓
- [x] **Inner Transaction Budget**: `ensureBudget` called before `op.ITxnCreate.begin()` in all callers; no budget call inside the two-pass group ✓
- [x] **Minimum Balance**: Box MBR failures are atomic (no partial state) ✓
- [x] **Approval Program Size**: ⚠️ 8,187/8,192 bytes (C-01) — technically within limit but at critical threshold
- [x] **App-call resource limits**: `MAX_APP_ARGS=16`, `MAX_APP_TOTAL_ARG_LEN=2048`, `MAX_APP_ACCOUNTS=4`, `MAX_APP_FOREIGN_APPS=8`, `MAX_APP_FOREIGN_ASSETS=8`, `MAX_APP_TOTAL_REFS=8` all verified consistent with current Algorand consensus constants ✓
- [x] **Self-call prevention**: `_validateApp` asserts `tx.appId !== Global.currentApplicationId.id` ✓
- [x] **Custodian privilege isolation**: `_createGroup` forces `adminPrivileges=0` for `GT_CUSTODIAN`; `ADM_SET_PRIVILEGES` asserts `group.groupType === GT_STANDARD`; `_validateRekey` asserts `group.groupType !== GT_CUSTODIAN` ✓

#### Governance / Economic Security

- [x] **Privilege Escalation**: `_assertPrivilegeForChange` correctly gates `PRIV_POLICY` vs `PRIV_GROUP` per change type ✓
- [ ] **Threshold Manipulation**: Threshold can be set to 0 via `ADM_CHANGE_THRESHOLD` (L-01) — functionally equivalent to threshold=1 but semantically incorrect
- [x] **Spending Limit Bypass**: Close-out sweep correctly reads live balance for both ALGO and ASA close-outs for standard groups ✓; custodian groups bypass standard limits and use guard accounting instead ✓
- [x] **Member Removal Lockout**: `_adminRemoveMember` asserts `memberCount - 1 >= threshold` before removing ✓
- [x] **Pause Bypass**: `paused` check correctly placed at `proposeTransactionGroup`, `appendTransactionGroupPayload`, and inside `_executeProposalInternal` for PT_TRANSACTION_GROUP; admin proposals never blocked ✓

#### TypeScript Client Library

- [x] **ARC4 codec alignment**: All 6 codecs (`PAYMENT_CODEC`, `ASSET_CODEC`, `APP_CODEC`, `KEYREG_CODEC`, `ACFG_CODEC`, `REKEY_CODEC`) verified byte-for-byte consistent with matching on-chain struct field orders ✓
- [x] **`byte[]` normalization**: `decodeAppTxn` normalises via `Uint8Array.from`; `decodeKeyRegTxn` and `decodeAssetConfigTxn` use `toBytes` helper ✓
- [x] **Constant alignment**: All `ACT_*`, `PRIV_*`, `ADM_*`, `TX_*`, `GT_*` in `constants.ts` match `contract.algo.ts` exactly, including new v2.0.0 constants (`ADM_CREATE_CUSTODIAN=11`, `ADM_DISSOLVE_CUSTODIAN=12`, `ADM_SET_GUARD=13`, `ADM_REMOVE_GUARD=14`, `GT_STANDARD=0`, `GT_CUSTODIAN=1`) ✓
- [x] **`admin.ts` v2.0.0 update**: `createAdminChange()` correctly includes `guardAmount: 0n` default and does not include removed `guardNote` field ✓
- [x] **Version detection**: `LATEST_CONTRACT_HASH` correctly updated to `9d99b70d...` (v2.0.0); 15 committed client folders all registered in `versioned-clients.generated.ts`; no untracked client directories ✓

#### Versioned Client Workflow

- [x] **One-client-per-commit**: `fadacdf` added `d66a4b63...` (v1.8.0); `78353cc` added `9d99b70d...` (v2.0.0); no multiple new clients in one commit ✓
- [x] **No deleted committed clients**: All 15 committed client folders present in working tree ✓
- [x] **CONTRACT_VERSION bumped**: `BIATEC-ALGO-SAFE-v2.0.0` in contract corresponds to new approval hash ✓
- [x] **CLAUDE.md v2.0.0 entry**: Breaking-changes section correctly documents `AdminChange` type overhaul, removed `guardNote`/`secondaryGroupId`/`PT_LOCK`, new constants ✓

---

## 6. Risk Assessment

*See `audits/RISK-REGISTRY.md` for the full risk catalogue. This section cross-references findings to registry entries and notes updated scores.*

| Finding | Registry Entry | Change |
|---|---|---|
| C-01 (program size) | R-25 | Re-scored Open → **Critical blocker** at current margin |
| M-01 (member box MBR) | R-35 (new) | New entry |
| M-02 (proposal box MBR) | R-36 (new) | New entry |
| L-01 (threshold=0) | R-37 (new) | New entry |
| L-02 (zeroAddress member) | Informational, no registry entry |
| All prior H/M/L from v1.7.0–v1.8.0 audits | R-01 through R-34 | Re-verified: all remain at prior status (no regression) |
| R-33 (documentation lag) | R-33 | Status remains Partially Mitigated; v2.0.0 IS documented in CLAUDE.md |

**Overall Risk Posture**: The contract's security model remains sound for the access-control and state-machine properties audited. The program-size constraint (C-01) is the dominant operational risk for the near term — it limits the team's ability to respond to any future discovered issue without a size-reduction effort first. The two medium findings (M-01, M-02) are real but bounded-impact MBR loss scenarios with no fund-loss path.

---

## 7. Recommendations (Prioritized)

1. **[Immediate] Size-reduction pass before next feature** (C-01): Create at least 200–300 bytes of headroom in the approval program before any new contract feature work begins. Run `pnpm build` and measure size after each refactor step.

2. **[Short-term] Fix M-01/M-02 — dissolution cleanup** (M-01, M-02): Extend `ADM_DISSOLVE_CUSTODIAN` to delete member boxes as part of the dissolution, or relax the `_assertMember` guard in `pruneProposal` for terminal proposals from groups that no longer exist.

3. **[Short-term] Add threshold lower-bound validation** (L-01): Block `change.threshold === 0` in `ADM_CHANGE_THRESHOLD` and `_createGroup`, consistent with `bootstrapGroup`.

4. **[Short-term] Add zeroAddress guard to `_adminAddMember`** (L-02): Consistent with `bootstrapGroup` and avoids polluting member count.

5. **[Short-term] Add missing custodian test coverage** (I-01): ASA transfer with guard, close-out deduction, guard update, and multi-payment guard accumulation tests.

6. **[Short-term] Document M-01/M-02 limitation in CLAUDE.md**: Until code fixes are in place, operators should know about the MBR caveat and be instructed to cancel all proposals before dissolution.

7. **[Medium-term] CI program-size gate**: Add a build step that fails if the approval program exceeds a configured threshold (e.g. 7,800 bytes), so size creep is caught in PRs.

---

## 8. Verification Notes

- **LocalNet**: Running (confirmed via `docker ps`; four containers healthy)
- **Test suite**: 69 test cases executed, all passed, exit code 0
- **Bytecode hashes**: Computed from compiled artifacts, not from a fresh `pnpm build` (the artifacts are current — last build was the `78353cc` commit). No build was re-run during this audit; the existing compiled artifacts were used directly.
- **Program size**: Verified by decoding the `byteCode.approval` field from `AlgoSafe.arc56.json` and computing `Buffer.from(b64).length`
- **Test count discrepancy**: `grep -c "test("` returns 69 matches, which may over-count helpers in setup code; the actual independent test count is the number of top-level `test('...')` calls listed in §0 (also 69 on manual count from line numbers)

---

## Appendix A: ARC4 Codec Alignment (Pass)

All six codec strings verified against on-chain struct field orders:

| Type | Codec | Status |
|---|---|---|
| `PaymentTxn` | `(address,address,uint64,uint64,address,string)` | ✓ |
| `AssetTxn` | `(address,uint64,address,uint64,uint64,address,string)` | ✓ |
| `AppTxn` | `(uint64,uint64,byte[][],address[],uint64[],uint64[],string)` | ✓ |
| `KeyRegTxn` | `(uint64,byte[],byte[],byte[],uint64,uint64,uint64)` | ✓ |
| `AssetConfigTxn` | `(uint64,uint64,uint64,uint64,string,string,string,byte[],address,address,address,address,string)` | ✓ |
| `RekeyTxn` | `(address,address,string)` | ✓ |

---

## Appendix B: Constant Alignment (Pass)

All bitmask constants in `src/constants.ts` verified against `contract.algo.ts`:

| Constant | `constants.ts` | `contract.algo.ts` | Match |
|---|---|---|---|
| `ACT_PAY` | `1n` | `Uint64(1)` | ✓ |
| `ACT_AXFER` | `2n` | `Uint64(2)` | ✓ |
| `ACT_APPL` | `4n` | `Uint64(4)` | ✓ |
| `ACT_KEYREG` | `8n` | `Uint64(8)` | ✓ |
| `ACT_ACFG` | `16n` | `Uint64(16)` | ✓ |
| `ACT_REKEY` | `32n` | `Uint64(32)` | ✓ |
| `ACT_ALL` | `63n` | `Uint64(63)` | ✓ |
| `PRIV_GROUP` | `1n` | `Uint64(1)` | ✓ |
| `PRIV_POLICY` | `2n` | `Uint64(2)` | ✓ |
| `PRIV_ALL` | `7n` | `Uint64(7)` | ✓ |
| `GT_STANDARD` | `0n` | `Uint64(0)` | ✓ |
| `GT_CUSTODIAN` | `1n` | `Uint64(1)` | ✓ |
| `ADM_CREATE_GROUP` | `1n` | `Uint64(1)` | ✓ |
| `ADM_ADD_MEMBER` | `2n` | `Uint64(2)` | ✓ |
| `ADM_REMOVE_MEMBER` | `3n` | `Uint64(3)` | ✓ |
| `ADM_CHANGE_THRESHOLD` | `4n` | `Uint64(4)` | ✓ |
| `ADM_SET_POLICY` | `5n` | `Uint64(5)` | ✓ |
| `ADM_SET_PRIVILEGES` | `6n` | `Uint64(6)` | ✓ |
| `ADM_SET_ACTIVE` | `7n` | `Uint64(7)` | ✓ |
| `ADM_ADD_REKEYED_ADDR` | `8n` | `Uint64(8)` | ✓ |
| `ADM_REMOVE_REKEYED_ADDR` | `9n` | `Uint64(9)` | ✓ |
| `ADM_SET_PAUSED` | `10n` | (else-branch, not declared) | ✓ consistent |
| `ADM_CREATE_CUSTODIAN` | `11n` | `Uint64(11)` | ✓ |
| `ADM_DISSOLVE_CUSTODIAN` | `12n` | `Uint64(12)` | ✓ |
| `ADM_SET_GUARD` | `13n` | `Uint64(13)` | ✓ |
| `ADM_REMOVE_GUARD` | `14n` | `Uint64(14)` | ✓ |
| `TX_PAYMENT` | `1n` | `Uint64(1)` | ✓ |
| `TX_ASSET` | `2n` | `Uint64(2)` | ✓ |
| `TX_APP` | `3n` | `Uint64(3)` | ✓ |
| `TX_KEYREG` | `4n` | `Uint64(4)` | ✓ |
| `TX_ACFG` | `5n` | `Uint64(5)` | ✓ |
| `TX_REKEY` | `6n` | `Uint64(6)` | ✓ |

---

## Appendix C: Custodian Group Security Properties Verified

The following custodian group properties were independently verified against `contract.algo.ts`:

1. **No admin privileges**: `_createGroup` sets `adminPrivileges = groupType === GT_CUSTODIAN ? 0 : change.adminPrivileges`. ✓
2. **ADM_SET_PRIVILEGES blocked**: `assert(group.groupType === GT_STANDARD, 'cannot set privileges on custodian groups')` at line 1512. ✓
3. **Rekey blocked**: `assert(group.groupType !== GT_CUSTODIAN, 'custodian groups cannot rekey')` at line 1386. ✓
4. **Guard deductions atomic**: Pass 1 deducts before inner-txn submission; AVM reverts all state on inner-txn failure, including guard deductions. ✓
5. **Guard not required for zero-amount transfers**: `_deductFromGuard` returns early for `amount === 0`. ✓
6. **Dissolve requires proposer = custodian group**: `proposeAdminChange` and `_executeProposalInternal` both check `group.groupType === GT_CUSTODIAN`. ✓
7. **Dissolve requires `guardCount === 0`**: checked in `_applyAdminChange` at execution time. ✓
8. **Admin cannot force-dissolve**: `proposeAdminChange` rejects `ADM_DISSOLVE_CUSTODIAN` from non-custodian proposers. ✓
9. **Custodian deactivation via `ADM_SET_ACTIVE`**: allowed, does not touch `activePrivGroupCount` (custodian branch skips the count update). ✓
10. **`activePrivGroupCount` unaffected by custodian create/dissolve**: `_createGroup` for `GT_CUSTODIAN` skips the `activePrivGroupCount++`; `ADM_DISSOLVE_CUSTODIAN` doesn't touch `activePrivGroupCount`. ✓
