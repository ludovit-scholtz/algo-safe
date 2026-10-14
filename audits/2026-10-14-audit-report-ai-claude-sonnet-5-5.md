# Algo Safe — Security Audit Report

## 1. Audit Metadata

**AI Model**: Claude Sonnet 5.5 (claude-sonnet-5-5)
**Provider**: Anthropic
**Audit Date**: 2026-10-14
**Commit Hash**: `9859b30a2d621c92bcc287af60bf0857a24c2e8a`
**Commit Date**: 2026-10-12 15:01:58 +02:00
**Previous audit**: [2026-07-16 Claude Fable 5](./2026-07-16-audit-report-ai-claude-fable-5.md) (contract v3.1.0, remediated same day as v3.2.0 and committed in `7a8e8ec`).

### Contract Bytecode Hashes

Output of `pnpm run compute-bytecode-hashes` after a fresh `pnpm build` at this commit:

**AlgoSafe** (`smart_contracts/algo_safe/contract.algo.ts`):
- **Approval Program SHA256**: `3f8d0cb07960bf2c8af42fb41b7d7fc2673dd831d987e80ee0e0c43fcefaa0ec` (7,054 bytes)
- **Clear Program SHA256**: `ed90f0d2da1f1d1abd773c45230651a292a90edbc12a7bf859a493a12a640ce7`

**AlgoSafeTxnValidator** (`smart_contracts/algo_safe_validator/contract.algo.ts`):
- **Pinned approval SHA256** (`validator-hash.generated.ts`): `0dd692344f80e7d5770f47bcde26c31eaaf24d45b5d177dfcbc7241742e188b1`. Unchanged from the 2026-07-16 audit; the build's `sync-validator-hash` step produced no working-tree diff.

The AlgoSafe approval hash equals `LATEST_CONTRACT_HASH` and the registry's v3.2.0 entry (`RISK-REGISTRY.md` header, 2026-07-16).

**CONTRACT_VERSION**: `BIATEC-ALGO-SAFE-v3.2.0` (`contract.algo.ts:150`).
`git diff 7a8e8ec HEAD -- projects/algo-safe-contracts` shows **no change** under `smart_contracts/` or to any generated client. No `CONTRACT_VERSION` bump was required, and no new `clients/<hash>/` folder was added (18 folders, unchanged). ✔

### Build & Test Execution (fresh, this audit)

- `docker ps` showed no containers at the start. `algokit localnet start` brought LocalNet up (algod 4001, indexer 8980 healthy).
- `pnpm build` (from `projects/algo-safe-contracts/`): exit 0. `check-program-size: OK — AlgoSafe approval program: 7054 bytes (gate 7800, AVM ceiling 8192, margin 1138)`. `git status` was clean afterwards, so the committed artifacts are reproducible.
- `pnpm test` (`vitest run --coverage`, unit + e2e against LocalNet): **6 test files passed, 123 tests passed, 0 failed**, duration ≈ 274 s. This is up from 93 at the previous audit; the new files are `src/arc56.spec.ts` and `src/safe-tx.spec.ts`. The coverage table (≈11% overall) is dominated by the generated typed clients under `smart_contracts/artifacts/` and `clients/` and is not meaningful as a contract-coverage measure. Hand-written `src/` files were 55–91% line-covered, with `validator.ts` the lowest at 55%.
- Three throw-away PoC tests were written for this audit and run on LocalNet (see §4). All three passed, meaning they **confirmed** the behaviours described. The PoC spec files were deleted afterwards, and the working tree is clean.

---

## 2. Executive Summary

