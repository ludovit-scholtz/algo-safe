# AI Audit Instructions

## Purpose

This document provides comprehensive guidelines for AI models to conduct professional security audits of the **algo-safe** smart account system on Algorand: a policy-driven, M-of-N governed smart contract that custodies ALGO/ASAs and only moves value or changes its own governance when a signer group's approval threshold is met.

---

## Prerequisites

Before conducting the audit, ensure you have:

1. **Access to the complete repository structure** (pnpm monorepo — see `CLAUDE.md` at the repo root for the full layout)
2. **Understanding of the technology stack**:
   - Algorand blockchain and AVM (Algorand Virtual Machine)
   - Algorand TypeScript (PuyaTs) — the contract's source language, compiled to AVM bytecode
   - `algosdk` v3 and `algokit-utils` v9 for the TypeScript client/library layer
   - ARC-4 ABI encoding, box storage, inner transactions (`itxn`), ARC-28 events
3. **Familiarity with multisig / smart-account security principles** (Safe-on-EVM-style shared custody, threshold governance, spending policies)
4. **Knowledge of common smart contract vulnerabilities**, especially access-control and state-machine bugs (this is a governance/custody contract, not an AMM — there is no pricing math to verify, but there is a proposal lifecycle state machine to verify)

---

## Audit Preparation

### 1. Document Your Identity

At the start of the audit report, clearly document:

```markdown
**AI Model**: [Model Name] ([Model Version])
**Provider**: [Company Name]
**Audit Date**: YYYY-MM-DD
**Commit Hash**: [Full 40-character git commit hash]
**Commit Date**: [Git commit timestamp]
```

Example:

```markdown
**AI Model**: Claude Sonnet 5 (claude-sonnet-5)
**Provider**: Anthropic
**Audit Date**: 2026-07-06
**Commit Hash**: 28cc9d1a64277c8dcf4080f6dfa10357e88f45d5
**Commit Date**: 2026-07-06 15:08:45 +02:00
```

### 2. Include Contract Bytecode Hashes

**MANDATORY REQUIREMENT**: Include SHA256 hashes of the compiled contract bytecode in the audit header.

Run from `projects/algo-safe-contracts/` (after `pnpm build` so `smart_contracts/artifacts/algo_safe/AlgoSafe.arc56.json` is current):

```bash
pnpm run compute-bytecode-hashes
```

Copy the output directly into the "Contract Bytecode Hashes" section of the audit. These hashes verify that the audit was performed on the exact bytecode that was reviewed.

**Also record the contract's own version string** — `CONTRACT_VERSION` near the top of `smart_contracts/algo_safe/contract.algo.ts` (e.g. `BIATEC-ALGO-SAFE-v1.2.0`) and confirm it was bumped if `contract.algo.ts` changed since the last audited commit (mandatory per `CLAUDE.md`'s "Contract change workflow"). A changed contract with an unbumped version string is itself a finding.

### 3. Run the Full Test Suite (MANDATORY)

**MANDATORY REQUIREMENT**: Every audit MUST build the contract and run the complete test suite, and MUST report the actual result in the audit. Do not rely on stale coverage reports or previously recorded runs — always execute the tests fresh against the commit being audited.

`pnpm test` runs **both** the pure unit spec (`src/version.spec.ts`) and the on-chain e2e spec (`smart_contracts/algo_safe/contract.e2e.spec.ts`) via Vitest's default `*.spec.ts` discovery — the e2e spec needs a running LocalNet (it deploys the real compiled contract via `algorandFixture`). Start it if needed:

```bash
# Start LocalNet (required for the e2e tests)
algokit localnet start
# Verify it is up
docker ps
```

Then, from `projects/algo-safe-contracts/`:

```bash
pnpm build   # compile PuyaTs -> AVM, generate typed client, sync versioned-client registry
pnpm test    # vitest run --coverage — unit spec + e2e spec together
```

Record in the audit report:

