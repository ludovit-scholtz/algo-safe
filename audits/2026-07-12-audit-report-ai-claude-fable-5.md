# Algo Safe — AI Security Audit Report

## 1. Audit Metadata

**AI Model**: Claude Fable 5 (claude-fable-5)
**Provider**: Anthropic
**Audit Date**: 2026-07-12
**Commit Hash**: `d2baaaba9374a5b26feb56441f6728be0bab1a7c`
**Commit Date**: 2026-07-12T23:44:01+02:00
**Previous Audit Commit**: `76d8618643e0ad8d16a0a9e82ab6d0067ca01770` (2026-07-12, Claude Sonnet 4.6, v2.0.0)

This audit focuses on the delta shipped since the previous audit — contract **v3.0.0** (payload-validation externalisation to the hash-pinned `AlgoSafeTxnValidator` library contract, removal of all 12 read-only ABI getters, the shared `smart_contracts/shared/types.ts` module, the `_seedGroup` bootstrap consolidation, and the 2026-07-12 audit remediations M-01/M-02/L-01/L-02) — plus a full re-review of the complete `AlgoSafe` contract and the off-chain library against the checklist in `audits/AI-AUDIT-INSTRUCTIONS.md`.

### Contract Bytecode Hashes

Computed via `pnpm run compute-bytecode-hashes` from `projects/algo-safe-contracts/` after a fresh `pnpm build` at the audited commit:

**AlgoSafe** (`smart_contracts/algo_safe/contract.algo.ts`, v3.0.0):
- **Approval Program SHA256**: `8a9073ec02dd208e4757e57180a96b452e074c1731c7ecccdabdbe8dc7f3acee`
- **Clear Program SHA256**: `ed90f0d2da1f1d1abd773c45230651a292a90edbc12a7bf859a493a12a640ce7`

**AlgoSafeTxnValidator** (`smart_contracts/algo_safe_validator/contract.algo.ts`, new in v3.0.0):
- **Approval Program SHA256**: `0dd692344f80e7d5770f47bcde26c31eaaf24d45b5d177dfcbc7241742e188b1` (418 bytes)
- **Clear Program SHA256**: `ed90f0d2da1f1d1abd773c45230651a292a90edbc12a7bf859a493a12a640ce7`

The validator's approval hash **matches** the pin in `smart_contracts/algo_safe/validator-hash.generated.ts` (`VALIDATOR_APPROVAL_SHA256_HEX`), i.e. the safe's on-chain `createApplication` hash check pins exactly the audited validator bytecode. ✔

**CONTRACT_VERSION**: `BIATEC-ALGO-SAFE-v3.0.0` (`contract.algo.ts:148`) — correctly bumped from v2.0.0 at the previous audit commit. ✔
**One-client-per-commit rule**: exactly one new `clients/<hash>/` folder (`8a9073ec…`) was added since the last audited commit; `src/versioned-clients.generated.ts` and `src/latest-client.ts` both reference it as `LATEST_CONTRACT_HASH`. ✔
**Working tree**: clean at the audited commit (all v3.0.0 changes are committed to `main`). ✔

### Approval Program Size

**Size**: 6,968 bytes of the 8,192-byte AVM ceiling — **1,224 bytes (15%) free**.
The CI gate (`scripts/check-program-size.ts`, wired into `pnpm build`) passes with its 7,800-byte threshold. The previous audit's C-01 (5-byte margin) is confirmed resolved at the committed code.

### Test Suite Results

**Commands**: `pnpm build` then `pnpm test` (Vitest, unit + e2e), from `projects/algo-safe-contracts/`, against a running LocalNet (algod 4.7.3, dockernet-v1).

**Result**: **All 84 tests passed (4 test files), exit code 0.** (Run twice: once as `pnpm test` with coverage, once as `pnpm exec vitest run` to capture the summary — identical results.)

```
 Test Files  4 passed (4)
      Tests  84 passed (84)
   Duration  422.90s
```

- `smart_contracts/algo_safe/contract.e2e.spec.ts` — 76 e2e tests (deploys the real compiled v3.0.0 contract + validator per fixture)
- `src/on-chain.e2e.spec.ts` — box/state reader tests against a live deployment
- `src/version.spec.ts`, `src/get-client.spec.ts` — unit tests

No failing tests. Coverage of the v3.0.0 remediations (M-01 dissolution member box, M-02 prune-after-dissolve, L-01 threshold bounds, L-02 zero-address member) is present and passing.

---

## Remediation Update (2026-07-13, contract v3.1.0)

