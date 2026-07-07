# Algo Safe — Risk Registry

**Purpose**: a living catalogue of security, operational, and economic risks relevant to the `AlgoSafe` smart account contract and its supporting library/deployment. Unlike an audit report (a point-in-time snapshot), this registry persists across audits: entries are added, re-scored, and closed as the contract, its usage, and the surrounding threat landscape evolve.

**Maintained by**: every audit performed per `AI-AUDIT-INSTRUCTIONS.md` MUST review and update this file — see that document's "Risk Registry Maintenance" section for the required process.

**Last updated**: 2026-07-07 (same-day remediation follow-up — see the "Remediation Update" section of [`2026-07-07-audit-report-ai-claude-sonnet-5.md`](./2026-07-07-audit-report-ai-claude-sonnet-5.md))
**Reviewed against commit**: `5e4e27ace2cba026ea6eb7209e31006257234669` (initial audit); fixes for R-01, R-06, R-07, R-08, R-15 applied to the working tree same-day, contract version `BIATEC-ALGO-SAFE-v1.7.0`, approval hash `8f0e3a34c916ca3dee51f5ce496651261114c3e7da762bb6296435b3ebb028dd` — **not yet committed**

---

## How to read this registry

Each risk has:

- **Category** — one of: `Access Control`, `State Machine`, `Governance`, `Economic`, `Key Management`, `Protocol/AVM`, `Cryptographic`, `Integration/Client`, `Upgrade/Migration`, `Availability`, `Supply Chain`, `Regulatory`.
- **Severity if realized** — impact using the same Critical/High/Medium/Low scale as audit findings, assuming the risk materializes with no further mitigation.
- **5-Year Probability** — this auditor's estimate of the probability the risk actually manifests as a realized incident (not merely "is theoretically possible") against a **deployed, funded** Algo Safe instance, over a 5-year horizon (2026–2031), given the mitigations in place **today**. These are professional judgment calls calibrated against: (a) whether a concrete code-level finding currently exists for this risk (raises probability), (b) historical base rates for this risk class across the broader smart-contract/multisig industry, (c) how much the risk depends on factors outside the contract's control (operational/human factors score higher, since code fixes can't fully close them). They are estimates for portfolio-level prioritization, not guarantees.
- **Residual Risk** — qualitative combination of severity and probability, used for sorting/prioritization: `Critical`, `High`, `Medium`, `Low`.
- **Status** — `Open`, `Partially Mitigated`, `Mitigated`, `Accepted`, `Monitoring`, `N/A (protocol-enforced)`.
- **Related Finding** — cross-reference to a specific audit finding ID where one exists.

Probabilities are independent per-risk estimates (not mutually exclusive outcomes), so they are not expected to sum to 100%.

---

## Summary Table

| ID | Risk | Category | Severity | 5-Yr Probability | Residual Risk | Status |
|---|---|---|---|---|---|---|
| R-01 | Multi-chunk proposal bait-and-switch (approval not bound to content) | Access Control | High | **<1%** | Low | **Mitigated** ([H-01]) |
| R-02 | Signer private key compromise (phishing, malware, device theft) | Key Management | Critical | **35%** | Critical | Partially Mitigated |
| R-03 | Malicious or coerced insider signer proposes harmful transaction | Governance | High | **10%** | High | Partially Mitigated |
| R-04 | Threshold misconfiguration by safe owners (e.g. 1-of-N default left unchanged) | Governance | High | **20%** | High | Accepted (operational) |
| R-05 | Governance lockout (no group retains admin privilege) | Governance | Critical | **2%** | Medium | Mitigated |
| R-06 | `activePrivGroupCount` desync via bootstrap-path mixing | State Machine | Medium | **<1%** | Low | **Mitigated** ([M-03]) |
| R-07 | No functional emergency-pause capability | Availability/Governance | Medium | **3%** | Low | **Mitigated** ([M-01]) |
| R-08 | Aggregate multi-chunk transaction count exceeds AVM group-size limit | Availability | Medium | **<1%** | Low | **Mitigated** ([M-02]) |
| R-09 | Spending-limit bypass via close-out sweep miscounting | Economic | High | **<1%** | Low | Mitigated |
| R-10 | Spending-limit bypass via multi-proposal/period-boundary timing | Economic | Medium | **5%** | Medium | Partially Mitigated |
| R-11 | Double-execution / replay of an executed proposal | State Machine | Critical | **<1%** | Low | Mitigated |
| R-12 | Box-key collision (proposal/payload/member/approval) | State Machine | Critical | **<1%** | Low | Mitigated |
| R-13 | Cooldown-arithmetic overflow permanently freezing a group | State Machine | High | **<1%** | Low | Mitigated |
| R-14 | Reentrancy via self-referencing or chained app calls | Access Control | Critical | **<1%** | Low | N/A (protocol-enforced) |
| R-15 | Self-appId call reaches execution without a contract-level guard | Access Control | Low | **<1%** | Low | **Mitigated** ([L-01]) |
| R-16 | Malformed/adversarial ARC4 payload bytes mis-decoded | Access Control | Medium | **4%** | Low | Monitoring |
| R-17 | Rekey action misused to hand safe control to an unintended address | Governance | Critical | **6%** | High | Partially Mitigated |
| R-18 | `ACT_APPL` grant enables unreviewed arbitrary external contract call | Governance | High | **10%** | Medium | Monitoring ([I-02]) |
| R-19 | Migration to a compromised or buggy successor contract version | Upgrade/Migration | Critical | **5%** | High | Partially Mitigated |
| R-20 | Incomplete migration leaves dual-custody exposure window | Upgrade/Migration | Medium | **8%** | Medium | Monitoring |
| R-21 | ABI/constant drift between contract and off-chain library | Integration/Client | High | **4%** | Medium | Mitigated (verify per release) |
| R-22 | Frontend misrepresents proposal content before signing | Integration/Client | High | **15%** | High | Open (frontend, out of contract scope) |
| R-23 | Client fails to detect deployed contract version, uses wrong ABI | Integration/Client | Medium | **5%** | Low | Mitigated |
| R-24 | Box MBR under-funding causes inconsistent partial state | Availability | Medium | **6%** | Low | Mitigated (atomic failure) |
| R-25 | Approval-program size exceeds 8,192-byte ceiling in a future change | Availability | Medium | **20%** | Medium | Monitoring ([I-01]) |
| R-26 | Algorand consensus parameter changes invalidate hard-coded resource limits | Protocol/AVM | Medium | **15%** | Medium | Monitoring |
| R-27 | PuyaTs/compiler miscompilation producing incorrect bytecode | Supply Chain | Critical | **2%** | Medium | Accepted (industry-wide) |
| R-28 | `algosdk`/`algokit-utils` dependency vulnerability | Supply Chain | Medium | **10%** | Low | Monitoring |
| R-29 | ed25519 signature forgery via classical cryptanalysis | Cryptographic | Critical | **<1%** | Low | Accepted (industry-wide) |
| R-30 | Cryptographically-relevant quantum computer breaks ed25519 signer keys | Cryptographic | Critical | **<1%** (within 5 yrs) | Low | Monitoring (architecture anticipates it) |
| R-31 | Algorand block-timestamp manipulation games spend-limit period rollover | Economic | Low | **3%** | Low | Accepted (protocol-bounded) |
| R-32 | Regulatory/custody classification risk for operators of Algo Safe instances | Regulatory | Medium | **20%** | Medium | Monitoring |

---

## Detailed Entries

### R-01 — Multi-Chunk Proposal Bait-and-Switch

**Category**: Access Control · **Severity**: High · **5-Yr Probability**: <1% (was 12%) · **Residual Risk**: Low (was High) · **Status**: Mitigated (2026-07-07)
**Related Finding**: [H-01](./2026-07-07-audit-report-ai-claude-sonnet-5.md#h-01-multi-chunk-proposal-content-can-be-bait-and-switched-between-an-approvers-decision-and-its-on-chain-confirmation)

`approveProposal` authorizes a proposal ID, not a commitment to specific payload content; a proposer can rewrite not-yet-independently-approved chunks (slots 2–6) in the window before a second signer's approval confirms.

**Why 12% originally**: requires both a multi-chunk proposal (a minority of real-world usage, since most transaction groups fit in one ~2 KB chunk) and an adversarial/compromised proposer. Multisig insider/compromise incidents are a real and recurring category industry-wide, but the multi-chunk precondition meaningfully narrows applicability. Probability would rise significantly (toward R-03/R-04 levels) if multi-chunk proposals become a common pattern for a given deployment (e.g. safes that regularly batch large payrolls).

**Why <1% now**: `approveProposal` requires a caller-supplied `expectedPayloadVersion` that must match the proposal's live `payloadVersion` (bumped on every `appendTransactionGroupPayload` write); a payload swap between review and confirmation now causes the stale approval to revert rather than silently apply. Residual probability reflects only the chance of an undiscovered gap in this fix, not the original attack path, which is closed. Regression-tested (`contract.e2e.spec.ts`, "H-01 regression").

**Mitigation path**: fixed same-day in `contract.algo.ts` v1.7.0 (working tree, not yet committed). No further action pending commit/deploy.

---

### R-02 — Signer Private Key Compromise

**Category**: Key Management · **Severity**: Critical · **5-Yr Probability**: 35% · **Residual Risk**: Critical · **Status**: Partially Mitigated

Phishing, malware, malicious browser extensions, or device theft compromising an individual signer's key remains the single most common root cause of real-world multisig fund loss (consistently the dominant category in industry incident post-mortems for threshold-custody systems generally, independent of the specific contract's code quality).

**Why 35%**: this is a human/operational risk that no amount of contract-code correctness eliminates; over a 5-year horizon across any reasonably active set of signers, at least one phishing/malware attempt succeeding against at least one signer somewhere is a high-probability event industry-wide. The contract's M-of-N design is the primary mitigation (a single compromised key cannot act alone above a threshold >1) — probability of an *individual key* being compromised is high; probability of that compromise resulting in *fund loss* is much lower and scales inversely with the group's threshold and N.

**Mitigation path**: this is inherently a defense-in-depth, not a code, problem. Recommend: strongly discourage 1-of-1/1-of-N groups for anything beyond bootstrap (see R-04); document hardware-wallet/multisig-signer best practices; consider `accountType` 2 (multisig) and future 4/5 (agent/quantum) signer types as tools operators can use to raise the bar per-signer.

---

### R-03 — Malicious or Coerced Insider Signer

**Category**: Governance · **Severity**: High · **5-Yr Probability**: 10% · **Residual Risk**: High · **Status**: Partially Mitigated

A legitimate signer, acting maliciously (insider threat) or under coercion, proposes and/or approves a transaction group that harms the safe (e.g. self-dealing, coerced transfer).

**Why 10%**: bounded by the M-of-N threshold requiring collusion or coercion of multiple independent signers for anything above a 1-of-N group; single-signer insider risk is fully contained by threshold design for properly-configured groups. Probability reflects the residual case of either low-threshold groups (see R-04) or successful multi-signer collusion/coercion, both less common than single-key compromise (R-02) but not negligible over 5 years for higher-value safes that become attractive coercion targets.

**Mitigation path**: operational (background checks, threshold selection, geographic/organizational diversity of signers), not a contract fix.

---

### R-04 — Threshold Misconfiguration

**Category**: Governance · **Severity**: High · **5-Yr Probability**: 20% · **Residual Risk**: High · **Status**: Accepted (operational)

Safe owners leave the genesis 1-of-1 `bootstrap()` group as the sole admin group indefinitely, or otherwise configure a threshold that doesn't match their actual trust/coordination requirements (too low, defeating the purpose of a smart account; too high, risking self-lockout via signer unavailability).

**Why 20%**: this is a common, well-documented failure mode across the entire multisig/smart-account industry (Gnosis Safe post-mortems repeatedly cite un-hardened default configurations). The contract correctly makes `bootstrap()`'s output a 1-of-1 group by design (a deliberate, documented genesis step, not a defect) — the risk is entirely in operators failing to follow through with hardening it via governance before meaningful funds arrive.

**Mitigation path**: product/UX-level nudges (the frontend should strongly prompt/require threshold hardening before large deposits); this is explicitly out of the contract's own trust boundary to enforce, since the contract cannot know a safe's intended value-at-risk.

---

### R-05 — Governance Lockout

**Category**: Governance · **Severity**: Critical · **5-Yr Probability**: 2% · **Residual Risk**: Medium · **Status**: Mitigated

No group retains `PRIV_GROUP`, permanently freezing the non-upgradable contract's governance.

**Why 2%**: `activePrivGroupCount` and `_wouldRemoveLastGroupAdmin` are verified sound in the governed path (audit §7). Non-zero probability remains only via the R-06 bootstrap-mixing edge case (self-inflicted, creator-only, pre-funding) or an as-yet-undiscovered logic gap; both are low-likelihood given the depth of existing test coverage (`M-01 lockout guard` tests) and this audit's independent confirmation.

**Mitigation path**: fix R-06; otherwise continue regression-testing this invariant on every future admin-change addition.

---

### R-06 — `activePrivGroupCount` Desync via Bootstrap-Path Mixing

**Category**: State Machine · **Severity**: Medium · **5-Yr Probability**: <1% (was 8%) · **Residual Risk**: Low (was Medium) · **Status**: Mitigated (2026-07-07)
**Related Finding**: [M-03](./2026-07-07-audit-report-ai-claude-sonnet-5.md#m-03-mixing-bootstrap-and-bootstrapgroup-desyncs-activeprivgroupcount)

**Why 8% originally**: requires a creator to call both bootstrap paths on the same safe — an atypical but plausible mistake, especially as the migration tooling (`deployClonedSafe`, which exclusively uses `bootstrapGroup`) becomes a common way to create new safes; a creator manually mixing in a `bootstrap()` call afterward for any reason (e.g. scripting error, copy-pasted deployment code) is the realistic trigger.

**Why <1% now**: `bootstrap()` now asserts `groupCount === 0` before proceeding, making the previously-silent mixing an explicit, immediate on-chain rejection instead of a state-consistency bug. Regression-tested. Also directly improves R-05's confidence (governance lockout), since this was R-05's only identified non-zero-probability path.

**Mitigation path**: fixed same-day in `contract.algo.ts` v1.7.0 (working tree, not yet committed).

---

### R-07 — Emergency-Pause Capability (Now Implemented; Residual Scope/Governance Risk)

**Category**: Availability/Governance · **Severity**: Medium · **5-Yr Probability**: 3% (was 15%) · **Residual Risk**: Low (was Medium) · **Status**: Mitigated (2026-07-07)
**Related Finding**: [M-01](./2026-07-07-audit-report-ai-claude-sonnet-5.md#m-01-paused-has-no-admin-change-path-to-ever-be-set-and-existing-checks-are-inconsistent)

**Why 15% originally**: this scored the probability that, over 5 years across the population of deployed Algo Safe instances, at least one operator experiences a scenario (suspected key compromise, urgent need to halt activity while re-establishing governance) where the *absence* of a working pause capability results in measurably worse outcomes than if one had existed. Given that key-compromise events (R-02) are themselves fairly probable at 35%, and a working pause would materially help in a meaningful fraction of those, 15% reflected that overlap while accounting for the fact that most compromise scenarios are also addressable via a governed admin change (slower, but functional) even without a dedicated pause.

**Why 3% now**: `ADM_SET_PAUSED` is implemented and correctly scoped — it gates fund-moving transaction-group proposal/append/execute paths only, while governance (including unpausing) is deliberately never blocked by pause, closing the self-lockout risk a naive implementation would have introduced. Residual 3% reflects genuinely operational risk that remains regardless of code correctness: an admin-privileged group must still notice a compromise and coordinate a threshold-gated pause proposal in time to matter (pause is not instant/unilateral — it still requires the same M-of-N governance as any other admin change), and operators may simply not configure or rehearse the pause procedure before they need it.

**Mitigation path**: fixed same-day in `contract.algo.ts` v1.7.0 (working tree, not yet committed). Residual risk is operational (documentation/runbook, incident-response rehearsal), not further code.

---

### R-08 — Aggregate Multi-Chunk Transaction Count Exceeds AVM Limit

**Category**: Availability · **Severity**: Medium · **5-Yr Probability**: <1% (was 10%) · **Residual Risk**: Low (was Medium) · **Status**: Mitigated (2026-07-07)
**Related Finding**: [M-02](./2026-07-07-audit-report-ai-claude-sonnet-5.md#m-02-no-aggregate-transaction-count-bound-across-multi-chunk-payloads)

**Why 10% originally**: requires a proposer to construct a proposal near/at the boundary of the six-chunk design, which is more likely to occur organically (an operator legitimately trying to batch a large set of transactions and not realizing the aggregate cap) than adversarially. No fund-loss path; pure availability/griefing impact bounded the severity to Medium.

**Why <1% now**: `appendTransactionGroupPayload` tracks a running `totalTxns` (correctly handling slot overwrites without double-counting) and rejects any append that would push the aggregate past `MAX_GROUP_TXNS`, failing fast with a clear error at append time instead of a generic AVM panic at execution time. Regression-tested, including the boundary (exactly 16 succeeds) and overwrite-correctness cases.

**Mitigation path**: fixed same-day in `contract.algo.ts` v1.7.0 (working tree, not yet committed).

---

### R-09 — Spending-Limit Bypass via Close-Out Sweep Miscounting

**Category**: Economic · **Severity**: High · **5-Yr Probability**: <1% · **Residual Risk**: Low · **Status**: Mitigated

A `hasClose`/`hasAssetClose` payment/transfer sweeping the full account balance while only the declared `amount` counts against the daily/monthly limit.

**Why <1%**: independently re-verified in this audit — `_executeTransactionGroup` (contract.algo.ts:915-934) correctly reads live `op.balance`/`op.AssetHolding.assetBalance` for close-outs rather than the declared amount. Residual probability reflects only the general possibility of an undiscovered edge case in this logic, not a known gap.

---

### R-10 — Spending-Limit Bypass via Multi-Proposal/Period-Boundary Timing

**Category**: Economic · **Severity**: Medium · **5-Yr Probability**: 5% · **Residual Risk**: Medium · **Status**: Partially Mitigated

Splitting transfers across multiple proposals timed around a daily/monthly period rollover to exceed the "intended" period limit (e.g. one transfer just before midnight-equivalent rollover, another just after).

**Why 5%**: this is a real, structurally-inherent property of any fixed-window (rather than sliding-window) rate limiter, not a contract bug — the contract's daily/monthly limits are deliberately simple fixed-window counters, and two transfers straddling a rollover boundary can legitimately each use the full per-period allowance within a short elapsed time. This is a known, generally-accepted tradeoff for fixed-window limiters (vs. the complexity of a sliding window) and is unlikely to be considered a "bypass" by most operators, but should be understood as a limitation, not a guarantee of strict period-boundary enforcement.

**Mitigation path**: document the fixed-window (not sliding-window) nature of the limit explicitly; consider a sliding-window design only if a specific deployment's threat model requires it.

---

### R-11 — Double-Execution / Replay

**Category**: State Machine · **Severity**: Critical · **5-Yr Probability**: <1% · **Residual Risk**: Low · **Status**: Mitigated

`STATUS_EXECUTED` verified as a one-way terminal state reachable only from `STATUS_READY`, checked before any mutation in `_executeProposalInternal`. No path found to re-enter execution on an already-executed or cancelled proposal.

---

### R-12 — Box-Key Collision

**Category**: State Machine · **Severity**: Critical · **5-Yr Probability**: <1% · **Residual Risk**: Low · **Status**: Mitigated

`TXG_KEY_MULT=7` (> the max payload index of 6) verified collision-free by construction for `transactionGroups`; composite keys for `members`/`approvals` use fixed-width `{id, Account}` tuples with no variable-length components that could cause ambiguous concatenation.

---

### R-13 — Cooldown-Arithmetic Overflow

**Category**: State Machine · **Severity**: High · **5-Yr Probability**: <1% · **Residual Risk**: Low · **Status**: Mitigated

`lastExecutionRound + cooldownRounds` permanently panicking a group's execution path. `MAX_COOLDOWN_ROUNDS` (10,000,000) bounds `cooldownRounds` far below any value that could combine with a realistic round number to overflow `uint64`, verified at both `ADM_CREATE_GROUP`/`ADM_SET_POLICY` and `bootstrapGroup`.

---

### R-14 — Reentrancy

**Category**: Access Control · **Severity**: Critical · **5-Yr Probability**: <1% · **Residual Risk**: Low · **Status**: N/A (protocol-enforced)

The AVM ledger evaluator disallows an application calling itself, directly or indirectly, independent of any contract-level code. This is a platform guarantee, not an Algo Safe-specific mitigation — probability reflects only the (very low) risk of a future Algorand protocol change relaxing this guarantee without the ecosystem noticing.

---

### R-15 — Self-AppId Call Without Contract-Level Guard

**Category**: Access Control · **Severity**: Low · **5-Yr Probability**: <1% (was 3%) · **Residual Risk**: Low · **Status**: Mitigated (2026-07-07)
**Related Finding**: [L-01](./2026-07-07-audit-report-ai-claude-sonnet-5.md#l-01-no-defensive-check-against-a-transaction-group-proposal-targeting-the-safes-own-appid)

Purely a diagnosability gap given R-14's protocol-level backstop; probability reflected the chance this ever produced a confusing support incident (proposer confused by a generic AVM panic) rather than any security impact.

**Remediation**: `_validateApp` now asserts `tx.appId !== Global.currentApplicationId.id` explicitly, giving a clear contract-level error (`'self-call not allowed'`) instead of relying solely on the AVM's protocol-level backstop. Regression-tested.

**Mitigation path**: fixed same-day in `contract.algo.ts` v1.7.0 (working tree, not yet committed).

---

### R-16 — Malformed/Adversarial ARC4 Payload Decoding

**Category**: Access Control · **Severity**: Medium · **5-Yr Probability**: 4% · **Residual Risk**: Low · **Status**: Monitoring

Stored `SafeTxn.data` bytes that don't match their declared `txType` discriminator's expected ARC4 shape.

**Why 4%**: `decodeArc4<T>` is a strongly-typed ARC4 decode operation; malformed bytes not matching the target struct's shape are expected to fail the decode (revert) rather than silently misinterpret adjacent fields, consistent with ARC4's self-describing tuple encoding. Not independently fuzz-tested in this audit (see recommendation in §10 of the audit report), hence "Monitoring" rather than "Mitigated."

---

### R-17 — Rekey Misuse

**Category**: Governance · **Severity**: Critical · **5-Yr Probability**: 6% · **Residual Risk**: High · **Status**: Partially Mitigated

`ACT_REKEY` combined with `PRIV_GROUP` lets a governed group hand full control of the safe (or a rekeyed external sender) to an arbitrary address. Validated as correctly gated (both bits required, checked at execution time against live state) — this is a correctness pass, not a design flaw.

**Why 6%**: this is an inherently high-consequence action by design (irreversible transfer of control), so even with correct access-control gating, probability reflects the chance that a governed group with legitimate `ACT_REKEY`+`PRIV_GROUP` privileges is itself compromised/colludes (a subset of R-02/R-03), or that a rekey proposal's destination address is mistyped/misconfigured with no on-chain way to detect the error before execution (a fat-fingered address is indistinguishable on-chain from an intended one).

**Mitigation path**: UI/UX safeguards (address confirmation, allowlisting known-good rekey destinations, perhaps requiring a higher/dedicated threshold specifically for rekey proposals) — largely outside the contract's own trust boundary, though the contract already correctly requires the strictest privilege combination (`ACT_REKEY` + `PRIV_GROUP`) for this action class.

---

### R-18 — `ACT_APPL` Broad Trust Grant

**Category**: Governance · **Severity**: High · **5-Yr Probability**: 10% · **Residual Risk**: Medium · **Status**: Monitoring
**Related Finding**: [I-02](./2026-07-07-audit-report-ai-claude-sonnet-5.md#i-02-act_appl-is-a-broad-trust-grant)

A group with `ACT_APPL` can trigger a call into any application ID with the safe's authority for that call, subject only to resource-reference limits, not an allowlist.

**Why 10%**: reflects the probability that an operator grants `ACT_APPL` to a group without appreciating its breadth (treating it as "just app calls" rather than "arbitrary contract interaction"), later approving a proposal that calls into a malicious or buggy external contract. This is a governance/documentation risk, not a contract defect — the contract's job (correctly done) is to gate the *bit*, not to vet every possible callee.

**Mitigation path**: documentation/UX callout per the audit recommendation.

---

### R-19 — Migration to a Compromised or Buggy Successor Contract

**Category**: Upgrade/Migration · **Severity**: Critical · **5-Yr Probability**: 5% · **Residual Risk**: High · **Status**: Partially Mitigated

`deployClonedSafe`/`buildMigrationRekeyPayload` (`src/migration.ts`) rekey a safe's controlled addresses to a newly deployed contract instance. If that new instance is deployed from a compromised build pipeline, a tampered npm package, or simply a contract version with an undiscovered critical bug, migration transfers full custody to it.

**Why 5%**: bounded by the fact that migration is itself a governed, threshold-gated action (requires the same M-of-N consensus as any other admin/rekey change) — an attacker would need to either compromise the build/release pipeline (a supply-chain event, see R-27/R-28) or socially engineer a legitimate governance quorum into approving migration to an illegitimate target.

**Mitigation path**: verify bytecode hashes (per this audit's own methodology) before any governance vote to migrate; consider requiring a higher threshold specifically for migration/rekey-class proposals; reproducible-build verification for the `algo-safe` npm package.

---

### R-20 — Incomplete Migration Leaves Dual-Custody Exposure

**Category**: Upgrade/Migration · **Severity**: Medium · **5-Yr Probability**: 8% · **Residual Risk**: Medium · **Status**: Monitoring

Between `finalizeBootstrap` on the new safe and the old safe's rekey proposal actually executing, the old safe remains the sole custodian of all registered addresses (confirmed correct in this audit — the new safe controls nothing until the rekey lands). The risk is procedural: an operator believing migration is "done" after deploying/seeding the new safe, while the old safe (and its original signer set/threshold) remains the actual point of control until the rekey proposal executes.

**Why 8%**: a plausible operational sequencing mistake (declaring migration complete prematurely) rather than a code defect; the underlying mechanics are sound and atomic once the rekey proposal does execute.

**Mitigation path**: `fetchSafeVersionStatus`/UI should clearly distinguish "new safe deployed and seeded" from "migration complete" (rekey executed) states.

---

### R-21 — ABI/Constant Drift Between Contract and Off-Chain Library

**Category**: Integration/Client · **Severity**: High · **5-Yr Probability**: 4% · **Residual Risk**: Medium · **Status**: Mitigated (as of this audit; requires re-verification per release)

**Why 4%**: verified byte-for-byte consistent as of this audit (§3 Executive Summary; all 6 codecs, all bitmask constants). Non-zero probability reflects the risk that a *future* contract change updates a struct's field order without a corresponding, equally careful update to `safe-tx.ts`'s codec strings — a manual, error-prone step with no compiler enforcement linking the two (PuyaTs types and algosdk ABI type strings are declared independently). This is exactly the kind of drift `CLAUDE.md` already calls out as a standing risk.

**Mitigation path**: every future audit (and ideally CI) should re-verify this checklist item explicitly; consider a codegen step that derives the off-chain codec strings directly from the ARC56 spec rather than hand-maintaining them.

---

### R-22 — Frontend Misrepresents Proposal Content Before Signing

**Category**: Integration/Client · **Severity**: High · **5-Yr Probability**: 15% · **Residual Risk**: High · **Status**: Open (frontend out of this contract audit's scope)

A compromised, buggy, or malicious frontend (or wallet-connect intermediary) could decode and display a proposal's content inaccurately, causing a signer to approve something other than what they believe they're approving — conceptually related to, but distinct from, R-01 (which is a contract-level gap; this is a client-trust gap that exists for *any* correctly-behaving contract).

**Why 15%**: frontend/supply-chain compromise (malicious dependency, compromised CDN/build, DNS hijack of a hosted UI) is a well-documented, recurring attack class against Web3 UIs industry-wide, independent of Algo Safe's own code quality. `CLAUDE.md` already flags known ABI-decoder migration debt in `algoSafeProposals.ts`, which — if left unresolved — compounds this risk by potentially displaying stale/incorrect previews even without any malicious intent.

**Mitigation path**: out of this contract-focused audit's scope; recommend a dedicated frontend security review, subresource integrity for hosted assets, and encouraging signers to independently verify proposal content via a second, trusted channel (e.g. directly querying `getTransactionGroup` via a CLI) for high-value approvals.

---

### R-23 — Client Fails to Detect Deployed Contract Version

**Category**: Integration/Client · **Severity**: Medium · **5-Yr Probability**: 5% · **Residual Risk**: Low · **Status**: Mitigated

`getAlgoSafeContractVersion` hashes the live approval program and falls back to `'latest'` only for genuinely unrecognized hashes (verified in this audit). Residual probability reflects integrators bypassing `buildAlgoSafeAppClient`/`getClient` and hand-rolling their own client construction without version detection (a misuse risk, not a library defect).

---

### R-24 — Box MBR Under-Funding Causes Inconsistent Partial State

**Category**: Availability · **Severity**: Medium · **5-Yr Probability**: 6% · **Residual Risk**: Low · **Status**: Mitigated (atomic failure)

An under-funded safe attempting an operation that needs a new box. Algorand's box-creation semantics fail the whole transaction if MBR isn't available (atomic, no partial commit), so this manifests as a clear failure rather than corrupted state — a funding/UX issue, not a security defect. Not independently exercised by a dedicated e2e test in the current suite (see §10 testing recommendation).

---

### R-25 — Approval-Program Size Exceeds Ceiling in a Future Change

**Category**: Availability · **Severity**: Medium · **5-Yr Probability**: 20% · **Residual Risk**: Medium · **Status**: Monitoring
**Related Finding**: [I-01](./2026-07-07-audit-report-ai-claude-sonnet-5.md#i-01-shrinking-program-size-margin)

**Why 20%**: current margin (8.5%) has been consumed steadily by feature growth across the contract's version history (v1.0 through v1.6.0); extrapolating that trend, a 5-year horizon of continued feature development makes hitting the ceiling a realistic, not merely hypothetical, planning concern — this is scored as a near-term engineering-management risk rather than a security vulnerability.

**Mitigation path**: track per-release; budget for opcode-level size optimization passes proactively rather than reactively.

---

### R-26 — Algorand Consensus Parameter Changes Invalidate Hard-Coded Limits

**Category**: Protocol/AVM · **Severity**: Medium · **5-Yr Probability**: 15% · **Residual Risk**: Medium · **Status**: Monitoring

`MAX_APP_ARGS`, `MAX_APP_TOTAL_ARG_LEN`, `MAX_APP_ACCOUNTS`, `MAX_APP_FOREIGN_APPS/ASSETS`, `MAX_APP_TOTAL_REFS`, and the implicit 16-transaction group-size assumption (M-02/R-08) all hard-code current Algorand consensus parameters. A future consensus upgrade raising (or, less likely, lowering) any of these would not break the contract's safety, but could make it needlessly conservative (raised limits: leaving capability on the table) or, in the lowering direction, could in principle make an already-approved-but-unexecuted proposal's assumptions stale.

**Why 15%**: Algorand has changed these exact parameters before over its history (application resource limits have been raised multiple times since inception), making at least one more such change over 5 years quite plausible; severity is Medium because the contract is non-upgradable, so adapting to a favorable change (e.g. supporting bigger app calls) would require a full migration (R-19/R-20 apply), not because of any safety break.

**Mitigation path**: periodic review of these constants against current consensus parameters, documented as a recurring audit checklist item (already present in `AI-AUDIT-INSTRUCTIONS.md`).

---

### R-27 — PuyaTs/Compiler Miscompilation

**Category**: Supply Chain · **Severity**: Critical · **5-Yr Probability**: 2% · **Residual Risk**: Medium · **Status**: Accepted (industry-wide)

A bug in the PuyaTs compiler or the underlying `puya` toolchain producing AVM bytecode that doesn't faithfully implement the TypeScript source.

**Why 2%**: this is the same class of risk every smart-contract ecosystem accepts with respect to its compiler (Solidity, Move, Cairo, etc.); PuyaTs is actively maintained and has a growing track record, but is younger and less battle-tested than more mature toolchains, which is reflected in the probability being non-trivial rather than negligible.

**Mitigation path**: this audit's bytecode-hash verification step and TEAL-level program-size check are partial mitigations (catching unexpected size/structure changes); full mitigation would require independent TEAL-source review, which is out of scope for a source-level audit but worth considering for a dedicated high-value deployment.

---

### R-28 — `algosdk`/`algokit-utils` Dependency Vulnerability

**Category**: Supply Chain · **Severity**: Medium · **5-Yr Probability**: 10% · **Residual Risk**: Low · **Status**: Monitoring

**Why 10%**: reflects general npm-ecosystem dependency-vulnerability base rates over a 5-year window for actively-used packages; severity capped at Medium (not Critical) because these libraries are client/tooling-side, not part of the on-chain trust boundary — a vulnerability here would most plausibly affect transaction construction/signing tooling rather than the deployed contract's own guarantees.

**Mitigation path**: standard dependency-scanning/update hygiene (Dependabot or equivalent), not specific to Algo Safe.

---

### R-29 — Classical Cryptanalysis of ed25519

**Category**: Cryptographic · **Severity**: Critical · **5-Yr Probability**: <1% · **Residual Risk**: Low · **Status**: Accepted (industry-wide)

No known classical attack meaningfully threatens ed25519 within any realistic planning horizon; this is an industry-wide baseline risk common to virtually all blockchain systems, not specific to Algo Safe.

---

### R-30 — Cryptographically-Relevant Quantum Computer Breaks ed25519 Signer Keys

**Category**: Cryptographic · **Severity**: Critical · **5-Yr Probability**: <1% (within the 5-year window specifically) · **Residual Risk**: Low (near-term) · **Status**: Monitoring (architecture anticipates it)

**Why <1% over 5 years specifically**: mainstream expert consensus on cryptographically-relevant quantum computers (capable of breaking ed25519/ECC at practical scale) generally places this well beyond a 5-year horizon (estimates commonly range 10–20+ years out, with significant uncertainty). Worth registering explicitly because `Member.accountType` (`contract.algo.ts:135`) already reserves a `5 = quantum` account type, showing the design has deliberately anticipated the need for post-quantum signer support — a notable, forward-looking architectural choice worth crediting, even though the underlying quantum-signature verification path is not yet implemented in the reviewed contract.

**Mitigation path**: monitor NIST post-quantum signature standardization and Algorand ecosystem support; the `accountType` extensibility point already exists to add a quantum-resistant signer path when needed, without requiring a full redesign.

---

### R-31 — Block-Timestamp Manipulation Games Spend-Limit Rollover

**Category**: Economic · **Severity**: Low · **5-Yr Probability**: 3% · **Residual Risk**: Low · **Status**: Accepted (protocol-bounded)

Algorand block proposers have only bounded influence over `Global.latestTimestamp` (consensus-enforced monotonicity and limited drift tolerance), constraining how much a proposer could shift a period-rollover boundary in their favor. Combined with the fact that gaming this only ever grants the *proposer's own* group extra headroom within limits that group's own privileged admins already control the size of (see R-10's note on `ADM_SET_POLICY` granting arbitrary limit changes directly), this is a low-severity, low-probability, largely theoretical concern.

---

### R-32 — Regulatory/Custody Classification Risk

**Category**: Regulatory · **Severity**: Medium · **5-Yr Probability**: 20% · **Residual Risk**: Medium · **Status**: Monitoring

Operators deploying Algo Safe instances to custody third-party funds (as opposed to purely self-custody) may fall under evolving money-transmission/custody regulatory regimes in various jurisdictions, independent of the contract's technical soundness.

**Why 20%**: reflects the continued global trend of regulatory frameworks for digital-asset custody maturing and expanding over a 5-year horizon; this is a near-certainty at the ecosystem level (some jurisdiction, somewhere, will refine custody rules that touch smart-account operators) even though it is not something the contract's code can address.

**Mitigation path**: this is explicitly a legal/operational concern for parties *deploying and operating* Algo Safe instances, not a code-security recommendation; noted here for completeness of a professional risk register, not as an audit action item.

---

## Change Log

| Date | Change | Audit Reference |
|---|---|---|
| 2026-07-07 | Initial registry created (32 risks) alongside a fresh, independent audit pass | `2026-07-07-audit-report-ai-claude-sonnet-5.md` |
| 2026-07-07 | Same-day remediation: R-01, R-06, R-07, R-08, R-15 re-scored from Open to Mitigated after H-01/M-01/M-02/M-03/L-01 were fixed in `contract.algo.ts` v1.7.0 (working tree, not yet committed) with regression tests added for each. R-05's confidence note updated (its only identified non-zero path, R-06, is now closed). | `2026-07-07-audit-report-ai-claude-sonnet-5.md` "Remediation Update" section |