- The exact command(s) executed.
- The final Vitest summary (test files / tests passed / failed, total) and the suite pass/fail status.
- Any failing test names, with a short analysis of whether each failure is a test-harness issue (e.g. LocalNet not running, stale build artifacts) or a real contract defect.
- The **compiled approval-program size** against the 8192-byte AVM ceiling (see `/check-program-size` — POST `smart_contracts/artifacts/algo_safe/AlgoSafe.approval.teal` to LocalNet's algod `/v2/teal/compile` and measure the base64-decoded `result` length). Report the number and the margin. A contract change that erodes this margin significantly (e.g. by enumerating per-length branches instead of using the `op.ITxnCreate` append-setter loop pattern) is worth flagging even if it still fits.

If the suite cannot be run (for example, no LocalNet is available), this MUST be stated explicitly in the report's "Verification Notes / Limitations" section, together with the reason. An audit that silently skips the tests is considered incomplete.

### 4. Repository Context Gathering

Execute these steps in order (from the repo root):

```bash
# Get commit information
git log -1 --format="%H %cI"

# Understand repository structure
tree -L 3 -I 'node_modules|dist|.git|coverage|clients' projects/algo-safe-contracts

# Count lines of code
wc -l projects/algo-safe-contracts/smart_contracts/algo_safe/contract.algo.ts
wc -l projects/algo-safe-contracts/smart_contracts/algo_safe/contract.e2e.spec.ts
wc -l projects/algo-safe-contracts/src/*.ts
```

Unlike a multi-contract system, **algo-safe's entire on-chain logic lives in one file**: `smart_contracts/algo_safe/contract.algo.ts`. Treat that file as the primary audit target; the `src/*.ts` files are off-chain TypeScript helpers (transaction builders, decoders, version detection) that must stay byte-for-byte consistent with the on-chain ARC4 struct layouts.

---

### 5. Audit report naming structure

Write the audit to the `audits/` folder at the repo root.

File name must contain date, context, `ai` to identify it as an AI audit, and the model name: `{YYYY-MM-DD}-audit-report-ai-{model-name}.md`, for example: `2026-07-06-audit-report-ai-claude-sonnet-5.md`.

---

## Audit Methodology

### Phase 1: Comprehensive Code Review

#### Smart Contract (`smart_contracts/algo_safe/contract.algo.ts`, ~1000+ lines)

There is a single contract, `AlgoSafe`. Review it as these logical sections (all in one file):

1. **Lifecycle** — `createApplication`, `bootstrap` (genesis 1-of-1 admin group creation, one-time)
2. **Proposal creation** — `proposeTransactionGroup`, `appendTransactionGroupPayload` (multi-chunk payloads, slots 1–6), `proposeAdminChange`
3. **Approval / execution / cancellation** — `approveProposal`, `executeProposal`, `cancelProposal`, and the shared `_executeProposalInternal`
4. **Read-only getters** — `getConfig`, `getSignerGroup`, `getProposal`, `getTransactionGroup`, `getMember`, `isMember`, `hasApproved`
5. **Internal: typed-payload execution** — `_executeTransactionGroup`, the per-type `_stage*`/`_validate*` functions (payment, asset transfer, app call, key registration, asset config), and `_accountSpend` (daily/monthly limit accounting)
6. **Internal: admin change application** — `_assertPrivilegeForChange`, `_validateAdminChange`, `_applyAdminChange`, `_adminCreateGroup`, `_adminAddMember`, `_adminRemoveMember`

#### Key Areas to Examine:

**Proposal State Machine** (the contract's core invariant — replaces "math correctness" as the primary correctness axis here):

- [ ] Status transitions only go `ACTIVE -> READY -> EXECUTED` or `ACTIVE/READY -> CANCELLED` — no other transition is reachable
- [ ] A proposal cannot be executed twice (status must flip to `EXECUTED` before any state that could be re-entered)
- [ ] A proposal cannot be approved after expiry (`Global.round <= proposal.expiryRound`) or after it is no longer `ACTIVE`/`READY`
- [ ] Multi-chunk payloads (`appendTransactionGroupPayload`, slots 2–6) can only be appended while the proposal is still pending, and `numPayloads` bookkeeping can't be desynced from what's actually stored
- [ ] `proposeTransactionGroup(..., execute: true)` re-runs every check `executeProposal` would run — verify the "shortcut" path can't skip a validation the normal path enforces

**Access Control**:

- [ ] Signer-group membership checks (`_assertMember`) gate every proposing/approving action
- [ ] `allowedActions` bitmask (PAY/AXFER/APPL/KEYREG/ACFG) is checked **at execution time** against the *current* group state, not just at proposal time (privilege/policy could change between proposal and execution — verify `_executeProposalInternal` re-checks `group.active` and re-checks admin privilege for admin changes)
- [ ] `adminPrivileges` bitmask (GROUP/POLICY) correctly gates each `AdminChange.changeType`
- [ ] `bootstrap` is truly one-time and creator-only
- [ ] A signer group's own admin can't remove members below its threshold (`_adminRemoveMember` asserts `memberCount - 1 >= threshold`) or set an unreachable threshold (`_adminCreateGroup`/`ADM_CHANGE_THRESHOLD` bounds)

**State Management / Box Storage**:

- [ ] Box key derivation has no collisions — in particular `transactionGroups` keys (`proposalId * TXG_KEY_MULT + payloadIndex`, `TXG_KEY_MULT = 7`) must never alias a different `(proposalId, payloadIndex)` pair; verify the multiplier is still `>` the max payload index (6) if either constant ever changes
- [ ] `approvals` BoxMap correctly prevents double-approval (`already approved` assert) and double-counting toward threshold
- [ ] Spending-limit period rollover (`_accountSpend`'s daily/monthly window reset) can't be gamed by transaction ordering or by an admin changing `limitAssetId` mid-period (verify usage counters reset when the tracked asset changes)

**Asset / Inner-Transaction Handling**:

- [ ] Every inner-txn field the contract stages is exactly what was validated in pass 1 (`_executeTransactionGroup`'s two-pass structure: validate+tally, then stage) — nothing can be staged that wasn't validated
- [ ] `ensureBudget` is only ever called before the `op.ITxnCreate` group opens (never mid-group — see the `ensureBudget()` cannot run while an `op.ITxnCreate` group is open" gotcha in `CLAUDE.md`); confirm callers always supply enough `ensureBudgetValue` before both passes run
- [ ] Asset-config create vs. reconfigure branch (`_stageAssetConfig`) never sets `ConfigAsset` to `0` for a create (would trigger `unavailable Asset 0`) and never lets a reconfigure touch immutable params
- [ ] App-call resource limits (`MAX_APP_ARGS`, `MAX_APP_ACCOUNTS`, `MAX_APP_FOREIGN_APPS/ASSETS`, `MAX_APP_TOTAL_REFS`, `MAX_APP_TOTAL_ARG_LEN`) are enforced *before* staging, matching real Algorand consensus limits — check these constants haven't drifted from protocol reality
- [ ] `onCompletion == 4` (UpdateApplication) and `appId == 0` (create) are rejected, matching the "no program bytes carried" constraint noted in `CLAUDE.md`
- [ ] Key registration fields (`voteKey`/`selectionKey`/`stateProofKey`) are only set when `online != 0`; going offline correctly omits them

**Economic / Custody Security**:

- [ ] Daily/monthly spending limits (`dailyLimit`/`monthlyLimit`) apply only to the group's `limitAssetId`-tracked asset and can't be bypassed by splitting a transfer across multiple payload chunks or multiple proposals in the same period
- [ ] A `threshold`-of-`memberCount` group can't be executed with fewer real approvals than `threshold` (off-by-one in `>=` vs `>` comparisons)
- [ ] Auto-approval of the proposer (`_newProposal` -> `_recordApproval`) can't let a 1-of-N proposer bypass a higher effective threshold, and can't double-count if the proposer approves again

### Phase 2: TypeScript Client Library Review (`projects/algo-safe-contracts/src/`)

1. **Transaction builders / codecs** (`safe-tx.ts`)

   - [ ] Each `*_CODEC` ARC4 tuple type string is byte-for-byte in sync with the matching on-chain struct's field order (`PaymentTxn`, `AssetTxn`, `AppTxn`, `KeyRegTxn`, `AssetConfigTxn` in `contract.algo.ts`) — a silent drift here would desync encode/decode without any type error
   - [ ] `decode*Txn` helpers correctly normalise algosdk's `number[]` decode of nested `byte[]`/`byte[][]` back to `Uint8Array` (`toBytes`/`normalisedArgs`) — a round-trip that skips this would corrupt comparisons or re-submission
   - [ ] `algosdkTxnsToSafeTxnGroup` covers every executable transaction type and fails loudly (not silently drops) on unsupported types

2. **Version / client-selection helpers** (`version.ts`, `versioned-clients.generated.ts`, `latest-client.ts`, `get-client.ts`)

   - [ ] `getAlgoSafeContractVersion` hashes the *deployed* approval program correctly and falls back to `'latest'` only when genuinely unrecognized, never silently misidentifying an old deployed contract as the latest ABI shape
   - [ ] Bitmask/constant exports in `constants.ts` (`ACT_*`, `PRIV_*`, `ADM_*`, `TX_*`) match `contract.algo.ts` exactly — per `CLAUDE.md`, any drift here is a packaging bug, not a style nit

3. **On-chain state queries** (`on-chain.ts`) and **admin helpers** (`admin.ts`)

   - [ ] Error handling on missing boxes / non-existent proposals or groups
   - [ ] No assumptions about tuple field order that should instead go through the `decode*Txn` helpers

### Phase 3: Test Coverage Analysis

**MANDATORY**: Run the full suite (see "Run the Full Test Suite" above) and confirm the current pass/fail status before writing conclusions. The audit's claims about behavior must be consistent with a fresh test run, not with cached results.

```bash
# Full build + all tests (authoritative — run this and report the result)
pnpm build && pnpm test

# e2e tests only, without rebuilding
pnpm test:e2e

# Coverage
pnpm test -- --coverage
```

`contract.e2e.spec.ts` currently has ~26 test cases (check the current count — grep `test(` in the file, don't trust this document's number as the suite evolves). Map each test to the checklist items above and identify what is **not** covered, e.g.:

- [ ] Proposal expiry exactly at the boundary round (`Global.round === expiryRound`)
- [ ] Concurrent/interleaved approvals from multiple members racing the threshold
- [ ] Admin change that revokes the *proposer's own* privilege before execution (re-check-at-execution-time behavior)
- [ ] Daily/monthly limit rollover exactly at the period boundary
- [ ] Maximum-size payloads (6 chunks × 16 txns, at the `MAX_GROUP_TXNS` boundary)
- [ ] Malformed/adversarial ARC4 payload bytes for `entry.data` that don't match the declared `txType`
- [ ] Box MBR / funding edge cases (safe under-funded when a new box needs to be created)
- [ ] Removing the last admin-privileged member from a group (governance lockout scenario)

**Identify Missing Scenarios**:

- Attack vectors not covered
- Edge cases not tested
- Governance lockout scenarios (can the safe end up with no group able to execute admin changes?)
- Multi-signer race conditions

### Phase 4: Documentation Review

Review `CLAUDE.md`, `PRODUCT-DESCRIPTION.md`, `AGENTS.md`, and any package `README.md` for:

1. **Completeness**: all public contract methods documented, security model explained, versioning/breaking-change policy documented
2. **Accuracy**: documented ABI shapes match the actual deployed contract; the "Breaking changes seen across versions" section in `CLAUDE.md` matches what's really in `versioned-clients.generated.ts`
3. **User Safety**: risk disclaimers (custody risk, threshold-misconfiguration risk, key-registration risk) present where relevant

---

## Security Checklist

### Critical Security Issues

#### Smart Contract Security

- [ ] **Reentrancy**: Can inner transactions or cross-app calls staged by the safe lead to reentrancy into the safe's own methods?
- [ ] **Integer Overflow/Underflow**: Are `uint64` arithmetic operations (spend accounting, member counts, box keys) safe against overflow?
- [ ] **Division by Zero**: N/A unless added — flag any new division introduced in future changes
- [ ] **Access Control**: Are privileged functions (admin changes, proposal execution) properly protected and re-validated at execution time?
- [ ] **State Consistency**: Can a proposal, group, or box end up in an inconsistent state (e.g. `numPayloads` not matching stored chunks, `approvalsCount` desynced from actual `approvals` boxes)?
- [ ] **Asset Safety**: Are staged inner transactions always exactly what was validated? Can a payload be staged without having been validated?
- [ ] **Governance Lockout**: Can a sequence of admin changes leave no group with `PRIV_GROUP`/`PRIV_POLICY` privilege, permanently freezing governance?
- [ ] **Replay / Double-Execution**: Can `executeProposal` run twice on the same proposal, or can a cancelled/expired proposal still execute?
- [ ] **Front-Running**: Can a competing approval or admin change front-run a pending proposal to change its effective authorization mid-flight?
- [ ] **Rounding Errors**: N/A (no fractional math) — but check spend-limit accounting for off-by-one comparisons (`<=` vs `<`)

#### Algorand-Specific Issues

- [ ] **Box Storage**: Are box names/keys constructed correctly and collision-free (`groups`, `members`, `proposals`, `approvals`, `transactionGroups`, `adminPayloads`)?
- [ ] **App Call Resources**: Are all resources (accounts/apps/assets) within `MAX_APP_TOTAL_REFS` and correctly staged onto the inner transaction?
- [ ] **Inner Transaction Budget**: Is the two-pass `ensureBudget`-then-stage pattern followed everywhere an inner-txn group is built? (See `CLAUDE.md` gotcha.)
- [ ] **Minimum Balance**: Does creating new boxes (new groups, members, proposals, approvals, payload chunks) require the safe/caller to pre-fund MBR, and is that documented/enforced?
- [ ] **Opt-In Requirements**: Is ASA opt-in handled as a normal governed asset-transfer proposal (0-amount self-transfer), and is that documented?
- [ ] **Approval Program Size**: Does the compiled program stay under 8192 bytes? (Mandatory check — see Audit Preparation §3.)
- [ ] **Global State Limits**: Global state usage is small and fixed (name/creator/bootstrapped/nextGroupId/nextProposalId/groupCount/paused/version) — confirm no unbounded growth was introduced.

#### Governance / Economic Model Security

- [ ] **Privilege Escalation**: Can a signer with only `PRIV_POLICY` perform a `PRIV_GROUP`-gated change, or vice versa?
- [ ] **Threshold Manipulation**: Can a group's threshold be set to `0` or above its member count, making it un-executable or trivially executable?
- [ ] **Spending Limit Bypass**: Can daily/monthly limits be bypassed via multi-chunk payloads, multiple concurrent proposals, or asset-id switching?
- [ ] **Member Removal Lockout**: Can the last member of a group be removed, or can members be removed below the group's own threshold?
- [ ] **Pause Bypass**: Does `paused` correctly block both proposal creation and execution, with no code path that checks it inconsistently?

#### Integration Security

- [ ] **Version Detection**: Does the frontend/client always detect the deployed contract's ABI version before calling it (per `CLAUDE.md`: "never assume `'latest'`")?
- [ ] **Cross-App Calls**: Are app calls staged by the safe validated against `allowedActions` and resource limits before being trusted?
- [ ] **X402 Integration** (if the safe is used as an X402 payment source): are constrained spending policies sufficient to bound agent-initiated payments?

---

## Vulnerability Severity Classification

### Critical

- Direct loss or permanent lock of custodied funds (ALGO/ASAs)
- Unauthorized execution of a proposal without meeting its threshold
- Complete bypass of signer-group access control or admin-privilege checks
- Permanent governance lockout (no group can ever administer the safe again)

### High

- Conditional loss of funds under specific but reachable states
- Spending-limit bypass allowing unbounded transfers
- Partial bypass of access controls (e.g. one action type escapes its `allowedActions` gate)
- Double-execution or replay of a proposal

### Medium

- Loss possible only under unlikely/adversarial admin sequences
- Denial-of-service on proposal creation/execution (e.g. exhausting a resource limit maliciously)
- Documentation mismatches that could lead an integrator to misuse the contract

### Low

- Code quality issues, unnecessary opcode/budget cost
- Minor UX/client-library issues in `src/*.ts`
- Non-critical documentation gaps

### Informational

- Code style suggestions
- Optimization opportunities (program-size margin, budget usage)
- Best practice recommendations

---

## Testing Scenario Development

For each identified gap in test coverage, document:

```markdown
### Missing Test: [Scenario Name]

**Description**: [What the test should verify]

**Risk if Untested**: [Potential vulnerabilities or bugs]

**Test Steps**:

1. [Setup step]
2. [Action step]
3. [Verification step]

**Expected Behavior**: [What should happen]

**Edge Cases to Include**:

- [Edge case 1]
- [Edge case 2]

**Priority**: [Critical/High/Medium/Low]
```

---

## Documentation Requirements

For each identified documentation gap:

```markdown
### Documentation Gap: [Area/Feature]

**Missing Information**: [What's not documented]

**User Impact**: [How this affects users]

**Recommended Documentation**:

- [Point 1]
- [Point 2]

**Location**: [Where to add this documentation]

**Priority**: [Critical/High/Medium/Low]
```

---

## Report Structure

Follow the audit template structure exactly:

1. **Audit Metadata** - Complete all fields
2. **Executive Summary** - High-level findings
3. **Scope and Methodology** - What was reviewed and how
4. **Findings** - Organized by severity
5. **Missing Test Scenarios** - Test gaps identified
6. **Documentation Gaps** - Documentation issues
7. **Security Best Practices** - Compliance assessment
8. **Risk Assessment** - Overall risk evaluation
9. **Recommendations** - Prioritized action items
10. **Testing Recommendations** - Additional test scenarios
11. **Compliance and Standards** - Standards adherence
12. **Appendix** - Supporting information

The Risk Assessment section (§8) MUST reference `audits/RISK-REGISTRY.md` rather than re-deriving a standalone risk model from scratch — see "Risk Registry Maintenance" below for the required update process.

---

## Risk Registry Maintenance

`audits/RISK-REGISTRY.md` is a **living document**, distinct from any single audit report: audit reports are point-in-time snapshots of a specific commit, while the registry persists and accumulates across audits, tracking how each risk's status and likelihood evolve as the contract, its usage, and the surrounding threat landscape change. Every audit MUST update it as part of completing the audit — an audit that adds findings to a report but leaves the registry untouched is incomplete.

### What belongs in the registry (broader than a single audit's findings)

The registry is not simply "this audit's findings re-labeled." It should cover the full risk surface a professional custody-contract risk assessment would include:

- **Code-level risks tied to a specific finding** in the current or a past audit report (cross-reference the finding ID and file/line).
- **Structural/design risks** that are not bugs but inherent properties worth tracking (e.g. fixed-window vs. sliding-window rate limiting, irreversible actions like rekey, non-upgradability tradeoffs).
- **Operational/human risks** that no code change can fully close (key compromise, insider threat, threshold misconfiguration, coercion) — these belong in the registry precisely because they persist regardless of code quality, and a registry that omits them understates real-world risk.
- **Platform/ecosystem risks** (Algorand consensus parameter drift, compiler/toolchain miscompilation, dependency vulnerabilities, cryptographic assumptions including long-horizon ones like post-quantum signatures).
- **Integration/upgrade risks** spanning the frontend, client libraries, and migration tooling, even where those are out of a given audit's direct code-review scope — the registry should still carry a risk entry for them (marked accordingly) since they affect the system's overall security posture.

### Required fields per risk entry

Every entry needs: a stable ID (`R-NN`, never reused after retirement — retire by marking `Closed`/`Superseded`, don't delete and don't renumber), Category, Severity if realized, **5-Year Probability** (see below), Residual Risk, Status, and — where applicable — a cross-reference to the audit finding ID that substantiates it.

### Estimating the 5-Year Probability

This is the field requiring the most judgment. For each risk, estimate the probability it manifests as a **realized incident** (not "is theoretically possible") against a representative deployed, funded instance, over a 5-year forward-looking window, given mitigations in place at the time of the estimate. Calibrate using:

1. **Does a concrete, currently-open code finding substantiate this risk?** An open High/Critical finding should push probability meaningfully higher than a purely theoretical/structural risk with no known exploitable path.
2. **Historical base rates for the risk class**, drawn from the broader smart-contract/multisig/custody industry (e.g. key compromise and threshold misconfiguration are the dominant real-world loss categories across the industry, independent of any single contract's code quality — score operational/human risks accordingly rather than assuming code correctness caps them near zero).
3. **How much the risk depends on factors outside the contract's control.** Operational and human-factor risks (phishing, coercion, regulatory change) should generally score *higher* probability than pure code-logic risks in a mature, well-tested contract, precisely because a code fix cannot fully close them.
4. **Whether the risk is protocol-enforced** (e.g. AVM-level reentrancy prevention) — these should score very low probability with status `N/A (protocol-enforced)`, since the mitigation doesn't depend on this contract's code at all.
5. **Write down the reasoning**, not just the number — every entry's probability estimate must include a short justification paragraph explaining the calibration (see the existing entries in `RISK-REGISTRY.md` for the expected depth). A bare percentage with no reasoning is not acceptable; a future auditor (human or AI) must be able to judge whether the number still holds.

Do not treat these percentages as precise measurements — they are professional judgment calls for prioritization, explicitly labeled as such. Avoid false precision (prefer round numbers like 5%, 10%, 15%, 20% over spuriously specific ones like 7.3%) except at the low end, where `<1%` is an appropriate and meaningful distinction from `2-5%`.

### Update procedure for every audit

1. **Read the existing registry first** (do not recreate it from scratch on top of a prior audit unless explicitly asked to produce a from-scratch registry, e.g. for a first-ever audit or an intentional reset).
2. **Re-score every entry whose status is `Open` or `Partially Mitigated`** against the current commit — has anything changed that should move the probability or status? If a prior finding was fixed, update its status to `Mitigated` and lower its probability, keeping the entry (with its history) rather than deleting it.
3. **Add new entries** for any newly-identified finding from the current audit, and for any newly-relevant structural/operational/platform risk not previously captured.
4. **Update the "Last updated" / "Reviewed against commit" header fields** at the top of the registry.
5. **Append a row to the Change Log** at the bottom summarizing what changed and citing the audit report that drove the change.
6. **Cross-check severity classifications stay consistent** with the Vulnerability Severity Classification scale used in audit reports (Critical/High/Medium/Low) — the registry and audit reports must use the same severity vocabulary.

---

## Analysis Techniques

### Static Analysis

1. **Code Flow Analysis**: trace every path from a public method to a state mutation; map which asserts gate which mutation
2. **Data Flow Analysis**: track a `SafeTxn` payload from ARC4 bytes on the wire -> box storage -> `decodeArc4` -> validation -> staging -> inner-txn submission; verify no step trusts data that hasn't been validated by an earlier step
3. **Pattern Matching**: compare against known multisig/smart-account vulnerabilities (Gnosis Safe historical bugs, threshold-check off-by-ones, delegatecall-equivalent risks — N/A on AVM but check inner-app-call trust boundaries instead)

### State Machine Verification

Since there is no AMM math to verify, treat the **proposal lifecycle** as the thing to formally reason about:

1. **Enumerate all state transitions**: every place `proposal.status` is read or written
2. **Check invariants**:
   - `approvalsCount` never exceeds `threshold` needlessly, and `status` flips to `READY` exactly when `approvalsCount >= threshold`
   - `status === EXECUTED` is a terminal state reachable only from `READY`
   - `status === CANCELLED` is terminal, reachable only from `ACTIVE`/`READY`
   - No method can mutate a proposal's `groupId`, `payloadType`, or `proposer` after creation
3. **Cross-check against the group's *current* state at execution time**, not its state at proposal time, wherever the contract re-reads `this.groups(...)` inside `_executeProposalInternal`

### Attack Modeling

Consider these attack scenarios:

1. **Governance Attacks**:

   - A minority signer group escalating its own privileges via a crafted `AdminChange`
   - Front-running an approval to change group policy before a pending proposal executes
   - Draining a group below its threshold to permanently block execution (griefing)

2. **Technical Attacks**:

   - Double-execution via re-entrant or malformed proposal state
   - Box-key collision between different `(proposalId, payloadIndex)` pairs
   - Budget exhaustion forcing a partially-staged inner-txn group to fail mid-execution (and whether that's atomic/safe)
   - Malformed ARC4 `data` bytes that don't match the declared `txType` discriminator

3. **Social/Operational Attacks**:

   - Admin key/device compromise within a signer group
   - Phishing via a client that misrepresents a proposal's decoded payload before signing

---

## Best Practices for AI Auditors

### 1. Be Thorough

- Review the entire `contract.algo.ts` file — it is the entire on-chain trust boundary
- Don't skip "obvious" getters — a read-only getter that leaks unbudgeted box reads is still a finding
- Check `src/*.ts` for ABI-shape drift against the contract

### 2. Be Systematic

- Follow the checklist
- Document everything with `contract.algo.ts:<line>` references
- Use consistent terminology (this document's: proposal, signer group, admin change, payload chunk)

### 3. Be Specific

- Cite exact code locations
- Provide reproducible examples (ideally as a sketch of an e2e test using the existing `contract.e2e.spec.ts` helpers)
- Explain custody/governance impact clearly

### 4. Be Objective

- Base findings on evidence from the actual compiled contract and passing/failing tests
- Distinguish between confirmed and potential issues
- Acknowledge limitations (e.g. "LocalNet unavailable, e2e suite not run")

### 5. Be Constructive

- Provide solutions, not just problems
- Prioritize findings appropriately
- Respect the AVM constraints already documented in `CLAUDE.md` (8192-byte program limit, static inner-txn array fields, `ensureBudget` sequencing) — a "fix" that ignores these constraints isn't actionable

### 6. Context Awareness

- This is a **custody** contract, not a DeFi AMM — the highest-value findings are access-control and state-machine bugs, not pricing/math bugs
- Understand the versioned-client architecture: a bug fix in `contract.algo.ts` must bump `CONTRACT_VERSION` and regenerate exactly one new `clients/<hash>/` folder per commit (per `CLAUDE.md`) — flag any change that doesn't follow this

---

## Code Review Deep Dive Areas

### Proposal Lifecycle

**File**: `smart_contracts/algo_safe/contract.algo.ts`

Key functions to review:

- `proposeTransactionGroup()` / `appendTransactionGroupPayload()`
- `approveProposal()` / `executeProposal()` / `cancelProposal()`
- `_executeProposalInternal()` / `_newProposal()` / `_recordApproval()`

Questions to ask:

- Can a proposal be executed with fewer approvals than its threshold?
- Can a proposal execute after its own group has been disabled or had its privileges/policy changed since proposal time?
- Can `numPayloads` ever under- or over-count the chunks actually stored?
- Can the auto-approval of the proposer be exploited (e.g. proposer isn't actually re-verified as a current member)?

### Typed Payload Execution

Key functions:

- `_executeTransactionGroup()`, `_stagePayment()`/`_stageAsset()`/`_stageAppCall()`/`_stageKeyReg()`/`_stageAssetConfig()`
- `_validatePayment()`/`_validateAsset()`/`_validateApp()`/`_validateAssetConfig()`
- `_accountSpend()`

Questions to ask:

- Can a transaction type be staged that wasn't validated in pass 1 (validate) before pass 2 (stage) runs?
- Can `_accountSpend`'s daily/monthly counters be bypassed by ordering, asset-id switching, or period-boundary timing?
- Does asset-config create vs. reconfigure ever set `ConfigAsset` incorrectly?
- Are app-call resource/argument limits enforced with the exact same constants as Algorand consensus (`MAX_APP_ARGS`, etc.), and can they drift out of sync with a future protocol change?

### Admin Change Application

Key functions in `contract.algo.ts`:

- `proposeAdminChange()`, `_assertPrivilegeForChange()`, `_validateAdminChange()`, `_applyAdminChange()`
- `_adminCreateGroup()`, `_adminAddMember()`, `_adminRemoveMember()`

Questions to ask:

- Can a `PRIV_POLICY`-only member perform a `PRIV_GROUP`-gated change?
- Can a group be created or modified into an unreachable state (threshold > memberCount, threshold == 0)?
- Can removing a member ever drop `memberCount` below `threshold` (governance lockout)?
- Is privilege re-checked against the group's *current* state at execution time, closing the window between proposal and execution?

---

## Common Pitfalls to Check

### Algorand-Specific

1. **Box Reference Missing**: verify all six BoxMaps (`groups`, `members`, `proposals`, `approvals`, `transactionGroups`, `adminPayloads`) have correct box references supplied by callers/clients
2. **App Reference Missing**: verify foreign-app/asset/account arrays staged onto inner app calls are within `MAX_APP_TOTAL_REFS`
3. **Asset Opt-In**: confirm the safe can opt into a new ASA only via a governed 0-amount self-transfer proposal, and that this is the documented path
4. **Inner Transaction Budget**: count total inner transactions per execution against the 256-per-group protocol limit, especially for max-size 6-chunk × 16-txn payloads
5. **Minimum Balance**: verify box-creating operations (new group/member/proposal/approval/payload chunk) have adequate MBR funding, and that failure to fund produces a clear failure rather than partial state

### PuyaTs-Specific (see `CLAUDE.md` "Contract authoring gotchas" for the full list — verify these are still respected)

1. `ensureBudget()` never called while an `op.ITxnCreate` group is open
2. Native array `.length` wrapped in `Uint64(...)` where required by a `uint64`-typed comparison
3. `Bytes(x, { length: N })` only ever used with a literal `N`, never a runtime value
4. Heterogeneous payload types stay behind the tagged-envelope (`{ txType, data }`) pattern rather than a growing union struct
5. `byte[]`/`byte[][]` decode normalization (`Uint8Array.from`) applied everywhere algosdk returns plain `number[]`
6. Asset-config create path never sets `ConfigAsset` to `0`
7. No app create/update path exists (both are intentionally unsupported — verify this hasn't silently regressed)

### General Smart-Account / Governance

1. **Threshold Manipulation**: verify no path sets threshold to 0 or above member count
2. **Privilege Timing**: verify privilege/policy is checked at execution time, not just proposal time
3. **Front-Running**: identify whether a competing approval or admin change can race a pending proposal to change its effective authorization

---

## Output Quality Standards

Your audit report should:

1. ✅ **Be Complete**: Cover all items in the template
2. ✅ **Be Accurate**: All findings should be verifiable against `contract.algo.ts` and the fresh test run
3. ✅ **Be Clear**: Technical details explained for all audiences
4. ✅ **Be Actionable**: Recommendations should be specific and respect AVM/PuyaTs constraints
5. ✅ **Be Professional**: Use formal, technical language
6. ✅ **Be Structured**: Follow the template exactly
7. ✅ **Be Referenced**: Include file paths and line numbers
8. ✅ **Be Prioritized**: Severity levels should be consistent

---

## Final Verification

Before submitting the audit:

- [ ] All template sections completed
- [ ] AI model version clearly documented
- [ ] Commit hash verified and included
- [ ] Contract bytecode hashes included (`pnpm run compute-bytecode-hashes`)
- [ ] `CONTRACT_VERSION` checked against whether `contract.algo.ts` changed since the last audit
- [ ] Full test suite (`pnpm build && pnpm test`) executed fresh and its result reported (or inability to run explicitly documented)
- [ ] Approval-program size checked against the 8192-byte limit and reported
- [ ] All findings have severity classifications
- [ ] Each finding has a clear recommendation
- [ ] Test gaps are documented
- [ ] Documentation issues are noted
- [ ] Risk assessment is complete
- [ ] Recommendations are prioritized
- [ ] No placeholder text remains
- [ ] Report is well-formatted and readable
- [ ] Executive summary accurately reflects findings
- [ ] `audits/RISK-REGISTRY.md` has been read, re-scored where warranted, and updated with any new risks from this audit (see "Risk Registry Maintenance" above) — its header and Change Log reflect this audit's commit and date

---

## Example Finding Format

```markdown
### [H-01] Group Privilege Not Re-Checked Between Proposal and Execution

**Severity**: High
**Status**: Open
**Component**: AlgoSafe (contract.algo.ts)
**File**: smart_contracts/algo_safe/contract.algo.ts:552-574

**Description**:
`_executeProposalInternal` re-checks `group.active` and, for admin-change
proposals, re-checks `_assertPrivilegeForChange` against the *current* group
state. However, [specific scenario — e.g. a transaction-group proposal's
`allowedActions` bitmask is captured at proposal time via the `groupIn`
snapshot passed into `_executeTransactionGroup` and is never re-read from the
current on-chain group state before execution].

**Impact**:
A group whose `allowedActions` were revoked (e.g. via `ADM_SET_POLICY`) after
a transaction-group proposal was created, but before it was executed, could
still have that proposal executed under the old (now-revoked) permissions.

**Proof of Concept**:
\`\`\`typescript
// 1. Group G has ACT_PAY allowed; member proposes a payment proposal P.
// 2. Before P reaches threshold/executes, an admin change revokes ACT_PAY from G.
// 3. P still executes successfully, moving funds via a now-disallowed action.
\`\`\`

**Recommendation**:

1. Re-read the group's current `allowedActions` inside `_executeTransactionGroup`
   rather than trusting the `groupIn` snapshot passed in from `_executeProposalInternal`.
2. Add an e2e test that revokes a policy after proposal creation and asserts
   execution then fails.

**References**:

- CLAUDE.md — "Contract architecture" section on signer-group bitmasks
```

---

## Continuous Improvement

After completing the audit:

1. **Self-Review**: Re-read the report as if you're the recipient
2. **Completeness Check**: Ensure no sections are missing
3. **Consistency Check**: Verify terminology is consistent (proposal/signer group/admin change/payload chunk)
4. **Actionability Check**: Can developers act on your recommendations without violating documented AVM/PuyaTs constraints?
5. **Clarity Check**: Would a non-expert understand the critical findings?

---

## Resources

### Algorand Documentation

- [Algorand Developer Portal](https://developer.algorand.org/)
- [Algorand TypeScript (PuyaTs) Documentation](https://algorandfoundation.github.io/puya-ts/)
- [Algorand Smart Contract Guidelines](https://developer.algorand.org/docs/get-details/dapps/smart-contracts/guidelines/)

### Security Resources

- [Smart Contract Security Best Practices](https://consensys.github.io/smart-contract-best-practices/)
- [Algorand Security Best Practices](https://developer.algorand.org/docs/get-details/dapps/smart-contracts/security/)

### Smart-Account / Multisig Resources

- [Safe (Gnosis Safe) documentation](https://docs.safe.global/) — closest EVM analogue for the threshold-governance model
- Historical Safe/multisig post-mortems — useful pattern library for threshold and privilege-escalation bugs

---

**Version**: 3.0
**Last Updated**: 2026-07-07
**Maintained by**: algo-safe project