All findings from this report were remediated in the same session, shipping as contract **v3.1.0** (working tree; approval hash `0ec5f00067169dae3414cffd9f2e04d8e2a91884d7fd0eb903c31aa409da6ead`, 7,043/8,192 bytes, CI size gate green). **89/89 contract tests pass** on LocalNet (5 new Fable-5 regression tests added).

| ID | Status | Remediation |
|---|---|---|
| M-01 | **Fixed** | Shared `_assertCustodianActions` asserts `allowedActions <= (ACT_PAY \| ACT_AXFER)` for custodian groups in `_seedGroup`, `_createGroup`, and `ADM_SET_POLICY`. Regression test added. |
| M-02 | **Fixed (doc)** | `PRODUCT-DESCRIPTION.md` updated: removed-getters → `src/on-chain.ts` readers, new "Validator Library Contract" section, `createApplication(name, validatorAppId)` signature, guard-scope note. `CLAUDE.md` gained a v3.1.0 bullet. (Structural R-33 recurrence still needs a CI doc-sync check.) |
| L-01 | **Fixed** | `_createGroup` now rejects the zero-address initial member. Regression test covers `ADM_CREATE_GROUP` + `ADM_CREATE_CUSTODIAN`. |
| L-02 | **Fixed** | `ADM_ADD_REKEYED_ADDR` rejects the zero address; `buildMigrationRekeyPayload` throws on one. Regression test added. |
| I-01 | **Fixed** | `_createGroup` bounds `allowedActions <= ACT_ALL` and `adminPrivileges <= PRIV_ALL`. Regression test added. |
| I-04 | **Fixed** | Validator pin-rejection e2e test added (impostor NoOp app + nonexistent app id). |

**Frontend feature work (same session)** — closing the gap between contract capabilities and the UI: custodian asset-guard management (view/set/remove guards via a live `'ag'` box scan, new `listAssetGuards` reader), member removal, custodian-group creation, a general create-signer-group flow (standard + custodian), and a safe-wide **emergency pause/unpause** control (previously no UI existed for `ADM_SET_PAUSED`). The dissolve-custodian flow was corrected to pass the required last-member `memberAddr` (v3.0.0 M-01 ABI change). The frontend's version branch was fixed to treat all modern-ABI versions (v3.0.0 + v3.1.0) as "latest" via a new `hasModernAbi` helper — a bare `=== LATEST_CONTRACT_HASH` check would have mis-routed v3.0.0 safes to the removed legacy getters. Adding the v3.1.0 client tipped the cross-version client union past TypeScript's complexity limit (TS2590); `getClient`'s return type was narrowed to the latest-constructor type, which collapses the union at every call site and prevents recurrence on future versions. 3 new Playwright governance tests added (all passing).

---

## 2. Executive Summary

The v3.0.0 release is a **well-executed size-reduction and hardening release**. The central architectural change — moving payload validation for pay/axfer/keyreg/acfg/rekey into a stateless, immutable, bytecode-hash-pinned library contract called via inner app call — is sound:

- The pinning design is correct: `createApplication` verifies `sha256(approvalProgram(validatorAppId))` against a compile-time constant, and the pinned bytecode contains no update/delete handlers, so a one-time check holds for the safe's lifetime. The off-chain registry (`VALIDATOR_DEPLOYMENTS`) is defense-in-depth only; a wrong entry cannot be pinned.
- The validation rules in `AlgoSafeTxnValidator.validateTxn` are semantically equivalent to the v2.0.0 in-contract checks (verified rule-by-rule), and both contracts import the payload structs and bitmask constants from a single shared module, eliminating intra-repo layout-drift risk.
- The proposal state machine, threshold/epoch/cooldown enforcement, spending-limit and guard accounting, and the M-01 governance-lockout counter were all re-verified against the full checklist — **no Critical or High severity findings**.

The audit identified **2 Medium and 2 Low** severity findings plus informational items:

