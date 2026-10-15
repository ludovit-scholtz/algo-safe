# Algo Safe — Security Audit Report

## 1. Audit Metadata

**AI Model**: Claude Fable 5.1 (claude-fable-5-1)
**Provider**: Anthropic
**Audit Date**: 2026-10-15
**Commit Hash**: `a6517400676778bc6a760986e96cc2bf9015ee8c`
**Commit Date**: 2026-10-14 23:12:43 +02:00
**Previous audit**: [2026-10-14 Claude Sonnet 5.5](./2026-10-14-audit-report-ai-claude-sonnet-5-5.md) (contract v3.2.0; its findings were remediated the same day as v3.3.0 and committed in this HEAD, `a651740`).

### Contract Bytecode Hashes

Output of `pnpm run compute-bytecode-hashes` after a fresh `pnpm build` at this commit:

**AlgoSafe** (`smart_contracts/algo_safe/contract.algo.ts`):
- **Approval Program SHA256**: `b096f50b39dff57a9df61e36a9a74a35e9f892854495f4c5efc42e5d8822bf35` (7,166 bytes)
- **Clear Program SHA256**: `ed90f0d2da1f1d1abd773c45230651a292a90edbc12a7bf859a493a12a640ce7`

**AlgoSafeTxnValidator** (`smart_contracts/algo_safe_validator/contract.algo.ts`):
- **Pinned approval SHA256** (`validator-hash.generated.ts`): `0dd692344f80e7d5770f47bcde26c31eaaf24d45b5d177dfcbc7241742e188b1`. Unchanged since 2026-07-16; the build's `sync-validator-hash` step produced no working-tree diff.

The AlgoSafe approval hash equals `LATEST_CONTRACT_HASH` and the name of the single new client folder `clients/b096f50b…/` added by this commit (19 folders, up from 18). ✔

**CONTRACT_VERSION**: `BIATEC-ALGO-SAFE-v3.3.0` (`contract.algo.ts:150`). `git diff 9859b30..HEAD` changes `contract.algo.ts` (37 lines: cancel authorisation, two bitmask bounds, change-type range check, `ADM_SET_PAUSED` constant) and the version string was bumped from v3.2.0, with exactly one new `clients/<hash>/` folder. The contract-change workflow in `CLAUDE.md` was followed. ✔

### Build & Test Execution (fresh, this audit)

- LocalNet was already running (`algokit localnet status`: algod 4001 and indexer 8980 healthy, algod 5.0.3).
- `pnpm build` (from `projects/algo-safe-contracts/`): exit 0. `check-program-size: OK — AlgoSafe approval program: 7166 bytes (gate 7800, AVM ceiling 8192, margin 1026)`.
- `pnpm test` (`vitest run --coverage`, unit + e2e against LocalNet): **6 test files passed, 133 tests passed, 0 failed**, duration 315.5 s. This is 10 more tests than the previous audit (3 new contract regressions for v3.3.0, 7 new unit tests in `arc56.spec.ts`/`safe-tx.spec.ts`). Hand-written `src/` coverage: 87% lines; the aggregate figure is dominated by generated clients and is not meaningful.
- After the build, `git status` showed six generated files modified (`AlgoSafe.arc32.json`, `AlgoSafe.arc56.json`, `AlgoSafeClient.ts` under both `smart_contracts/artifacts/` and `clients/b096f50b…/`). Every changed line is a `"desc"` doc-comment string whose embedded line endings differ (`\r\n` committed vs `\n` rebuilt). The bytecode and the approval hash are unaffected. See [I-02]. The files were reverted; the tree is clean.
- Two throw-away PoC tests were written and run on LocalNet (see §4). Both passed, confirming the described behaviour. The PoC file was deleted afterwards.

---

## 2. Executive Summary

This audit covers HEAD `a651740`, which ships contract **v3.3.0**: the remediation of every finding from the 2026-10-14 audit. The audit did three things:

1. **Re-verified each v3.3.0 remediation** against the committed code and its regression test (cancel authorisation, bitmask bounds, change-type guard, clawback conversion, ARC-4 packing, spec-bytecode binding). All are in place and correct.
2. **A fresh adversarial read of the whole on-chain trust boundary** (`contract.algo.ts`, validator, shared types), focused on what the v3.3.0 change to `cancelProposal` alters in the threat model.
3. **Drift checks** on the off-chain library (`safe-tx.ts`, `version.ts`, `validator.ts`, `constants.ts`, `arc56.ts`) and the frontend consumer of the cancel rule.

**One High finding, one Medium, two Low, four Informational.** No Critical. The proposal state machine, execution-time re-checks, spend and guard accounting, box-key derivation, validator pinning and governance-lockout counter were all re-verified sound.