This audit covers HEAD `9859b30`. The on-chain code (`contract.algo.ts`, the validator, `shared/types.ts`) is **byte-identical to the previously audited v3.2.0**. The changes since the last audit are: (a) a new off-chain module, `src/arc56.ts` (ARC-56-registry verification and decoding of app-call arguments, ~480 lines, wired into the frontend's `AppCallDetails.tsx`), (b) the frontend's i18n, use-wallet v5 and Docker/k8s deployment changes, and (c) dependency bumps. The audit therefore did two things:

1. A fresh, full-file adversarial re-read of the on-chain trust boundary. It looked for bugs the earlier audits did not report, as opposed to re-verifying their fixes.
2. A review of the new `arc56.ts` surface and the conversion code that feeds the WalletConnect inbound flow.

**No Critical or High findings.** All earlier remediations remain in place, and the proposal state machine, execution-time re-checks, spend/guard accounting, box-key derivation and validator pinning were re-verified sound. One new Medium and four Low/Informational items were found:

- **[M-01]** *Any single member* of a signer group can unilaterally cancel *any* pending or already-READY proposal of that group. This applies to admin proposals too. A malicious or compromised signer in a threshold-N group can therefore veto every proposal, including the governance proposal that would remove them. Funds are not at risk, but liveness and incident response are. **PoC confirmed.**
- **[L-01]** `ADM_SET_POLICY` and `ADM_SET_PRIVILEGES` store unbounded bitmasks. The v3.1.0 bound checks were added only to `_createGroup`/`_seedGroup`, so the fix is incomplete. **PoC confirmed.**
- **[L-02]** `algosdkTxnsToSafeTxnGroup` silently drops an asset-transfer's `assetSender` (clawback) field. A dApp-supplied clawback transaction arriving through WalletConnect becomes an ordinary transfer from the safe's *own* holdings.
- **[L-03]** `decodeAppCallArgs` (new `arc56.ts`) has an off-by-one against the ARC-4 15-argument packing rule. For methods with ≥16 value arguments it shows a wrongly decoded 15th argument under a green "verified" banner.
- **[L-04]** The "verified" ARC-56 status rests on the registry's honesty, a 4-byte selector and a mutable `:latest`/`Always` registry image. The label overstates what is cryptographically established.
- **[I-01]** An unknown `changeType` (0, ≥15) falls through to the pause branch. **PoC confirmed.**
- **[I-02/I-03]** Documentation staleness.

Compiled approval program: **7,054 / 8,192 bytes** (1,138-byte margin, 13.9%).

## Remediation Update (2026-10-14, contract v3.3.0, issue #9)

| Finding | Status | Fix |
|---|---|---|
| M-01 | **Fixed** | `cancelProposal` now allows only the proposer, or any member once the proposal is stale (past expiry or membership-epoch bump). An approver-withdraw path was rejected in review (any member can approve first, then cancel). Regression test covers non-proposer rejection (including approve-then-cancel) and epoch-stale cleanup; frontend hides Cancel for non-proposers. |
| L-01 | **Fixed** | `allowedActions <= ACT_ALL` in `ADM_SET_POLICY`, `adminPrivileges <= PRIV_ALL` in `ADM_SET_PRIVILEGES`; regression test. |
| I-01 | **Fixed** | Unknown `changeType` rejected at proposal time (1–14) and the final branch asserts `changeType === 10`; regression test. |
| I-02 / I-03 | **Fixed (doc)** | Comment corrected; `CLAUDE.md` size figure and v3.3.0 bullet. (`AI-AUDIT-INSTRUCTIONS.md` getter references left for a separate pass.) |
| L-02 | **Fixed** | `algosdkTxnsToSafeTxnGroup` throws on `assetSender`; unit test. |
| L-03 | **Fixed** | `decodeAppCallArgs` treats arguments from the 15th as packed when the method has more than 15 value arguments; unit tests. |
| L-04 | **Partially fixed** | A spec whose embedded `byteCode.approval` does not hash to the on-chain program is rejected (`no-spec`); unit tests. Pinning the registry image by digest remains an operational follow-up (digest unknown to this repo). |

---

## 3. Scope and Methodology

**In scope**
- `smart_contracts/algo_safe/contract.algo.ts` (1,525 lines), read in full.
- `smart_contracts/algo_safe_validator/contract.algo.ts` and `smart_contracts/shared/types.ts`.
- `projects/algo-safe-contracts/src/*.ts`: `safe-tx.ts`, `version.ts`, `validator.ts`, `constants.ts` and the new `arc56.ts` in full; `on-chain.ts` and `migration.ts` only for drift (unchanged since the last audit).
- The consumers of the new surface: `AppCallDetails.tsx`, `walletConnectConvert.ts`, the k8s `arc56-registry` deployment.

**Method**
- Followed `AI-AUDIT-INSTRUCTIONS.md`: state-machine enumeration, execution-time re-check review, box-key collision analysis (prefixes `g`/`m`/`p`/`a`/`txg`/`dp`/`r`/`ag` differ in prefix or total key length), two-pass inner-txn review, spend/guard accounting, privilege-matrix review, and the PuyaTs gotcha checklist.
- Hypotheses were tested with LocalNet PoCs rather than argued from source alone.

**Out of scope / limitations**: the frontend beyond the files named above; TEAL-level review; the externally hosted `scholtz2/arc56-registry` image contents.

---

## 4. Findings

### [M-01] Any Single Group Member Can Unilaterally Cancel Any Pending or READY Proposal (Minority Veto / Self-Removal Censorship)

**Severity**: Medium
**Status**: Open
**Component**: AlgoSafe
**File**: `smart_contracts/algo_safe/contract.algo.ts:731-744`

**Description**:
`cancelProposal` authorises the caller if they are the proposer **or any current member of the proposal's group**:

```ts
const isProposer = Txn.sender === proposal.proposer
const isMember = this.members({ groupId: proposal.groupId, account: Txn.sender }).exists
assert(isProposer || isMember, 'not authorised to cancel')
proposal.status = STATUS_CANCELLED
```

There is no threshold, no requirement that the caller approved, and no restriction on status. A proposal in `STATUS_READY` that has already collected every required approval can be cancelled by a member who did not approve it. That member may hold a single key of an M-of-N group. The same applies to `PT_ADMIN` proposals.

**Impact**:
- *Liveness / censorship by one signer.* In an M-of-N group (M ≥ 2) a malicious, coerced or compromised signer can cancel every proposal the others create or complete. The group then cannot move funds or change governance for as long as that signer stays a member.
- *The remedy is vetoable by the problem.* The standard response to a suspected-compromised signer is `ADM_REMOVE_MEMBER`. If the compromised signer sits in the only `PRIV_GROUP` group, they can cancel the removal proposal as soon as it is created. The only workaround is to propose, approve and execute inside a single atomic group, which needs every approver to pre-sign one group and know the next `nextProposalId`. Alternatively a second admin group that does not contain the attacker can propose the removal, if one exists.
- Funds are not at risk; this is a denial of governance. It undermines the threat model that R-02/R-03 mitigate with M-of-N (a single compromised key "cannot act alone above a threshold >1"). That statement is true for spending but false for blocking.

**Proof of Concept** (executed on LocalNet, passes — behaviour confirmed):
```typescript
// 2-of-3 group (a, b, c). a proposes a payment; b approves => status READY (2 >= 2).
// c never approved:
await client.send.cancelProposal({ args: { proposalId: pid, ensureBudgetValue: 0n }, sender: c })
expect((await readProposal(client, pid)).status).toBe(4n)          // CANCELLED
await expect(client.send.executeProposal({ args: { proposalId: pid, ensureBudgetValue: 6000n }, sender: a }))
  .rejects.toThrow()                                                 // can no longer execute
```

**Recommendation** (the program has ~1,138 bytes of headroom):
1. Allow cancellation only when one of these holds:
   - the caller is the proposer;
   - the caller's own approval exists (`approvals({proposalId, account: Txn.sender}).exists`), so a signer can withdraw only a proposal they consented to; or
   - the proposal is stale (`Global.round > expiryRound` or `group.membershipEpoch !== epochAtCreation`), so epoch-stranded proposals, which can only be cancelled and re-created, remain cleanable by any member.
2. Optionally, for admin proposals, restrict cancellation to the proposer.
3. Add e2e tests: a non-approving member cannot cancel a READY proposal; any member can cancel after expiry or after an epoch bump.
4. If the current behaviour is deliberate (an "any signer can pull the emergency brake" design), document it in `CLAUDE.md` and `PRODUCT-DESCRIPTION.md` as a safety/liveness trade-off, and add the atomic-group removal procedure to the incident runbook.

This changes `contract.algo.ts`, so it requires a `CONTRACT_VERSION` bump to v3.3.0 and exactly one new `clients/<hash>/` folder.

---

### [L-01] `ADM_SET_POLICY` / `ADM_SET_PRIVILEGES` Do Not Bound Their Bitmasks (v3.1.0 I-01 Fix Incomplete)

**Severity**: Low
**Status**: Open
**File**: `contract.algo.ts:1316-1351` (vs. the bound checks at `:468-469` and `:1442-1443`)

**Description**:
v3.1.0 added `allowedActions <= ACT_ALL` and `adminPrivileges <= PRIV_ALL` to `_seedGroup` and `_createGroup`. The two governed *modification* paths, `ADM_SET_POLICY` (`allowedActions`) and `ADM_SET_PRIVILEGES` (`adminPrivileges`), store whatever the proposal carries. Custodian groups are separately protected by `_assertCustodianActions`.

**Impact**: Reserved bits (ACT bit 6+, PRIV bit 3+) can be persisted on a group. Today they are inert. If a later contract version defines one of those bits, which `constants.ts:11` ("bit 4 reserved for future granularity") already anticipates, the stored bit silently becomes a live grant. This is only possible on a safe whose own admins chose to set it, and the safe is non-upgradable, so this is a forward-compatibility and defence-in-depth issue rather than an exploit.

**Proof of Concept** (executed, passes): a group created with `ACT_PAY` was then given `allowedActions = 0xFFFF` via `ADM_SET_POLICY` and `adminPrivileges = 0xF8` via `ADM_SET_PRIVILEGES`. `readSignerGroup` returns `0xffff` and `0xf8`.

**Recommendation**: add `assert(change.allowedActions <= ACT_ALL)` to the `ADM_SET_POLICY` branch and `assert(change.adminPrivileges <= PRIV_ALL)` to the `ADM_SET_PRIVILEGES` branch (≈20 bytes each), plus a regression test mirroring the existing "group creation rejects bitmask values beyond the defined bits" test.

---

### [L-02] `algosdkTxnsToSafeTxnGroup` Silently Drops an Asset-Transfer's `assetSender` (Clawback)

**Severity**: Low
**Status**: Open
**File**: `projects/algo-safe-contracts/src/safe-tx.ts:365-376`, consumed by `projects/algo-safe-frontend/src/lib/walletConnectConvert.ts:86`

**Description**:
The `axfer` branch maps `sender`, `assetIndex`, `receiver`, `amount` and `closeRemainderTo`. It never reads `txn.assetTransfer.assetSender`, the clawback target (verified present in algosdk 3.6.0 `base.d.ts:334`). `AssetTxn` has no field for it, and the 2026-07-16 I-01 fix pattern of failing loudly on an unrepresentable field was applied to keyreg `nonParticipation` only. A clawback transaction where the safe is the asset's clawback address, with `assetSender = victim`, is therefore stored as a plain transfer *from the safe's own balance* of the same asset and amount.

**Impact**: the semantics change without any error. The proposal shows an ordinary outgoing transfer, which signers will judge on what they see. Because the same function converts transactions that arrive through the WalletConnect inbound flow, a dApp request intended as a clawback becomes a payout of the safe's own holdings if signers do not notice the missing clawback context. Other silently ignored fields are lower risk: `appl.boxes` and similar are loud at execution, and a non-UTF-8 `note` becomes replacement characters.

**Recommendation**: in the `axfer` branch `throw new Error('Unsupported transaction type: asset clawback (assetSender) has no SafeTxn representation')` when `assetSender` is set. Also throw when `txn.rekeyTo` is set on any non-pure-rekey type (already done) and consider rejecting a non-UTF-8 `note`. Add the unit test.

---

### [L-03] `decodeAppCallArgs` Mishandles the ARC-4 15-Argument Packing Boundary

**Severity**: Low
**Status**: Open
**File**: `projects/algo-safe-contracts/src/arc56.ts:325, 351-361`

**Description**:
ARC-4 places the first 14 arguments directly in `appArgs[1..14]` and, only when the method has *more than 15* value arguments, packs arguments 15 onward into a single tuple in slot 15. The code sets `MAX_DIRECT_APP_ARGS = 15` and flags only argument #16 onwards as `unsupported`. For a method with ≥16 value arguments the 15th argument is decoded as if it were direct, but the bytes in slot 15 are the packed tuple of the remaining arguments. The result is a wrong value (or a spurious decode failure) rendered inside a "verified" banner, which is exactly the "wrong values shown with false confidence" failure the module's own header comment says it avoids.

**Impact**: a wrong display for rare methods with >15 arguments. The signed bytes themselves are unaffected, but this is the display signers rely on (R-22).

**Recommendation**: compute the value-argument count up front. If it exceeds 15, treat arguments 15 onward as `unsupported` (reason: packed tuple), or decode the packed tuple properly. Add a unit test with a 16-argument method.

---

### [L-04] "Verified" ARC-56 Status Rests on an Unauthenticated Registry, a 4-Byte Selector and a Mutable Image Tag

**Severity**: Low (Integration / Client)
**Status**: Open
**Files**: `arc56.ts:454-463`; `projects/algo-safe-frontend/deploy/k8s/arc56-registry-deployment.yaml:17-18`

**Description**:
`verifyAppCall` hashes the real on-chain approval program, which is sound, then trusts the registry to map that hash to a spec. It accepts the spec when one of its methods' 4-byte selector equals `appArgs[0]`. Three weaknesses:
1. The selector binds the method *name* and *argument/return types*, but not argument names, descriptions or the spec's overall `name`/`desc`. A malicious or compromised registry can attach misleading labels to a real selector, and a 32-bit selector collision (cheap to brute-force) lets a spec author present a different name and type list that hashes to the same four bytes.
2. ARC-56 specs usually embed `byteCode.approval`. The module never hashes that and compares it with the on-chain hash, which would turn "registry says so" into "spec's own bytecode matches".
3. The registry is `scholtz2/arc56-registry:latest` with `imagePullPolicy: Always`, so the trust anchor of the green "verified" state changes whenever the tag moves.

**Impact**: a registry or image compromise can make a harmful call display as a benign named method with a green banner. This is a refinement of R-22 (frontend misrepresentation) rather than a new class, but the new feature is explicitly designed to raise signer trust.

**Recommendation**: pin the image by digest. When the spec carries `byteCode.approval`, hash it and require equality with the on-chain hash before returning `verified`, otherwise return a distinct `spec-unbound` state. Reword the green banner to say "matches registry spec" until that check exists. Treat argument names and descriptions as untrusted display text.

---

### [I-01] Unknown `changeType` Values Fall Through to the Pause Branch

**Severity**: Informational
**Status**: Open
**File**: `contract.algo.ts:1419-1424`

`_applyAdminChange` implements `ADM_SET_PAUSED` (10) as its `else` branch. Any `changeType` that is not 1-9 or 11-14 (0, 15, 99, …) is accepted by `proposeAdminChange`, since `_assertPrivilegeForChange` only gates on `PRIV_GROUP`, and at execution it sets `paused = (activeFlag != 0)`.

*PoC (executed, passes)*: `changeType: 99n, activeFlag: 1n`, proposed and executed by the admin group, leaves `readSafeConfig(...).paused === 1n`.

Impact is limited. It needs `PRIV_GROUP`, which can already pause or unpause, and no funds are involved. It does mean a malformed or fuzzed admin change silently pauses the safe instead of reverting. Recommend `assert(change.changeType === Uint64(10), 'unknown change type')` in the final branch (a few bytes), or a range check at proposal time.

---

### [I-02] Documentation: `proposeTransactionGroup` `execute=true` Comment Is Narrower Than the Behaviour

`contract.algo.ts:556-558` says `execute=true` is "valid only when threshold=1 and the proposer is the sole member". It works for any group whose snapshot threshold is 1 (the proposer's auto-approval is enough), regardless of member count. Update the comment and the matching sentence in `PRODUCT-DESCRIPTION.md`.

---

### [I-03] Documentation: Size Figures Stale; Instructions File References Removed Getters

- `CLAUDE.md` still says "Current size after the v3.0.0 reduction pass: ~6,970 bytes"; the measured size is 7,054.
- `audits/AI-AUDIT-INSTRUCTIONS.md` §Phase 1 item 4 lists the read-only getters that were removed in v3.0.0. Its Phase-1 list of `_stage*/_validate*` helpers also omits the validator contract and `_stageRekey`. Both documents should be refreshed so future auditors review the right surface.

---

### Verified Non-Issues (checked this audit and confirmed sound)

| Area | Result |
|---|---|
| Status transitions | `EXECUTED` is reachable only from `READY`, checked before any mutation in `_executeProposalInternal`. `CANCELLED` is reachable only from `ACTIVE`/`READY`. No path mutates `groupId`/`payloadType`/`proposer`. |
| Threshold handling | `execute = max(snapshot, live)`. Raising the threshold after READY is enforced at execution. Lowering never weakens an existing proposal. |
| Execution-time re-checks | `group.active`, the membership epoch, `paused`, the cooldown (with the first-execution sentinel) and, for admin changes, `_assertPrivilegeForChange` are all re-read from live state. |
| Payload binding | `approveProposal` requires `payloadVersion`. `appendTransactionGroupPayload` is proposer-only, requires `approvalsCount === 1`, expiry and not paused, and `totalTxns` handles slot overwrite. |
| Box keys | `txg` key = `pid*7 + {1..6}` is collision-free. The BoxMap prefixes `g,m,p,a,txg,dp,r,ag` never produce equal keys, since keys differ in prefix or in total length (9 / 10 / 11 / 18 / 33 / 41 bytes). |
| Two-pass execution | Every staged entry was validated in pass 1. Budget calls occur only before any `ITxnCreate` group opens. The staging dispatch covers every `TX_*` the validator accepts. |
| Spend accounting | The tracked asset is compared by id (axfer id ≠ 0, so no ALGO alias). A close-out counts the live balance of the *resolved* sender. Custodian guards are asserted even for zero amounts. |
| Rekey | Requires `ACT_REKEY` **and** `PRIV_GROUP` and a non-custodian group, enforced in the pinned validator at execution time. The `rekeyTo` zero address is rejected. |
| Lockout counter | `activePrivGroupCount` is maintained on create, set-privileges and set-active. Custodians never contribute. `_wouldRemoveLastGroupAdmin` is checked at execution. |
| Custodian lifecycle | Dissolution requires `guardCount == 0`, `memberCount == 1` and the named last member. Custodian actions are limited to pay/axfer at all three write paths. |
| Validator pin | `createApplication` asserts the sha256 of the validator's approval program. The pinned bytecode rejects update and delete. |
| Reentrancy | The AVM forbids re-entering an app already on the call stack. |

---

## 5. Missing Test Scenarios

### Missing Test: Non-Approving Member Cancels a READY Proposal (M-01)
**Description**: lock in the intended cancellation authority matrix: proposer / approver / stale-proposal member / outsider.
**Risk if Untested**: the veto either persists unnoticed or is later "fixed" in a way that strands epoch-invalidated proposals.
**Test Steps**: 2-of-3 group; create and approve to READY; assert `cancelProposal` by the third member (a) succeeds today and (b) after the fix reverts. Then bump the epoch via `ADM_REMOVE_MEMBER` (or advance past expiry) and assert any member can cancel.
**Expected Behavior**: per the chosen policy in M-01.
**Edge Cases**: a removed proposer; a proposal in a deactivated group; an admin proposal.
**Priority**: High

### Missing Test: Bitmask Bounds on Policy / Privilege Changes (L-01)
**Description**: mirror the existing creation-time bounds test for `ADM_SET_POLICY` and `ADM_SET_PRIVILEGES`.
**Priority**: Medium

### Missing Test: Unknown `changeType` Is Rejected (I-01)
**Priority**: Low

### Missing Test: Clawback Conversion Throws (L-02) and 16-Argument ARC-4 Method (L-03)
**Description**: unit tests in `safe-tx.spec.ts`/`arc56.spec.ts` for the two off-chain defects.
**Priority**: Medium

### Carried over (still open from earlier audits)
- Expiry boundary round (`Global.round === expiryRound`) for approve/execute/append.
- Daily/monthly limit rollover exactly at the period boundary.
- Max-size payload (6 chunks / 16 txns) end-to-end.
- MBR under-funding when a new box is needed.
- Adversarial ARC-4 bytes in `entry.data` (R-16).
- Indexer-backed pagination for enumeration helpers (R-43).

---

## 6. Documentation Gaps

### Documentation Gap: Cancellation Authority
**Missing Information**: `CLAUDE.md`/`PRODUCT-DESCRIPTION.md` do not state that any group member can cancel any pending proposal.
**User Impact**: operators assume "M-of-N" protects governance liveness as well as spending.
**Recommended Documentation**: a "Cancellation & liveness" paragraph, plus the atomic-group procedure for removing a hostile signer.
**Location**: `CLAUDE.md` contract-architecture list; `PRODUCT-DESCRIPTION.md` governance section.
**Priority**: High (if the behaviour is kept)

### Documentation Gap: Meaning of the "Verified" ARC-56 State
**Missing Information**: what "verified" does and does not prove (see L-04).
**Location**: `AppCallDetails.tsx` copy; frontend README.
**Priority**: Medium

### Documentation Gap: Stale Figures and Audit Instructions
See [I-03]. **Priority**: Low

---

## 7. Security Best Practices — Compliance Assessment

| Practice | Status |
|---|---|
| Least privilege / privilege re-check at execution | ✅ |
| Fail-closed validation for unsupported payload shapes (on-chain) | ✅ |
| Fail-closed conversion for unsupported shapes (off-chain) | ⚠️ Keyreg `nonParticipation` handled; clawback not ([L-02]) |
| Input bounds on all stored bitmasks | ⚠️ Create path only ([L-01]) |
| Liveness protection against a minority signer | ❌ ([M-01]) |
| Immutable, hash-pinned external dependency (validator) | ✅ |
| Program-size gate in CI | ✅ (7,054 / 7,800 gate / 8,192 ceiling) |
| Contract-change workflow (version bump, single client folder) | ✅ (no contract change this period) |
| Supply-chain pinning of the frontend trust anchor | ⚠️ `:latest` registry image ([L-04]) |

---

## 8. Risk Assessment

Overall risk of the on-chain custody core remains **Low**: the previously Critical/High classes (unauthorised execution, replay, spending-limit bypass, lockout, bait-and-switch) are all closed and re-verified. The dominant residual risks are operational (R-02, R-03, R-04) and client-side (R-22). The new findings are mostly liveness and display-integrity items.

The full, living risk model is in [`RISK-REGISTRY.md`](./RISK-REGISTRY.md). This audit adds **R-44** (single-signer cancel veto), **R-45** (admin-change input validation gaps), **R-46** (silent field loss in tx conversion), **R-47** (ARC-56 trust anchor) and **R-48** (ARC-4 packing decode), and re-scores R-02/R-03/R-22 with notes. See its Change Log row dated 2026-10-14.

---

## 9. Recommendations (Prioritized)

1. **[Medium] Restrict `cancelProposal`** (M-01): proposer, own-approval or stale-proposal only. Bundle with L-01 and I-01 in one v3.3.0 contract release, with one new client folder and the version bump.
2. **[Low]** Bound the `ADM_SET_POLICY`/`ADM_SET_PRIVILEGES` bitmasks (L-01) and assert `changeType == 10` in the pause branch (I-01).
3. **[Low]** Make `algosdkTxnToSafeTxn` throw on `assetSender` (L-02). This is a no-contract-change library release.
4. **[Low]** Fix the ARC-4 packing threshold (L-03). Bind the spec's embedded bytecode hash to the on-chain hash and pin the registry image by digest (L-04).
5. **[Low]** Documentation refresh (I-02, I-03, cancellation authority).
6. Populate `VALIDATOR_DEPLOYMENTS` after the first TestNet/MainNet deployment (R-39), and add the CI doc-sync check (R-33). Both are carried over.

---

## 10. Testing Recommendations

- Add the regression tests in §5 together with each fix. The PoCs in §4 convert directly into them.
- Add a property/fuzz test that feeds random `changeType` and random bitmask values through `proposeAdminChange` to assert every outcome is either a documented transition or a revert.
- Add an `arc56` fixture with a 15-argument and a 16-argument method.

---

## 11. Compliance and Standards

- **ARC-4**: on-chain ABI usage conforms. The off-chain decoder deviates at the 15-argument packing boundary ([L-03]).
- **ARC-28** events: emitted consistently for state changes (note: `ProposalCancelled` carries no actor).
- **ARC-56**: used as a display aid only; see [L-04] for trust limits.
- **AVM limits**: the program is within 8,192 bytes. App-call resource constants match the current protocol.

---

## 12. Appendix

### A. Test Execution Record
```
cd projects/algo-safe-contracts
algokit localnet start
pnpm build   # exit 0, check-program-size OK (7054 bytes, margin 1138)
pnpm test    # Test Files 6 passed (6); Tests 123 passed (123); Duration 274.41s
```
PoC run (temporary spec, deleted afterwards): `Tests 3 passed (3)`, covering M-01, L-01 and I-01 behaviours.

### B. Files Reviewed
`smart_contracts/algo_safe/contract.algo.ts` (full), `smart_contracts/algo_safe_validator/contract.algo.ts`, `smart_contracts/shared/types.ts`, `smart_contracts/algo_safe/validator-hash.generated.ts`, `src/safe-tx.ts`, `src/version.ts`, `src/validator.ts`, `src/constants.ts`, `src/arc56.ts`, `AppCallDetails.tsx`, `algoSafeProposals.ts` (appCall construction), `deploy/k8s/arc56-registry-deployment.yaml`, `audits/RISK-REGISTRY.md`, the previous audit report.

### C. Verification Notes / Limitations
- LocalNet was started for this audit and the full suite ran. Nothing was skipped.
- The ≈11% aggregate coverage is an artefact of counting generated client code and should not be read as a contract-coverage figure.
- Findings L-02 and L-03 were established by code reading and the algosdk type definitions; no failing test was added for them. The L-02 conversion was confirmed to *not throw* on a clawback transaction in a throw-away unit test, and the ARC-4 packing rule was applied from the ARC-4 specification, not re-derived on chain.
- `on-chain.ts` and `migration.ts` were checked only for drift (unchanged since the previous audit). The frontend was reviewed only where it consumes the new library surface.
- The contents of the hosted `scholtz2/arc56-registry` image could not be inspected.