| ID | Severity | Finding |
|---|---|---|
| M-01 | Medium | Custodian guard containment does not cover `ACT_APPL`/`ACT_ACFG` — the documented "cannot exceed guard allocation even if compromised" property only holds for pay/axfer |
| M-02 | Medium | `PRODUCT-DESCRIPTION.md` is stale relative to v3.0.0 (documents removed getters; validator architecture absent) — recurrence of registry risk R-33 |
| L-01 | Low | `_createGroup` accepts `Global.zeroAddress` as the initial member (the prior audit's L-02 fix covered `_adminAddMember` only) |
| L-02 | Low | `ADM_ADD_REKEYED_ADDR` accepts the zero address, unlike `bootstrapRekeyedAddress`; a zero entry corrupts the migration rekey payload |
| I-01 | Info | `_createGroup` does not bound `allowedActions`/`adminPrivileges` to `ACT_ALL`/`PRIV_ALL` (unlike `_seedGroup`) |
| I-02 | Info | `executeProposal` is deliberately permissionless and `approveProposal` does not check `group.active`; both are safe but undocumented |
| I-03 | Info | Custodian self-dissolution requires admin cooperation in practice (guards and extra members are admin-removable only) |
| I-04 | Info | Test gaps: validator-pin failure path, custodian `ACT_APPL` behavior, zero-address `_createGroup` member |

---

## 3. Scope and Methodology

**In scope** (at commit `d2baaab`):

- `projects/algo-safe-contracts/smart_contracts/algo_safe/contract.algo.ts` (1,488 lines) — full review
- `projects/algo-safe-contracts/smart_contracts/algo_safe_validator/contract.algo.ts` (118 lines) — full review (new)
- `projects/algo-safe-contracts/smart_contracts/shared/types.ts` (101 lines) — full review (new)
- `projects/algo-safe-contracts/src/*.ts` — client library review with emphasis on the new/changed files (`validator.ts`, `on-chain.ts`, `safe-tx.ts`, `constants.ts`, `version.ts`, `migration.ts`, `versioned-clients.generated.ts`)
- `smart_contracts/algo_safe/validator-hash.generated.ts` + `scripts/sync-validator-hash.ts` + `scripts/check-program-size.ts` (build-pipeline integrity)
- Documentation: `CLAUDE.md`, `PRODUCT-DESCRIPTION.md`, `audits/RISK-REGISTRY.md`

**Methodology**: per `audits/AI-AUDIT-INSTRUCTIONS.md` v3.0 — state-machine verification of the proposal lifecycle; data-flow tracing of `SafeTxn` payloads (wire → box → decode → validate → stage → submit); access-control matrix per `ADM_*` change type; economic-accounting review of `_accountSpend`/`_deductFromGuard`; codec/constant drift check between `shared/types.ts`, `constants.ts`, and the `safe-tx.ts` ABI type strings; fresh build + full test-suite execution on LocalNet; bytecode-hash and program-size verification.

### v3.0.0 delta verification highlights

1. **Validator equivalence** — each rule the v2.0.0 contract enforced in `_validatePayment`/`_validateAsset`/`_validateKeyReg`/`_validateAssetConfig`/`_validateRekey` is present in `validateTxn` with identical semantics: action-bit gating, nonzero receiver/asset/close-target checks, metadataHash 0-or-32 bounds, and the rekey triple-gate (`ACT_REKEY` + `PRIV_GROUP` + not custodian). The bitmask arguments are passed from the **live** group state read in `_executeProposalInternal`, preserving the check-at-execution-time property (the historical H-01 class).
2. **Pinning soundness** — `createApplication` (contract.algo.ts:399-403) reads the target app's approval program via `op.AppParams.appApprovalProgram` and compares its sha256 to `VALIDATOR_APPROVAL_SHA256_HEX`, which `scripts/sync-validator-hash.ts` regenerates from the compiled artifact on every build (stale-hash builds fail loudly). The validator declares no update/delete paths, so the PuyaTs ARC-4 router rejects both permanently — a hash-verified app ID can never change behavior. The clear program is not pinned, but the validator holds no state and is never opted into, so the clear program is unreachable in this trust model.
3. **`TX_APP` residency** — app-call validation stays in the safe (`_validateApp`) because appArgs can total 2,048 bytes (cannot transit the inner-call arg pipe). `_validateApp` retains the self-call guard, `onCompletion` bounds (≤5, ≠4), and all resource-limit checks against current consensus parameters (verified: 16 args / 2,048 bytes / 4 accounts / 8 apps / 8 assets / 8 total refs — all still correct as of this audit).
4. **Getter removal** — the replacement readers in `src/on-chain.ts` use the typed clients' `state.box.*`/`state.global.*` accessors, normalise missing boxes to `undefined`, and use the correct `proposalId * 7 + payloadIndex` key for payload chunks (matching `TXG_KEY_MULT`). `readSafeConfig` correctly aggregates the former `getConfig` + `getActivePrivGroupCount`.
5. **Two-pass execution integrity** — pass 1 (validate + spend/guard accounting + all `ensureBudget`/inner validator calls) completes before pass 2 opens the `op.ITxnCreate` group; nothing is staged in pass 2 that pass 1 did not validate (both passes iterate the identical box contents, and no write to `transactionGroups` boxes can occur between them within the same app call). `ensureBudget` is never reachable while the itxn group is open. ✔
6. **State machine** — re-verified: `EXECUTED` reachable only from `READY` (checked before any mutation), `CANCELLED` only from `ACTIVE`/`READY`, no path mutates `groupId`/`payloadType`/`proposer` post-creation, approvals bound to `payloadVersion`, epoch invalidation enforced at both approve and execute. Double-execution impossible (`status` flips before returning; re-entry blocked by AVM no-self-call). ✔

---

## 4. Findings

### [M-01] Custodian Guard Containment Does Not Cover `ACT_APPL` / `ACT_ACFG`

**Severity**: Medium
**Status**: Open
**Component**: AlgoSafe (contract.algo.ts)
**File**: `smart_contracts/algo_safe/contract.algo.ts:61-67` (design docstring), `:942-975` (guard accounting), `:1404-1431` (`_createGroup`), `:1290-1307` (`ADM_SET_POLICY`)

**Description**:
The custodian design docstring states: *"Custodians have no admin privileges and cannot exceed their per-asset guard allocation even if the underlying protocol is compromised."* This containment property is only enforced for value moved by `TX_PAYMENT` and `TX_ASSET` entries — the only two types routed through `_deductFromGuard`. However:

1. `ADM_CREATE_CUSTODIAN` → `_createGroup` copies `change.allowedActions` into the custodian group **without restricting it** to the guard-accounted action bits. An admin can (deliberately or by leaving a default `ACT_ALL & ~ACT_REKEY` in tooling) grant a custodian `ACT_APPL` or `ACT_ACFG`.
2. `ADM_SET_POLICY` can target a custodian group and widen its `allowedActions` the same way.
3. In `_executeTransactionGroup`, `TX_APP` entries bypass guard accounting entirely (validated by `_validateApp`, which checks only the `ACT_APPL` bit), and `TX_ACFG`/`TX_KEYREG` return `amount = 0` from the validator, so `_deductFromGuard` no-ops.

A custodian holding `ACT_APPL` can make **arbitrary application calls with the safe's authority** — e.g. withdraw the safe's deposits from an external DeFi protocol to an attacker address, or trigger clawback transfers if the safe holds a clawback role — moving value that no asset guard bounds. A custodian holding `ACT_ACFG` can reconfigure any asset for which the safe holds the manager role (e.g. set the clawback address). Since the custodian threat model explicitly assumes the custodian's signer (a protocol smart contract) **may be compromised**, this breaks the feature's stated security property whenever a non-transfer action bit is granted.

**Impact**:
Conditional on an admin granting a custodian group action bits beyond `ACT_PAY|ACT_AXFER`. Admins are trusted, so this is a configuration foot-gun amplified by a documented guarantee that does not hold — an integrator reading the docstring (or PRODUCT-DESCRIPTION) would reasonably believe guards bound a compromised custodian regardless of `allowedActions`.

**Proof of Concept**:
```typescript
// 1. Admin creates custodian group C with allowedActions = ACT_PAY|ACT_AXFER|ACT_APPL,
//    sets an ALGO guard of 100 ALGO.
// 2. The custodian protocol contract is compromised.
// 3. C proposes+approves a TX_APP entry calling lendingApp.withdraw(safeDeposits, attacker).
// 4. _validateApp passes (ACT_APPL set); no guard is consulted; the withdrawal executes.
//    The 100-ALGO guard bounded nothing.
```

**Recommendation**:
1. In `_createGroup`'s custodian branch, assert `change.allowedActions & ~(ACT_PAY | ACT_AXFER)` is zero (`'custodian actions limited to pay/axfer'`). This is a ~15-byte assert, well within the current 1,224-byte margin.
2. In the `ADM_SET_POLICY` branch, apply the same assert when `group.groupType === GT_CUSTODIAN`.
3. If some deployments genuinely need app-calling custodians, keep the capability but fix the documentation instead: state explicitly that guards bound **only** payment/asset-transfer value, and that granting `ACT_APPL`/`ACT_ACFG` to a custodian re-opens unbounded exposure (cross-reference registry risk R-18).

**References**: `CLAUDE.md` "Custodian groups & asset guards"; RISK-REGISTRY R-18, new R-38.

---

### [M-02] `PRODUCT-DESCRIPTION.md` Is Stale Relative to the v3.0.0 Breaking Change (R-33 Recurrence)

**Severity**: Medium
**Status**: Open
**Component**: Documentation
**File**: `PRODUCT-DESCRIPTION.md:684-687`, `:711`

**Description**:
v3.0.0 removed all 12 read-only ABI getters and introduced the validator library contract — the largest ABI break shipped to date. `PRODUCT-DESCRIPTION.md` still:

- documents `getConfig()`, `getSignerGroup(groupId)`, `getProposal(proposalId)`, `getTransactionGroup(proposalId, payloadIndex)` as the contract's read surface (lines 684-687), all of which now **do not exist** on a v3.0.0 deployment;
- instructs signers to read `payloadVersion` "via `getProposal`" at review time (line 711) — the exact call a v3 integrator cannot make;
- contains no mention of `AlgoSafeTxnValidator`, the `createApplication(name, validatorAppId)` signature change, the bytecode-pinning trust model, or the extra fee/resource requirements executions now carry.

`CLAUDE.md`, by contrast, documents v3.0.0 thoroughly. This is the second occurrence of the documented-in-registry pattern R-33 (first: v1.7.0, found by the 2026-07-07-v2 audit): a breaking release shipping without the corresponding `PRODUCT-DESCRIPTION.md` update, because doc sync remains a manual, unenforced step.

**Impact**:
An integrator or signer following the product spec will call removed methods (loud ABI failure — no fund-loss path) and, more subtly, will not know that safe **creation** now requires resolving/deploying a verified validator app, or that signers' review workflow must use the off-chain box readers. The `createApplication` signature change is the highest-impact omission: it affects every new deployment.

**Recommendation**:
1. Update `PRODUCT-DESCRIPTION.md`: replace the getter list with the `src/on-chain.ts` reader surface, document the validator architecture (deployment, pinning, `VALIDATOR_DEPLOYMENTS` registry), and revise the signer-workflow paragraph.
2. Implement the R-33 structural fix already recorded in the registry: a CI check that greps the docs for the current `CONTRACT_VERSION` string (or equivalent), so a version bump without a doc update fails mechanically.

---

### [L-01] `_createGroup` Accepts the Zero Address as the Initial Member (Incomplete L-02 Remediation)

**Severity**: Low
**Status**: Open
**Component**: AlgoSafe (contract.algo.ts)
**File**: `smart_contracts/algo_safe/contract.algo.ts:1404-1435`

**Description**:
The previous audit's L-02 added `assert(change.memberAddr !== Global.zeroAddress, 'member required')` to `_adminAddMember` (line 1455), and `_seedGroup` has the equivalent check for bootstrap members (line 501). But `_createGroup` — the third place a member box is written from caller-supplied input, used by both `ADM_CREATE_GROUP` and `ADM_CREATE_CUSTODIAN` — writes the initial member box from `change.memberAddr` with **no zero-address check** (line 1434-1435).

**Impact**:
An admin change with `memberAddr` left at the zero value (an easy default-initialization mistake in tooling, since `AdminChange` has 15 fields most change types don't use) creates a group whose sole member can never sign. With the enforced `threshold === 1`, the group is inert: no proposals can ever originate from it. It is recoverable (`ADM_ADD_MEMBER` a real member, then `ADM_REMOVE_MEMBER` the zero entry), so the impact is wasted MBR and operator confusion, not loss or lockout. For a custodian group the dead weight also counts toward `groupCount`.

**Recommendation**:
Add the same `assert(change.memberAddr !== Global.zeroAddress, 'member required')` at the top of `_createGroup`, and extend the existing L-02 e2e regression test to cover `ADM_CREATE_GROUP` and `ADM_CREATE_CUSTODIAN`.

---

### [L-02] `ADM_ADD_REKEYED_ADDR` Accepts the Zero Address; a Zero Entry Corrupts the Migration Rekey Payload

**Severity**: Low
**Status**: Open
**Component**: AlgoSafe (contract.algo.ts) + migration tooling
**File**: `smart_contracts/algo_safe/contract.algo.ts:1272-1276`; `src/migration.ts:271-279`

**Description**:
`bootstrapRekeyedAddress` asserts `addr !== Global.zeroAddress` (line 525), but the governed path `ADM_ADD_REKEYED_ADDR` in `_applyAdminChange` (lines 1272-1276) does not — it only checks non-duplication. The registry is bookkeeping, so on-chain impact is nil, **but** the migration tooling consumes it: `buildMigrationRekeyPayload` (`src/migration.ts:275-278`) emits one `RekeyTxn` per registered address with `sender: address`. In the `RekeyTxn` payload semantics, a zero-address `sender` means **"rekey the safe itself"** (`_stageRekey`, contract.algo.ts:1077). A zero registry entry therefore turns one "release external address" entry into a premature self-rekey of the safe, placed *before* the intended final self-rekey in the same group — after which subsequent inner transactions from the safe's now-rekeyed app account fail and the whole migration group reverts atomically.

**Impact**:
No fund loss (atomic revert), but a confusing migration failure whose cause (a stale zero registry entry) is far from the error surface. Recoverable via `ADM_REMOVE_REKEYED_ADDR`.

**Recommendation**:
1. Add `assert(change.memberAddr !== Global.zeroAddress, 'address required')` to the `ADM_ADD_REKEYED_ADDR` branch (mirrors `bootstrapRekeyedAddress`).
2. Defensively, have `buildMigrationRekeyPayload` throw on a zero address in its input list.

---

### [I-01] `_createGroup` Does Not Bound `allowedActions` / `adminPrivileges` Bitmasks

**Severity**: Informational
**File**: `smart_contracts/algo_safe/contract.algo.ts:1404-1431`

`_seedGroup` asserts `allowedActions <= ACT_ALL` and `adminPrivileges <= PRIV_ALL`; `_createGroup` (and the `ADM_SET_POLICY`/`ADM_SET_PRIVILEGES` branches) store the caller's values unchecked. Bits above the defined masks are inert today (every consumer tests specific bits), so this is hygiene, not a vulnerability — but reserved bits acquiring meaning in a future version would retroactively activate whatever stale values old groups carry. Recommend mirroring `_seedGroup`'s two asserts in `_createGroup`, or documenting the reserved-bit policy.

### [I-02] Permissionless `executeProposal` and Active-Flag-Free `approveProposal` Are Safe but Undocumented

**Severity**: Informational
**File**: `smart_contracts/algo_safe/contract.algo.ts:716-721`, `:698-713`

`executeProposal` performs no membership check — any account can crank a READY, unexpired proposal (authorization rests entirely on the recorded approvals; verified sound). Similarly, `approveProposal` does not check `group.active`, so a deactivated group's members can continue collecting approvals; execution is blocked while inactive but the proposal becomes executable if the group is reactivated before expiry. Both behaviors are defensible designs (permissionless cranking is common in threshold systems; the reactivation window is bounded by `expiryRound` and epoch checks), but neither is documented — operators pausing a group during an incident should know pending proposals keep ripening. Recommend a docstring note on both methods and one line in `PRODUCT-DESCRIPTION.md`.

### [I-03] Custodian Self-Dissolution Requires Admin Cooperation in Practice

**Severity**: Informational
**File**: `smart_contracts/algo_safe/contract.algo.ts:1341-1359`

The design intent is "a custodian group dissolves itself — admins cannot force dissolution." The inverse dependency is worth stating: dissolution requires `guardCount === 0` and `memberCount === 1`, but guard removal (`ADM_REMOVE_GUARD`) and member removal (`ADM_REMOVE_MEMBER`) are `PRIV_GROUP`-gated actions custodians cannot perform. An uncooperative admin can therefore block a custodian's exit indefinitely (and can add members to a custodian group at will, which also blocks dissolution). This matches the overall trust model (admins are the safe's root authority) but should be documented so protocol integrators don't assume unilateral exit.

### [I-04] Test Gaps on the New v3.0.0 Surface

**Severity**: Informational

See §5 for the structured scenarios. Highest value: (a) `createApplication` with a non-validator app ID must fail with `'validator bytecode mismatch'` — the single most security-critical new assert has no e2e test; (b) custodian + `ACT_APPL` behavior (documents M-01's status quo either way); (c) zero-address initial member via `ADM_CREATE_GROUP` (L-01).

---

## 5. Missing Test Scenarios

### Missing Test: Validator pin rejection at safe creation

**Description**: Deploy an arbitrary app (or a second, differently-built validator) and call `AlgoSafe.createApplication(name, wrongAppId)`; assert failure with `'validator bytecode mismatch'`; also cover a nonexistent app ID (`'validator app not found'`).
**Risk if Untested**: the hash-pin assert is the sole guard ensuring every safe validates payloads with the audited rules; a regression (e.g. hash constant accidentally widened, comparison inverted) would silently break the whole validation trust model for new deployments.
**Test Steps**: 1. deploy a dummy app; 2. attempt safe creation pinned to it; 3. expect revert; 4. create with the correct validator; expect success.
**Priority**: High

### Missing Test: Custodian group with `ACT_APPL`

**Description**: Create a custodian group with `ACT_APPL` granted and an ALGO guard; execute a TX_APP proposal; observe that no guard is consulted.
**Risk if Untested**: M-01's behavior is undocumented and untested; whichever way the team resolves M-01 (restrict or document), a test should lock the decision in.
**Priority**: Medium

### Missing Test: Zero-address initial member via `ADM_CREATE_GROUP` / `ADM_CREATE_CUSTODIAN`

**Description**: Propose+execute an `ADM_CREATE_GROUP` with `memberAddr` = zero address; currently succeeds (L-01); after the fix, expect `'member required'`.
**Priority**: Low

### Missing Test: Zero-address rekeyed-registry entry and migration payload behavior

**Description**: Register the zero address via `ADM_ADD_REKEYED_ADDR` (currently succeeds — L-02); build a migration payload including it and observe the failure mode.
**Priority**: Low

### Missing Test: Malformed ARC4 `data` vs. declared `txType` through the validator path

**Description**: Store a payload entry whose `data` bytes are a `PaymentTxn` encoding but whose `txType` claims `TX_ASSET` (and a truncated-bytes case); assert execution reverts in the validator's decode rather than mis-parsing. Carries forward the standing R-16 fuzzing recommendation, now aimed at the C2C boundary.
**Priority**: Medium

### Missing Test: Box-MBR underfunding failure mode

**Description**: Drain the safe's spendable balance to near-MBR and create a proposal requiring new boxes; assert a clean atomic failure. (Carried forward from prior audits — still absent.)
**Priority**: Low

---

## 6. Documentation Gaps

### Documentation Gap: v3.0.0 architecture in PRODUCT-DESCRIPTION.md

**Missing Information**: validator library contract (existence, pinning model, deployment prerequisites), removed getters and their `src/on-chain.ts` replacements, `createApplication(name, validatorAppId)` signature, extra fee/resource requirements per execution.
**User Impact**: integrators build against a read surface that no longer exists; new deployments fail without a resolved validator app.
**Location**: `PRODUCT-DESCRIPTION.md` §"read surface" (lines ~680-712) and the architecture section.
**Priority**: High (this is finding M-02)

### Documentation Gap: custodian guard scope

**Missing Information**: explicit statement that asset guards bound only `TX_PAYMENT`/`TX_ASSET` value, and guidance to grant custodians only `ACT_PAY|ACT_AXFER`.
**Location**: `CLAUDE.md` custodian section, `PRODUCT-DESCRIPTION.md`, and the contract docstring at `contract.algo.ts:61-67`.
**Priority**: High (this is finding M-01's documentation half)

### Documentation Gap: permissionless execution and pause/approval interaction

**Missing Information**: anyone may execute a READY proposal; approvals continue accruing on deactivated groups and while paused proposals await unpause (pause blocks propose/append/execute, not approve).
**Location**: method docstrings + `PRODUCT-DESCRIPTION.md` signer workflow.
**Priority**: Low (finding I-02)

---

## 7. Security Best Practices — Compliance Assessment

| Practice | Status |
|---|---|
| Access control re-checked at execution time (privileges, active flag, epoch, threshold) | ✔ verified |
| Proposal state machine terminal-state integrity | ✔ verified |
| Approvals bound to payload content (`payloadVersion`) | ✔ verified |
| Two-pass validate-then-stage inner-txn pattern; `ensureBudget` never mid-group | ✔ verified |
| Spending limits count live balance on close-outs | ✔ verified (incl. custodian guards) |
| Governance lockout counter (`activePrivGroupCount`) maintained on all mutating paths | ✔ verified (seed, create, set-privileges, set-active; custodians correctly excluded) |
| Box keys collision-free | ✔ (`TXG_KEY_MULT=7` > max slot 6; fixed-width composite keys) |
| Immutable, hash-pinned external validator | ✔ sound design (see §3) |
| Program size gate in CI | ✔ 6,968/8,192 with 7,800 gate |
| Constants/codecs in sync across contract ↔ shared module ↔ npm package | ✔ verified byte-for-byte |
| Zero-address input rejection on all member/registry writes | ✖ two residual gaps (L-01, L-02) |
| Documentation tracks shipped ABI | ✖ PRODUCT-DESCRIPTION stale (M-02) |

---

## 8. Risk Assessment

Per `AI-AUDIT-INSTRUCTIONS.md`, this section references **`audits/RISK-REGISTRY.md`** (updated by this audit) rather than re-deriving a standalone model.

- **Dominant residual risks are operational, not code-level**: R-02 (signer key compromise, 35%), R-04 (threshold misconfiguration, 20%), R-22 (frontend misrepresentation, 15%), R-03 (insider/coercion, 10%). No code finding in this audit changes them.
- **R-25 (program-size ceiling)**: confirmed **Mitigated** at the committed code — 6,968 bytes, 15% free, CI gate active.
- **R-35, R-36, R-37** (custodian MBR orphaning, prune-after-dissolve, threshold=0): fixes now **committed** and regression-tested at the audited commit; statuses stand as Mitigated.
- **R-33 (documentation lag)**: **recurred** with v3.0.0 (finding M-02); probability re-raised 10% → 15% until the mechanical CI doc check exists.
- **New R-38** (custodian guard scope excludes non-transfer actions — finding M-01): Medium severity, 8% 5-year probability.
- **New R-39** (validator library pinning/deployment surface): Low residual — the hash pin makes the on-chain trust model robust; residual risk is operational (deploying safes pinned before `VALIDATOR_DEPLOYMENTS` is populated, or a compromised build pipeline altering the pinned hash, which folds into R-27).
- **New R-40** (residual zero-address input gaps — findings L-01/L-02): Low.

Overall: the system's on-chain core remains in good shape; both Medium findings are configuration/documentation-surface issues rather than exploitable code defects. Aggregate risk posture is **unchanged-to-slightly-improved** versus the previous audit (the size-ceiling blocker is gone; a new Medium-severity documentation-vs-behavior gap on custodians is opened).

---

## 9. Recommendations (Prioritized)

1. **(M-01)** Restrict custodian `allowedActions` to `ACT_PAY|ACT_AXFER` in `_createGroup` and `ADM_SET_POLICY` — or explicitly document that guards do not bound `ACT_APPL`/`ACT_ACFG`. Prefer the code fix; it is a few bytes against a 1,224-byte margin.
2. **(M-02)** Update `PRODUCT-DESCRIPTION.md` for v3.0.0 and add the mechanical CI doc-version check (closes the R-33 recurrence loop).
3. **(L-01, L-02)** Add the two missing zero-address asserts (`_createGroup`, `ADM_ADD_REKEYED_ADDR`) + regression tests; add the defensive throw in `buildMigrationRekeyPayload`.
4. **(I-04)** Add the validator-pin-rejection e2e test — the highest-value missing test on the new surface.
5. **(Registry housekeeping)** Populate `VALIDATOR_DEPLOYMENTS` immediately after the first TestNet/MainNet validator deployments; until then every non-local safe creation must pass an explicit, hand-verified app ID.
6. **(I-01)** Mirror `_seedGroup`'s bitmask bounds in `_createGroup`.

## 10. Testing Recommendations

See §5. Priority order: validator-pin rejection (High) → malformed-payload C2C fuzzing (Medium) → custodian `ACT_APPL` (Medium) → zero-address paths (Low) → MBR underfunding (Low). The existing 76-test e2e suite remains excellent on the historical finding set — every prior audit's finding has a live regression test, all passing at this commit.

## 11. Compliance and Standards

- **ARC-4 / ARC-56**: ABI methods and generated clients conform; events use ARC-28 `emit`.
- **ARC-4 router immutability** (validator): no update/delete handlers — verified in source and consistent with the generated approval program's size/structure.
- **AVM consensus limits**: app-call resource constants verified against current protocol values; 16-txn group cap enforced at append time; program size within ceiling with CI gate.
- **Project workflow compliance**: `CONTRACT_VERSION` bumped, exactly one new committed `clients/<hash>/` folder, `versioned-clients.generated.ts` in sync, working tree clean. ✔

## 12. Appendix

### Verification Notes / Limitations

- Full suite executed fresh on LocalNet at the audited commit: **81/81 passed** (see §1). No skipped verification steps.
- The validator's compiled TEAL was not independently line-audited (source-level review + hash verification only) — consistent with prior audits' treatment of compiled artifacts (registry R-27 covers compiler trust).
- Frontend (`algo-safe-frontend`) and X402 projects remain out of scope, per the audit instructions' contract-package focus; registry entries R-22/R-33 carry the frontend/doc risk surface.

### Delta reviewed since previous audit

`git diff 76d8618..d2baaab` over `projects/algo-safe-contracts/`: contract v2.0.0 → v3.0.0 (463-line contract diff), new validator contract (118 lines), new shared types module (101 lines), new `src/validator.ts` (109 lines), rewritten `src/on-chain.ts` readers (+156/-), `scripts/check-program-size.ts` + `scripts/sync-validator-hash.ts`, 669-line e2e spec diff, one new client folder `clients/8a9073ec…/`.

### Checklist cross-reference

All items in `AI-AUDIT-INSTRUCTIONS.md` §"Security Checklist" were evaluated; items not individually discussed in §4 were verified with no adverse finding (reentrancy: protocol-enforced; overflow: bounded by `MAX_COOLDOWN_ROUNDS`/`MAX_GROUP_TXNS`/asserted arithmetic; double-execution: terminal-state verified; pause consistency: propose/append/execute all gated, governance exempt by design; version detection: `getAlgoSafeContractVersion` verified).