- **[H-01] Any single group member can permanently lock the safe's free ALGO in unprunable box storage.** A member of *any* group, including a zero-privilege, zero-action "agent" group, can create a transaction-group proposal with `expiryRound = 2^64-1` and six 1.8 KB payload chunks. Since v3.3.0 nobody else can cancel it while it is live; after the member is evicted it can be cancelled, but a cancelled proposal is only prunable once `Global.round > expiryRound`, i.e. never. The boxes' minimum balance (**4.76 ALGO per proposal for ~7 min-fee transactions**, measured) is withdrawn from the safe's spendable ALGO forever. **PoC confirmed on LocalNet.** The v3.2.0 decision to keep the past-expiry gate for `STATUS_CANCELLED`, combined with the v3.3.0 removal of any-member cancellation, turned a known honest-usage MBR leak (R-41) into a cheap, irreversible insider griefing primitive.
- **[M-01] Live proposals of a dissolved custodian group can never be cancelled by anyone except their proposer**, so they can never become terminal and the 2026-07-12 M-02 prune waiver never applies to them.
- **[L-01] `bootstrapGroup` does not validate `groupType`.** A seeded group with `groupType = 2` is treated as standard at execution and counted as an admin group, but `ADM_SET_PRIVILEGES` on it reverts forever. **PoC confirmed.**
- **[L-02] The frontend labels an asset *destroy* as "Reconfigure asset".** A reconfigure payload with all four role addresses zero is, by protocol rule, an asset destruction.
- **[I-01]** Staged key-registration inner transactions always carry fee 0, so a safe can go online but can never become incentive-eligible for block payouts. **[I-02]** Generated artifacts are not reproducible across line-ending conventions. **[I-03]** Documentation drift (removed getters still referenced in `CLAUDE.md`, `version.ts` return value misdocumented, prune/cancel semantics stale in `PRODUCT-DESCRIPTION.md`). **[I-04]** Frontend cannot offer the "stale proposal" cancel path to members.

Compiled approval program: **7,166 / 8,192 bytes** (1,026-byte margin, 12.5%). The H-01 fix *reduces* size.

---

## 3. Scope and Methodology

**In scope**
- `smart_contracts/algo_safe/contract.algo.ts` (1,544 lines), read in full.
- `smart_contracts/algo_safe_validator/contract.algo.ts` (118 lines) and `smart_contracts/shared/types.ts` (101 lines), read in full.
- `projects/algo-safe-contracts/src/`: `safe-tx.ts`, `version.ts`, `validator.ts`, `constants.ts`, `admin.ts`, `get-client.ts`, `latest-client.ts` in full; `arc56.ts` for the v3.3.0 diff; `on-chain.ts`/`migration.ts` unchanged since the last audit and checked for drift only.
- The ARC-56 app spec (method `actions`: `createApplication` is `create: [NoOp]` only; no update/delete handlers on either contract).
- Frontend: `ProposalDetailPage.tsx` (cancel rule consumer), `algoSafeProposals.ts` (payload rendering), the default `expiryRound` used by every proposal flow.
- `CLAUDE.md`, `PRODUCT-DESCRIPTION.md`, `README.md`, `AI-AUDIT-INSTRUCTIONS.md`, `RISK-REGISTRY.md`.

**Method**
- Followed `AI-AUDIT-INSTRUCTIONS.md`: state-machine enumeration (every read/write of `proposal.status`), execution-time re-check review, box-key collision analysis, two-pass inner-transaction review, spend/guard accounting, privilege matrix, PuyaTs gotcha checklist, codec/constant drift.
- Explicit threat-model delta: for each v3.3.0 change, asked "what could a member do before that they cannot now, and vice versa" and "which existing retention/gate rules did this change interact with".
- Every non-trivial hypothesis was tested on LocalNet with a throw-away Vitest spec using the suite's own helpers, not argued from source alone.
- Minimum-balance measurements use algod `accountInformation(...).minBalance` on the app account.

**Out of scope / limitations**: TEAL-level review of the compiled program; the frontend beyond the files named; the hosted ARC-56 registry image; MainNet/TestNet deployments (none registered yet, see R-39).

---

## 4. Findings

### [H-01] Any Single Member Can Permanently Lock the Safe's Spendable ALGO in Unprunable Box MBR

**Severity**: High
**Status**: Open
**Component**: AlgoSafe (contract.algo.ts)
**File**: `smart_contracts/algo_safe/contract.algo.ts:563-589` (propose), `:601-640` (append), `:740-757` (cancel), `:767-775` (prune gate), `:871` (expiry lower bound only)

**Description**:
Four individually reasonable rules combine into a griefing primitive:

1. `proposeTransactionGroup` is open to any member of any active group. It does not check `allowedActions` (deferred to execution), so a member of a group with `allowedActions = 0` and `adminPrivileges = 0` can still create proposals. Each proposal creates a proposal box, a payload box per chunk (up to six, each up to ~2 KB because the whole ABI argument block is 2,048 bytes) and an approval box. All MBR is paid by the **safe's app account**.
2. `expiryRound` has only a lower bound (`expiryRound > Global.round`, `:871`). `2^64 - 1` is accepted.
3. Since v3.3.0, `cancelProposal` (`:746-752`) allows only the proposer, or any member once the proposal is *stale* (past expiry or epoch-bumped). With a never-expiring proposal, the only way other members can cancel is to first evict the proposer through an admin proposal (which bumps `membershipEpoch`), and that is impossible if the proposer is the sole member of their group (`_adminRemoveMember` asserts `memberCount - 1 >= threshold`, `:1535`), in which case only `ADM_SET_ACTIVE` can neutralise the group, and that does not make its proposals stale.
4. `pruneProposal` requires `Global.round > expiryRound` for `STATUS_CANCELLED` proposals (`:773-775`, kept in v3.2.0 as a "review-retention window"). With `expiryRound = 2^64-1` the boxes can never be deleted. Approval boxes are never deleted by any path at all (disclosed limitation, R-43).

The result: a member spends ~7 minimum-fee transactions and permanently removes ~4.76 ALGO from the safe's spendable balance. Repeating this until the safe's balance equals its minimum balance leaves the safe unable to send ALGO at all (inner payments fail on min-balance). ASAs remain movable because inner-transaction fees are paid by the outer caller.

The admin-proposal path has the same shape (proposal box + `AdminChange` box with unbounded `groupName`/`memberLabel` strings), is **not** blocked by `ADM_SET_PAUSED`, and needs only `PRIV_GROUP` or `PRIV_POLICY`.

**Impact**:
- *Irreversible loss of custodied ALGO* equal to the safe's free balance, triggerable by one key. The ALGO is not stolen, but it is locked in the app account's minimum balance forever, which is economically a loss for the safe.
- The precondition is the weakest form of membership the product offers. "Agent" groups (`RegisterAgentPage`, `accountType = 4`) are designed to hold automation keys with no privileges; a compromised agent key, which R-02 rates at 35% over five years for any key, is sufficient.
- The defender's tools are all slower than the attack: pausing the safe or evicting the member requires an admin proposal to reach threshold and execute, while the attacker needs one round. Even after eviction, the damage already done is permanent.
- This supersedes the previous understanding (R-41: "honest usage with `FAR_EXPIRY` forfeits MBR until the round catches up") with an adversarial reading, and it changes the trade-off accepted in the v3.3.0 M-01 fix: the any-member cancel that was removed was also the only timely containment for this vector.

**Proof of Concept** (executed on LocalNet, passes — behaviour confirmed):
```typescript
// Group 2: threshold 1, members {attacker, other}, allowedActions = 0, adminPrivileges = 0.
const before = minBalance(appAddr)                                  //   637,100 µALGO
const payload = toSafeTxnGroup([createPaymentSafeTxn({ ..., note: 'x'.repeat(1800) })])
const pid = proposeTransactionGroup({ groupId: 2, payload, expiryRound: 2n**64n - 1n, execute: false }, sender: attacker)
for (slot = 2..6) appendTransactionGroupPayload({ proposalId: pid, payloadIndex: slot, payload }, sender: attacker)
const after = minBalance(appAddr)                                   // 5,401,100 µALGO  → +4,764,000 locked
cancelProposal(pid, sender: other)    // rejects: 'not authorised to cancel'
cancelProposal(pid, sender: deployer) // rejects
governAdminChange(ADM_REMOVE_MEMBER, group 2, attacker)             // epoch bump
cancelProposal(pid, sender: other)    // succeeds → STATUS_CANCELLED
pruneProposal(pid, sender: other)     // rejects: 'not yet expired'  (forever: expiryRound = 2^64-1)
pruneProposal(pid, sender: deployer)  // rejects
minBalance(appAddr) >= after          // true
```
Measured cost to the attacker in this run: 7 app calls. At MainNet minimum fee that is 7,000 µALGO to lock 4,764,000 µALGO (≈680×). Two proposals fit in one 16-transaction group, so locking 1,000 ALGO takes ~105 groups, a few minutes of wall-clock.

**Recommendation** (the program has 1,026 bytes of headroom; items 1 and 2 together *shrink* it):
1. **Drop the past-expiry gate for `STATUS_CANCELLED` in `pruneProposal`.** Cancellation is terminal and already recorded on the ledger (the `ProposalCancelled` event and the transaction history); the "review-retention window" argument does not justify permanent MBR loss. Only the group-membership check should remain. This closes the *permanent* part of H-01 (a cancelled proposal becomes prunable immediately by any member).
2. **Bound `expiryRound` at creation**: `assert(expiryRound <= Global.round + MAX_PROPOSAL_LIFETIME_ROUNDS)` in `_newProposal` (reusing `MAX_COOLDOWN_ROUNDS = 10,000,000` as the constant costs nothing). This caps the time a never-cancelled proposal can hold MBR and makes the "any member once stale" cancel path reachable within a bounded time even when the proposer cannot be evicted.
3. **Let `pruneProposal` reclaim approval boxes**: accept an `approvers: Account[]` argument and delete `approvals({proposalId, account})` for each named account (skipping non-existent ones). The caller enumerates approvers off-chain from `ProposalApproved` events or box listing. This stops the slow leak that R-43 tracks.
4. **Consider charging proposal MBR to the proposer** (the standard Algorand defence against box-MBR griefing): require a payment to the app account in the same group covering the MBR delta of the boxes created by `proposeTransactionGroup`/`appendTransactionGroupPayload`, refunded to the proposer on prune. This is a larger ABI change and can follow 1–3.
5. **Cheap defence-in-depth**: assert `group.allowedActions !== 0` in `proposeTransactionGroup` so a zero-action group cannot create transaction proposals at all, and bound `groupName`/`memberLabel` lengths in admin changes.
6. **Regression tests**: (a) a cancelled proposal with far-future expiry is prunable immediately; (b) `expiryRound` beyond the cap is rejected; (c) pruning deletes named approval boxes and the app min balance returns to its pre-proposal value.
7. Until fixed, operators should keep agent/automation groups to a minimum, prefer `ADM_SET_PAUSED` as the first incident response (it blocks the transaction-proposal path, not the admin path), and monitor `minBalance` growth on the app account.

This changes `contract.algo.ts`, so it requires a `CONTRACT_VERSION` bump to v3.4.0 and exactly one new `clients/<hash>/` folder.

**References**:
- R-41, R-43, R-44 in `RISK-REGISTRY.md`; 2026-07-16 audit M-01 (origin of the retained gate); 2026-10-14 audit M-01 (origin of the cancel restriction).

---

### [M-01] Live Proposals of a Dissolved Custodian Group Can Never Be Cancelled by Anyone but the Proposer

**Severity**: Medium
**Status**: Open
**Component**: AlgoSafe (contract.algo.ts)
**File**: `smart_contracts/algo_safe/contract.algo.ts:746-752` (cancel), `:780-782` (prune waiver), `:1387-1405` (dissolve)

**Description**:
`ADM_DISSOLVE_CUSTODIAN` deletes the group box and the last member box but leaves the group's `ACTIVE`/`READY` proposals untouched. In `cancelProposal`, `isMember` is evaluated against `members({groupId, account})`, which no longer exists for anyone, and the `isStale` branch requires `isMember`. The group-gone waiver added for M-02 (2026-07-12) exists only in `pruneProposal`, which requires a *terminal* status. Therefore, after dissolution, a live proposal can be cancelled only by `proposal.proposer`, which for a custodian group is typically a protocol smart contract that will never issue that call.

**Impact**: the proposal box, its payload boxes and approval boxes are locked permanently (bounded per proposal as in H-01, but requiring no malice: the custodian simply dissolves with a stale proposal outstanding). The M-02 fix's intent ("pruning only reclaims MBR, so anyone may do it once the group is gone") is defeated for exactly the proposals most likely to be left behind.

**Recommendation**: in `cancelProposal`, treat a missing group box as stale and waive the membership requirement, mirroring `pruneProposal`:
```ts
const groupExists = this.groups(proposal.groupId).exists
let isStale = Global.round > proposal.expiryRound || !groupExists
if (!isStale) isStale = this.groups(proposal.groupId).value.membershipEpoch !== proposal.epochAtCreation
assert(isProposer || (isStale && (isMember || !groupExists)), 'not authorised to cancel')
```
Add an e2e test: custodian creates a proposal, dissolves, then any account cancels and prunes it. Document that custodians should cancel their own outstanding proposals before dissolving.

---

### [L-01] `bootstrapGroup` Does Not Validate `groupType`

**Severity**: Low
**Status**: Open
**File**: `smart_contracts/algo_safe/contract.algo.ts:464-476`, `:514`, `:1355`

**Description**: `_seedGroup` branches on `seed.groupType === GT_CUSTODIAN` but never asserts `groupType <= GT_CUSTODIAN`. A seed with `groupType = 2` passes every check, is counted in `activePrivGroupCount` (the counter condition is `!== GT_CUSTODIAN`), executes as a standard group (`isCustodian` is `=== GT_CUSTODIAN`), is exempt from `_assertCustodianActions`, and `fetchSafeCloneConfig`/`deployClonedSafe` will faithfully propagate it to every successor safe. However `ADM_SET_PRIVILEGES` asserts `groupType === GT_STANDARD` (`:1355`), so the group's privileges can never be changed, and `ADM_SET_GUARD` rejects it too.

**PoC** (executed, passes): `bootstrapGroup({..., adminPrivileges: PRIV_ALL, groupType: 2n}, [deployer])` + `finalizeBootstrap()` succeed; `readSignerGroup(1).groupType === 2n`; `activePrivGroupCount === 1n`; `ADM_SET_PRIVILEGES` on group 1 reverts with `cannot set privileges on custodian groups`.

**Impact**: only the creator during bootstrap can cause it, and only by passing a value no tooling produces. It is a latent-state bug that migration tooling would replicate, and it makes `groupType` a third, undocumented behaviour class. The governed path `_createGroup` is safe (it takes a constant).

**Recommendation**: `assert(seed.groupType <= GT_CUSTODIAN, 'invalid group type')` in `_seedGroup` (~10 bytes), and have `fetchSafeCloneConfig` reject unknown types. Add a unit/e2e test.

---

### [L-02] Frontend Renders an Asset Destroy as "Reconfigure Asset"

**Severity**: Low (Integration / Client; R-22 class)
**Status**: Open
**Files**: `projects/algo-safe-frontend/src/services/algoSafeProposals.ts:341-351`; `contract.algo.ts:1164-1170`

**Description**: for `configAsset !== 0`, `_stageAssetConfig` sets `ConfigAsset` plus the four role addresses from the payload and nothing else. By go-algorand's apply rule, an asset-config transaction whose `ConfigAsset` is set and whose `AssetParams` equals the zero value is an **asset destroy** (allowed when the sender is the manager and the creator holds the full supply); any non-zero role makes it a reconfigure. A payload with all four roles set to the zero address therefore destroys the asset. The frontend summary (`service.tx.reconfigureAsset`) is chosen purely on `configAsset !== 0` and does not display the role addresses, so a destroy proposal appears as a benign reconfigure.

**Impact**: a signer approves an irreversible asset destruction believing it to be a role change. The reverse mistake (an operator intending to "clear all roles" and destroying the asset) is also invisible. Bounded by threshold approvals and by the destroy preconditions.

**Recommendation**: in `algoSafeProposals.ts` detect `manager === reserve === freeze === clawback === ZERO_ADDR` for `configAsset !== 0` and label it "Destroy asset #id" with a warning; always render the four role addresses for reconfigure payloads. Document the protocol rule in `README.md` next to `createAssetConfigSafeTxn`.

---

### [I-01] Key-Registration Inner Transactions Always Carry Fee 0, So the Safe Can Never Become Incentive-Eligible

**Severity**: Informational (product gap)
**File**: `contract.algo.ts:1133-1145`; `shared/types.ts` (`KeyRegTxn`)

Since the Algorand consensus upgrade that introduced staking payouts, an account becomes *incentive-eligible* only when its online key registration carries a fee of at least the protocol's go-online fee (2 ALGO). `_stageKeyReg` unconditionally sets `fee = 0` (fees are pooled from the outer caller), so a safe can register participation keys and vote, but will never receive block payouts. `KeyRegTxn` has no field to request the eligibility fee. Recommend adding an `incentiveFee: uint64` field (or a boolean) that `_stageKeyReg` passes to `setFee`, paid from the safe's balance, and documenting the limitation until then.

---

### [I-02] Generated Artifacts Are Not Reproducible Across Line-Ending Conventions

**Severity**: Informational
**Files**: `smart_contracts/artifacts/algo_safe/AlgoSafe.{arc32,arc56}.json`, `AlgoSafeClient.ts`, and the mirrored `clients/b096f50b…/` copies

A fresh `pnpm build` on this machine left the six files above modified. Every diff hunk is a `"desc"` string in which the doc-comment newlines are `\r\n` in the committed file and `\n` in the rebuilt one. The compiler copies the contract's JSDoc verbatim, so the artifact depends on the checkout's line endings. Bytecode, hashes and the client's behaviour are unaffected, but CI "artifacts are up to date" checks, audit reproducibility and the "one new client folder per commit" rule all become OS-dependent. Recommend `*.ts text eol=lf` (and `*.json`) in `.gitattributes`, or normalising `\r\n` → `\n` in `sync-versioned-client`.

---

### [I-03] Documentation Drift

**Severity**: Informational (R-33)

- `CLAUDE.md` "Rekeyed-address registry" still says to read entries with `isRekeyedAddress`/`getRekeyedAddress`, and "Box pruning" ends with "`getActivePrivGroupCount()` is the read-only getter"; all three getters were removed in v3.0.0. Readers should be pointed at `readRekeyedAddress`/`readSafeConfig`.
- `CLAUDE.md` "Working with the `algo-safe` npm package" says `getAlgoSafeContractVersion` returns `undefined` if unrecognized; `version.ts:91` returns `'latest'` (and also when the app has no approval program). The code behaviour is the riskier one: an unknown or non-AlgoSafe app id is silently treated as the latest ABI. Either document it or return `undefined` and let callers decide.
- `PRODUCT-DESCRIPTION.md:682` describes `pruneProposal` as "reclaim box MBR of terminal, expired proposals" (stale since v3.2.0), and its state diagram (`:737-743`) shows `cancelProposal()` from `Draft`/`WaitingForApprovals` only and predates the v3.3.0 proposer-only rule.
- `audits/AI-AUDIT-INSTRUCTIONS.md` Phase-1 item 4 still lists the removed getters (carried over from the 2026-10-14 I-03) and its e2e count ("~26") is stale (86 `test(` cases today).
- `MODERN_ABI_CONTRACT_HASHES` (`version.ts`) is a hand-maintained list that must gain the previous latest hash on every release; a unit test asserting it contains every `CONTRACT_HASHES` entry at or after v3.0.0 would catch an omission.

---

### [I-04] Frontend Cannot Offer the "Stale Proposal" Cancel Path

**Severity**: Informational (UX, R-44 follow-through)
**File**: `projects/algo-safe-frontend/src/pages/ProposalDetailPage.tsx:102-108`

`canCancel` is `proposer && live` or `expired && connected`. Epoch-stranded proposals (member removed) render as pending and cannot be cancelled from the UI, as the code comment admits; the `expired` branch is shown to any connected address although the contract requires group membership. Recommend comparing `proposal.epochAtCreation` with the group's live `membershipEpoch` (both are already readable via `readProposal`/`readSignerGroup`) and gating the expired branch on membership.

---

### Verified Non-Issues (checked this audit and confirmed sound)

| Area | Result |
|---|---|
| v3.3.0 cancel rule | Proposer-only for live proposals; any member once expired or epoch-stranded. Regression test covers non-approver, approve-then-cancel, proposer, and epoch-stale paths. Approvers correctly get no cancel right. |
| v3.3.0 bitmask bounds / change-type guard | `ADM_SET_POLICY` asserts `allowedActions <= ACT_ALL`; `ADM_SET_PRIVILEGES` asserts `adminPrivileges <= PRIV_ALL`; `proposeAdminChange` asserts `1 <= changeType <= 14`; the final `_applyAdminChange` branch asserts `=== ADM_SET_PAUSED`. All regression-tested. |
| ABI lifecycle | `createApplication` is `create: [NoOp]` only (cannot be re-invoked on a deployed safe); neither contract declares update/delete handlers; validator `bareActions.create = [NoOp]`. |
| Status transitions | `EXECUTED` only from `READY` (asserted before any mutation); `CANCELLED` only from `ACTIVE`/`READY`; `groupId`/`payloadType`/`proposer` are never rewritten. |
| Threshold & epoch at execution | `max(snapshot, live)` threshold; live `membershipEpoch`, `group.active`, `paused`, cooldown (with first-execution sentinel) and admin privilege all re-read at execution. |
| Payload binding | `approveProposal` requires the live `payloadVersion`; append is proposer-only, blocked after an independent approval, after expiry and while paused; `totalTxns` handles slot overwrites. |
| Box keys | `txg` key `pid*7 + {1..6}` collision-free; prefixes `g,m,p,a,txg,dp,r,ag` differ in prefix or total key length. |
| Two-pass execution | Budget calls only before any `ITxnCreate` group is open; every staged entry was validated in pass 1 (validator C2C or `_validateApp`); unknown `txType` reverts in the validator; no app create/update path. |
| Spend/guard accounting | Close-outs count the resolved sender's live balance; custodians need a guard even for zero amounts; `limitAssetId` change resets counters; `uint64` additions fail closed on overflow. |
| Rekey | Requires `ACT_REKEY` **and** `PRIV_GROUP`, non-custodian, non-zero target, enforced in the pinned validator. |
| Lockout counter | Maintained on seed/create/set-privileges/set-active; custodians excluded; `finalizeBootstrap` requires ≥1. |
| Codecs & constants | All six `*_CODEC` strings match the shared struct field order; `constants.ts` matches `shared/types.ts` and the `ADM_*` values in the contract. |
| Reentrancy | AVM forbids re-entering an app on the call stack; the validator is stateless. |

---

## 5. Missing Test Scenarios

### Missing Test: Cancelled Far-Future Proposal Is Reclaimable (H-01)
**Description**: lock in that MBR of a cancelled proposal can be reclaimed regardless of `expiryRound`, and that approval boxes are deleted on prune.
**Risk if Untested**: the permanent-lock primitive persists or silently returns in a later refactor.
**Test Steps**: 1. zero-privilege member proposes with `expiryRound = 2^64-1` and six max chunks; record app `minBalance`. 2. evict the member; another member cancels. 3. prune with named approvers. 4. assert `minBalance` returns to the pre-proposal value.
**Expected Behavior**: per the chosen fix in H-01.
**Edge Cases**: proposer is the group's sole member (only `ADM_SET_ACTIVE` possible); admin-change proposal variant; proposal pruned by a non-member after group dissolution.
**Priority**: High

### Missing Test: Expiry Upper Bound (H-01, recommendation 2)
**Description**: `expiryRound > Global.round + cap` is rejected by `proposeTransactionGroup`/`proposeAdminChange`.
**Priority**: High

### Missing Test: Dissolved-Group Live Proposal Cleanup (M-01)
**Description**: custodian proposes, dissolves, then a non-member cancels and prunes.
**Priority**: Medium

### Missing Test: Seed `groupType` Validation (L-01)
**Priority**: Low

### Missing Test: Asset-Destroy Rendering (L-02)
**Description**: Jest test for `deriveTxPreview` on an acfg payload with all-zero roles.
**Priority**: Low

### Carried over (still open from earlier audits)
- Expiry boundary round (`Global.round === expiryRound`) for approve/execute/append.
- Daily/monthly limit rollover exactly at the period boundary.
- Max-size payload (6 chunks / 16 txns) end-to-end execution.
- MBR under-funding when a new box is needed (R-24).
- Adversarial ARC-4 bytes in `entry.data` (R-16).
- Indexer-backed pagination for enumeration helpers (R-43).

---

## 6. Documentation Gaps

### Documentation Gap: Who Pays Box MBR, and What a Member Can Cost the Safe
**Missing Information**: `PRODUCT-DESCRIPTION.md` says to fund the app account for box MBR but nowhere states that any member can create boxes charged to the safe, nor the per-proposal maximum (~4.8 ALGO), nor the retention rules.
**User Impact**: operators size the safe's ALGO float and their trust in low-privilege groups without knowing this cost model.
**Recommended Documentation**: a "Storage economics" paragraph: per-box MBR formula, maximum per proposal, who can create, who can prune, and (after the fix) the expiry cap.
**Location**: `PRODUCT-DESCRIPTION.md` governance/storage section; `README.md` "Approve, execute, cancel".
**Priority**: High

### Documentation Gap: Asset Destroy Semantics
**Missing Information**: that an acfg reconfigure with all-zero roles destroys the asset.
**Location**: `README.md` next to `createAssetConfigSafeTxn`; frontend copy.
**Priority**: Medium

### Documentation Gap: Stale References (see [I-03])
**Priority**: Low

---

## 7. Security Best Practices — Compliance Assessment

| Practice | Status |
|---|---|
| Least privilege / privilege re-check at execution | ✅ |
| Fail-closed validation of payload shapes (on-chain and conversion) | ✅ (clawback now rejected) |
| Input bounds on stored bitmasks and change types | ✅ (v3.3.0) |
| Liveness protection against a minority signer | ✅ (v3.3.0 cancel rule) |
| Resource-exhaustion protection against a minority signer | ❌ ([H-01]) |
| Bounded storage lifetime / reclaimable MBR | ⚠️ cancelled-proposal gate and approval boxes ([H-01], R-43) |
| Immutable, hash-pinned external dependency (validator) | ✅ |
| Program-size gate in CI | ✅ (7,166 / 7,800 gate / 8,192 ceiling) |
| Contract-change workflow (version bump, single client folder) | ✅ |
| Reproducible build artifacts | ⚠️ line-ending dependent ([I-02]) |
| Supply-chain pinning of the frontend trust anchor | ⚠️ registry image still `:latest` (R-47) |

---

## 8. Risk Assessment

The on-chain custody core remains sound against theft: unauthorised execution, replay, spending-limit bypass, governance lockout and bait-and-switch are all closed and were re-verified at this commit. The new material risk is **availability of custodied ALGO**: H-01 lets one low-privilege key irreversibly convert the safe's spendable ALGO into locked storage minimum balance. Because agent/automation keys are an intended product feature and key compromise is the dominant industry loss category, this is scored as a High-residual risk until fixed. Everything else found is Low or Informational.

The full, living risk model is in [`RISK-REGISTRY.md`](./RISK-REGISTRY.md). This audit adds **R-49** (insider MBR-lock griefing, High), **R-50** (dissolved-group live proposals uncancellable), **R-51** (unvalidated seed `groupType`), **R-52** (asset destroy rendered as reconfigure), **R-53** (keyreg fee 0 blocks incentive eligibility) and **R-54** (artifact reproducibility); re-opens **R-41** to Partially Mitigated (its retained gate is the H-01 mechanism); confirms **R-44/R-45/R-46/R-48** Mitigated at the committed v3.3.0 and re-scores them to <1%; and annotates R-02/R-03/R-22/R-25/R-33/R-43/R-47. See its Change Log row dated 2026-10-15.

---

## 9. Recommendations (Prioritized)

1. **[High] Close H-01 in a v3.4.0 release**: remove the cancelled-proposal past-expiry prune gate, cap `expiryRound` at creation, and let `pruneProposal` delete named approval boxes. Bundle M-01 (missing-group cancel waiver) and L-01 (`groupType` bound) in the same release: one version bump, one new client folder, regression tests from §5.
2. **[Medium] Proposer-funded MBR** as the structural fix for box griefing (can follow item 1).
3. **[Low] Frontend**: asset-destroy labelling (L-02), stale-proposal cancel detection and membership gating (I-04).
4. **[Low] Build hygiene**: `.gitattributes` line-ending normalisation (I-02); unit test for `MODERN_ABI_CONTRACT_HASHES`.
5. **[Low] Documentation refresh** (I-03 and §6), including a storage-economics section.
6. Carried over: populate `VALIDATOR_DEPLOYMENTS` after the first TestNet/MainNet deployment (R-39); pin the ARC-56 registry image by digest (R-47); add the CI doc-sync check (R-33); indexer pagination (R-43).

---

## 10. Testing Recommendations

- Convert the two PoCs in §4 into regression tests alongside the fixes; assert on `minBalance` deltas, not only on revert messages, so storage accounting is covered end-to-end.
- Add a "storage griefing budget" test that creates N max-size proposals from a zero-privilege member and asserts the safe can still send ALGO afterwards (this will only pass once proposer-funded MBR or the expiry cap plus prune changes land).
- Add a Jest test for `deriveTxPreview` covering create / reconfigure / destroy acfg payloads.
- Add a Vitest test that `MODERN_ABI_CONTRACT_HASHES ⊇ {CONTRACT_HASHES since v3.0.0}`.

---

## 11. Compliance and Standards

- **ARC-4**: on-chain ABI usage conforms; `createApplication` is create-only; the off-chain decoder now follows the 15-argument packing rule.
- **ARC-28** events: emitted for every state change; `ProposalCancelled` still carries no actor (informational, unchanged).
- **ARC-56**: display aid only; spec-bytecode binding added in v3.3.0; registry trust limits remain (R-47).
- **AVM limits**: program 7,166 / 8,192 bytes; app-call resource constants match current consensus; keyreg inner transactions are protocol-valid but never incentive-eligible ([I-01]).

---

## 12. Appendix

### A. Test Execution Record
```
cd projects/algo-safe-contracts
algokit localnet status   # already running (algod 5.0.3, indexer healthy)
pnpm build                # exit 0; check-program-size: OK — 7166 bytes (gate 7800, ceiling 8192, margin 1026)
pnpm test                 # Test Files 6 passed (6); Tests 133 passed (133); Duration 315.54s
pnpm run compute-bytecode-hashes
# PoC run (temporary spec zz-audit-poc-2026-10-15.e2e.spec.ts, deleted afterwards):
#   Test Files 1 passed (1); Tests 2 passed (2)
#   PoC-1: safe min balance before=637100 after=5401100 locked by one proposal=4764000 microALGO
git checkout -- clients smart_contracts/artifacts   # revert line-ending-only artifact churn (I-02)
```

### B. Files Reviewed
`smart_contracts/algo_safe/contract.algo.ts` (full), `smart_contracts/algo_safe_validator/contract.algo.ts` (full), `smart_contracts/shared/types.ts` (full), `smart_contracts/algo_safe/validator-hash.generated.ts`, `smart_contracts/artifacts/algo_safe/AlgoSafe.arc56.json` (method actions), `src/safe-tx.ts`, `src/version.ts`, `src/validator.ts`, `src/constants.ts`, `src/admin.ts`, `src/get-client.ts`, `src/latest-client.ts`, `src/arc56.ts` (diff), `src/on-chain.ts`/`src/migration.ts` (drift only), `contract.e2e.spec.ts` (helpers + v3.3.0 tests), `projects/algo-safe-frontend/src/pages/ProposalDetailPage.tsx`, `projects/algo-safe-frontend/src/services/algoSafeProposals.ts`, `CLAUDE.md`, `PRODUCT-DESCRIPTION.md`, `projects/algo-safe-contracts/README.md`, `audits/AI-AUDIT-INSTRUCTIONS.md`, `audits/RISK-REGISTRY.md`, the 2026-10-14 audit report.

### C. Verification Notes / Limitations
- LocalNet was available and the full suite ran fresh. Nothing was skipped.
- H-01 and L-01 were confirmed by executed PoCs. M-01, L-02, I-01 and I-03 were established by code reading; L-02 and I-01 additionally rely on go-algorand's asset-config apply rule and the staking-payout eligibility rule respectively, which were applied from protocol knowledge, not re-derived on LocalNet.
- The approval-box MBR figure (34,900 µALGO) and the per-proposal maximum are computed from the box MBR formula and corroborated by the measured 4,764,000 µALGO delta for one proposal with six 1,800-byte-note chunks.
- `on-chain.ts` and `migration.ts` are unchanged since the previous audit and were checked for drift only. The frontend was reviewed only where it consumes the cancel rule and renders payloads.
