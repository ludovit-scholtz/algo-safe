# Algo Safe — Risk Registry

**Purpose**: a living catalogue of security, operational, and economic risks relevant to the `AlgoSafe` smart account contract and its supporting library/deployment. Unlike an audit report (a point-in-time snapshot), this registry persists across audits: entries are added, re-scored, and closed as the contract, its usage, and the surrounding threat landscape evolve.

**Maintained by**: every audit performed per `AI-AUDIT-INSTRUCTIONS.md` MUST review and update this file — see that document's "Risk Registry Maintenance" section for the required process.

**Last updated**: 2026-07-13 (Claude Fable 5 audit of v3.0.0 + same-session v3.1.0 remediation — see [`2026-07-12-audit-report-ai-claude-fable-5.md`](./2026-07-12-audit-report-ai-claude-fable-5.md))
**Reviewed against commit**: `d2baaaba9374a5b26feb56441f6728be0bab1a7c` (audited v3.0.0). Remediations landed in the working tree as contract **v3.1.0** (approval hash `0ec5f00067169dae3414cffd9f2e04d8e2a91884d7fd0eb903c31aa409da6ead`, validator unchanged at `0dd692344f80e7d5770f47bcde26c31eaaf24d45b5d177dfcbc7241742e188b1`), not yet committed.

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
| R-25 | Approval-program size exceeds 8,192-byte ceiling in a future change | Availability | Medium | **15%** | Low | **Mitigated** — v3.0.0 size-reduction pass (6,968/8,192 bytes, 15% free) + CI size gate at 7,800 bytes ([C-01]) |
| R-26 | Algorand consensus parameter changes invalidate hard-coded resource limits | Protocol/AVM | Medium | **15%** | Medium | Monitoring |
| R-27 | PuyaTs/compiler miscompilation producing incorrect bytecode | Supply Chain | Critical | **2%** | Medium | Accepted (industry-wide) |
| R-28 | `algosdk`/`algokit-utils` dependency vulnerability | Supply Chain | Medium | **10%** | Low | Monitoring |
| R-29 | ed25519 signature forgery via classical cryptanalysis | Cryptographic | Critical | **<1%** | Low | Accepted (industry-wide) |
| R-30 | Cryptographically-relevant quantum computer breaks ed25519 signer keys | Cryptographic | Critical | **<1%** (within 5 yrs) | Low | Monitoring (architecture anticipates it) |
| R-31 | Algorand block-timestamp manipulation games spend-limit period rollover | Economic | Low | **3%** | Low | Accepted (protocol-bounded) |
| R-32 | Regulatory/custody classification risk for operators of Algo Safe instances | Regulatory | Medium | **20%** | Medium | Monitoring |
| R-33 | Project documentation (`CLAUDE.md`/`PRODUCT-DESCRIPTION.md`) lags behind shipped breaking ABI changes | Integration/Client | Medium | **12%** | Medium | **Partially Mitigated** — v3.0.0/v3.1.0 doc gap closed; structural recurrence risk remains pending a CI doc-sync check ([M-02 Fable-5](./2026-07-12-audit-report-ai-claude-fable-5.md)) |
| R-34 | Off-chain keyreg mapping misclassifies a standard "go offline" registration as online | Integration/Client | Low | **<1%** | Low | **Mitigated** ([L-02 v2](./2026-07-07-audit-report-ai-claude-sonnet-5-v2.md#l-02-this-report-off-chain-algosdktxntosafetxn-misclassifies-a-standard-go-offline-key-registration-as-online)) |
| R-35 | Custodian group dissolution orphans member boxes (permanent MBR loss) | Availability | Medium | **<1%** | Low | **Mitigated** — dissolution deletes the last member box; extra members must be removed first ([M-01]) |
| R-36 | Proposal boxes for dissolved custodian groups cannot be pruned (permanent MBR loss) | Availability | Medium | **<1%** | Low | **Mitigated** — `pruneProposal` membership check waived once the group box is gone ([M-02]) |
| R-37 | `ADM_CHANGE_THRESHOLD` allows threshold=0 (no lower bound validation) | Governance | Low | **<1%** | Low | **Mitigated** — lower-bound asserts added in both governed paths ([L-01]) |
| R-38 | Custodian guard containment excludes `ACT_APPL`/`ACT_ACFG` value movement | Governance/Economic | High | **<1%** | Low | **Mitigated** — v3.1.0 restricts custodian actions to pay/axfer ([M-01 Fable-5](./2026-07-12-audit-report-ai-claude-fable-5.md)) |
| R-39 | Validator library pinning/deployment surface (wrong or unregistered validator at safe creation) | Upgrade/Migration | Medium | **2%** | Low | Partially Mitigated (hash pin on-chain + pin-rejection e2e test added in v3.1.0; `VALIDATOR_DEPLOYMENTS` registry still unpopulated) |
| R-40 | Residual zero-address input gaps in governed admin paths (`_createGroup`, `ADM_ADD_REKEYED_ADDR`) | State Machine | Low | **<1%** | Low | **Mitigated** — v3.1.0 zero-address asserts + migration-builder throw ([L-01/L-02 Fable-5](./2026-07-12-audit-report-ai-claude-fable-5.md)) |

---

## Detailed Entries

### R-01 — Multi-Chunk Proposal Bait-and-Switch

**Category**: Access Control · **Severity**: High · **5-Yr Probability**: <1% (was 12%) · **Residual Risk**: Low (was High) · **Status**: Mitigated (2026-07-07)
**Related Finding**: [H-01](./2026-07-07-audit-report-ai-claude-sonnet-5.md#h-01-multi-chunk-proposal-content-can-be-bait-and-switched-between-an-approvers-decision-and-its-on-chain-confirmation)

`approveProposal` authorizes a proposal ID, not a commitment to specific payload content; a proposer can rewrite not-yet-independently-approved chunks (slots 2–6) in the window before a second signer's approval confirms.

**Why 12% originally**: requires both a multi-chunk proposal (a minority of real-world usage, since most transaction groups fit in one ~2 KB chunk) and an adversarial/compromised proposer. Multisig insider/compromise incidents are a real and recurring category industry-wide, but the multi-chunk precondition meaningfully narrows applicability. Probability would rise significantly (toward R-03/R-04 levels) if multi-chunk proposals become a common pattern for a given deployment (e.g. safes that regularly batch large payrolls).

**Why <1% now**: `approveProposal` requires a caller-supplied `expectedPayloadVersion` that must match the proposal's live `payloadVersion` (bumped on every `appendTransactionGroupPayload` write); a payload swap between review and confirmation now causes the stale approval to revert rather than silently apply. Residual probability reflects only the chance of an undiscovered gap in this fix, not the original attack path, which is closed. Regression-tested (`contract.e2e.spec.ts`, "H-01 regression").

**Mitigation path**: fixed in `contract.algo.ts` v1.7.0, committed to `main` at `4cdbbe5` and independently re-verified against the live code and its regression test by the [2026-07-07-v2 audit](./2026-07-07-audit-report-ai-claude-sonnet-5-v2.md#h-01-prior-report--multi-chunk-proposal-bait-and-switch--confirmed-fixed). No further action pending.

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

**Mitigation path**: fixed in `contract.algo.ts` v1.7.0, committed to `main` at `4cdbbe5` and independently re-verified by the [2026-07-07-v2 audit](./2026-07-07-audit-report-ai-claude-sonnet-5-v2.md#m-03-prior-report--bootstrap-path-mixing-desyncs-activeprivgroupcount--confirmed-fixed).

---

### R-07 — Emergency-Pause Capability (Now Implemented; Residual Scope/Governance Risk)

**Category**: Availability/Governance · **Severity**: Medium · **5-Yr Probability**: 3% (was 15%) · **Residual Risk**: Low (was Medium) · **Status**: Mitigated (2026-07-07)
**Related Finding**: [M-01](./2026-07-07-audit-report-ai-claude-sonnet-5.md#m-01-paused-has-no-admin-change-path-to-ever-be-set-and-existing-checks-are-inconsistent)

**Why 15% originally**: this scored the probability that, over 5 years across the population of deployed Algo Safe instances, at least one operator experiences a scenario (suspected key compromise, urgent need to halt activity while re-establishing governance) where the *absence* of a working pause capability results in measurably worse outcomes than if one had existed. Given that key-compromise events (R-02) are themselves fairly probable at 35%, and a working pause would materially help in a meaningful fraction of those, 15% reflected that overlap while accounting for the fact that most compromise scenarios are also addressable via a governed admin change (slower, but functional) even without a dedicated pause.

**Why 3% now**: `ADM_SET_PAUSED` is implemented and correctly scoped — it gates fund-moving transaction-group proposal/append/execute paths only, while governance (including unpausing) is deliberately never blocked by pause, closing the self-lockout risk a naive implementation would have introduced. Residual 3% reflects genuinely operational risk that remains regardless of code correctness: an admin-privileged group must still notice a compromise and coordinate a threshold-gated pause proposal in time to matter (pause is not instant/unilateral — it still requires the same M-of-N governance as any other admin change), and operators may simply not configure or rehearse the pause procedure before they need it.

**Mitigation path**: fixed in `contract.algo.ts` v1.7.0, committed to `main` at `4cdbbe5` and independently re-verified by the [2026-07-07-v2 audit](./2026-07-07-audit-report-ai-claude-sonnet-5-v2.md#m-01-prior-report--paused-unreachable--inconsistent--confirmed-fixed). Residual risk is operational (documentation/runbook, incident-response rehearsal), not further code.

---

### R-08 — Aggregate Multi-Chunk Transaction Count Exceeds AVM Limit

**Category**: Availability · **Severity**: Medium · **5-Yr Probability**: <1% (was 10%) · **Residual Risk**: Low (was Medium) · **Status**: Mitigated (2026-07-07)
**Related Finding**: [M-02](./2026-07-07-audit-report-ai-claude-sonnet-5.md#m-02-no-aggregate-transaction-count-bound-across-multi-chunk-payloads)

**Why 10% originally**: requires a proposer to construct a proposal near/at the boundary of the six-chunk design, which is more likely to occur organically (an operator legitimately trying to batch a large set of transactions and not realizing the aggregate cap) than adversarially. No fund-loss path; pure availability/griefing impact bounded the severity to Medium.

**Why <1% now**: `appendTransactionGroupPayload` tracks a running `totalTxns` (correctly handling slot overwrites without double-counting) and rejects any append that would push the aggregate past `MAX_GROUP_TXNS`, failing fast with a clear error at append time instead of a generic AVM panic at execution time. Regression-tested, including the boundary (exactly 16 succeeds) and overwrite-correctness cases.

**Mitigation path**: fixed in `contract.algo.ts` v1.7.0, committed to `main` at `4cdbbe5` and independently re-verified against its boundary regression test by the [2026-07-07-v2 audit](./2026-07-07-audit-report-ai-claude-sonnet-5-v2.md#m-02-prior-report--no-aggregate-transaction-count-bound--confirmed-fixed).

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

**Mitigation path**: fixed in `contract.algo.ts` v1.7.0, committed to `main` at `4cdbbe5` and independently re-verified by the [2026-07-07-v2 audit](./2026-07-07-audit-report-ai-claude-sonnet-5-v2.md#l-01-prior-report--no-defensive-self-appid-check--confirmed-fixed).

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

**Category**: Availability · **Severity**: Medium · **5-Yr Probability**: **15%** (was 85%) · **Residual Risk**: **Low** (was High) · **Status**: **Mitigated** (2026-07-12 remediation)
**Related Finding**: [C-01](./2026-07-12-audit-report-ai-claude-sonnet-4-6.md#c-01-approval-program-size-at-81878192-bytes--5-byte-margin)

**Why 85%**: The v2.0.0 release consumed essentially all remaining program-size headroom — the approval program is now 8,187/8,192 bytes (5 bytes = 0.06% free). The prior 20% estimate was calibrated against an 8.5% margin and a trend of steady consumption. With the margin now at 0.06%, the probability of hitting the ceiling is not "20% over 5 years" — it is virtually certain the *very next change to `contract.algo.ts`* will require either finding size savings or failing deployment. Re-scored to 85% rather than 100% to allow for the possibility that the team performs a size-reduction pass before any new feature work, keeping the ceiling from being crossed.

**Why "Open — critical blocker"**: this was previously "Monitoring" as an extrapolation-of-trend risk. It is now an active, immediate constraint: no further code can be added to the contract without first finding more than 5 bytes of savings.

**Mitigation (2026-07-12, same-day remediation, v3.0.0)**: a size-reduction pass shipped as contract v3.0.0: all 12 read-only ABI getters removed (replaced by off-chain box/state readers in `src/on-chain.ts`), the two bootstrap paths consolidated into a shared `_seedGroup`, and payload validation for pay/axfer/keyreg/acfg/rekey externalised to the hash-pinned, immutable `AlgoSafeTxnValidator` library contract called via inner app call. The approval program is now **6,968/8,192 bytes (15% free)**. A CI gate (`scripts/check-program-size.ts`, wired into `pnpm build`) fails any build over **7,800 bytes**, so size creep is caught in the PR that introduces it. Residual probability reflects long-horizon feature growth, now bounded by the gate.

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

### R-33 — Project Documentation Lags Behind Shipped Breaking ABI Changes

**Category**: Integration/Client · **Severity**: Medium · **5-Yr Probability**: 10% (was 15%) · **Residual Risk**: Medium · **Status**: Partially Mitigated (2026-07-07)
**Related Finding**: [M-01 (2026-07-07-v2)](./2026-07-07-audit-report-ai-claude-sonnet-5-v2.md#m-01-this-report-claudemd-and-product-descriptionmd-are-stale-relative-to-the-v170-breaking-change)

`CLAUDE.md`'s "Breaking changes seen across versions" section (the document's own designated source of truth for this exact class of change) and `PRODUCT-DESCRIPTION.md`'s sequence/class diagrams were not updated alongside the v1.7.0 change that added a required `expectedPayloadVersion` argument to `approveProposal` and a new `ADM_SET_PAUSED` admin-change type.

**Why 15% originally**: this is a recurring pattern risk, not a one-off — the contract has shipped multiple breaking versions before (v1.0 through v1.7.0) and each requires a disciplined, manual documentation update with no compiler/CI enforcement linking `contract.algo.ts` to the two Markdown documents. The probability reflects the base rate of *at least one* future version bump over a 5-year horizon shipping without a corresponding doc update, given this has now happened at least once (v1.7.0, this finding) despite `CLAUDE.md` explicitly calling out the requirement for itself. Severity is Medium (not High) because the failure mode is a loud ABI-encoding error for integrators, not a silent on-chain security gap — no path to fund loss identified.

**Why 10% / Partially Mitigated now**: the specific v1.7.0 gap was closed same-day (all five M-01 v2 recommendation items implemented: `CLAUDE.md` gained v1.6.0/v1.7.0/v1.8.0 breaking-change bullets; `PRODUCT-DESCRIPTION.md` corrected at every cited location — working tree, not yet committed). The probability drops only modestly because the *structural* risk is unchanged: doc sync is still a manual, unenforced step, so the recurrence risk for future version bumps persists until a mechanical check exists.

**Mitigation path**: remaining action is process-level — add a lightweight CI check (e.g. grep `CLAUDE.md` for the current `CONTRACT_VERSION` string, failing the build if it's absent) so a version bump without a matching doc update is caught mechanically rather than relying on the next audit to catch it. Entry closes to Mitigated when that exists.

**2026-07-12 update (Fable 5 audit) — RECURRED, re-scored 10% → 15%, Status → Open**: the v3.0.0 release (the largest ABI break to date: all 12 read-only getters removed, `createApplication` signature changed, validator architecture introduced) shipped with `CLAUDE.md` fully updated but `PRODUCT-DESCRIPTION.md` untouched — it still documents `getConfig`/`getSignerGroup`/`getProposal`/`getTransactionGroup` (lines 684–687) and instructs signers to read `payloadVersion` "via `getProposal`" (line 711), and contains no mention of the validator contract. This is the second realized instance of exactly this risk (v1.7.0 was the first), confirming the structural nature of the gap: without the mechanical CI check, recurrence tracks every breaking release. See [M-02](./2026-07-12-audit-report-ai-claude-fable-5.md).

---

### R-34 — Off-Chain Keyreg Mapping Misclassifies "Go Offline" as Online

**Category**: Integration/Client · **Severity**: Low · **5-Yr Probability**: <1% (was 3%) · **Residual Risk**: Low · **Status**: Mitigated (2026-07-07)
**Related Finding**: [L-02 (2026-07-07-v2)](./2026-07-07-audit-report-ai-claude-sonnet-5-v2.md#l-02-this-report-off-chain-algosdktxntosafetxn-misclassifies-a-standard-go-offline-key-registration-as-online)

`algosdkTxnToSafeTxn`'s keyreg branch derived the contract's `online` flag solely from `nonParticipation`, not from whether vote/selection/state-proof keys are present — the conventional Algorand "go offline" transaction (keys omitted, `nonParticipation` unset) was misclassified as `online: 1n` with empty keys.

**Why 3% originally**: bounded by two factors — (a) key registration is already a rare transaction type relative to payments/transfers in typical safe usage, and (b) the most likely failure mode is a loud AVM rejection at execution (wrong key size) rather than a silent safety issue, so the realistic cost is wasted proposal-coordination effort, not fund loss or an incorrect online/offline participation state actually reaching consensus. Severity is Low for the same reason.

**Why <1% now**: the mapping now derives `online` from key presence (`voteKey && !nonParticipation`), covering all three cases (standard offline, permanent opt-out, keys-supplied online), each exercised by the new round-trip regression test in `contract.e2e.spec.ts`. Residual probability reflects only the chance of an undiscovered gap in the fix.

**Mitigation path**: fixed same-day in `src/safe-tx.ts` (working tree, not yet committed). No further action pending commit/release.

---

### R-35 — Custodian Group Dissolution Orphans Member Boxes (Permanent MBR Loss)

**Category**: Availability · **Severity**: Medium · **5-Yr Probability**: <1% · **Residual Risk**: Low · **Status**: **Mitigated** (2026-07-12 remediation, v3.0.0)
**Related Finding**: [M-01](./2026-07-12-audit-report-ai-claude-sonnet-4-6.md#m-01-custodian-group-dissolution-orphans-member-boxes-permanent-mbr-loss)

When a custodian group is dissolved via `ADM_DISSOLVE_CUSTODIAN`, `contract.algo.ts` deletes the group box but does not delete the member boxes (`members({groupId: gid, account: addr})`). After dissolution, `_adminRemoveMember` panics because it reads the now-deleted group box. The MBR locked in each member box (~2,500–3,000 µALGO per member) is permanently irrecoverable.

**Why 15%**: Custodian groups are a new feature in v2.0.0 and not yet widely deployed. Probability reflects the likelihood that, over a 5-year horizon, operators create and then dissolve custodian groups at least once (either as part of DeFi protocol lifecycle management or error correction), triggering the MBR loss. The amount per incident is small (bounded by member count), but it is a structural defect in the dissolution path that will affect any operator who uses the feature without workarounds.

**Why Medium (not Low)**: While the per-incident MBR loss is bounded (~5,000–15,000 µALGO for typical 2–5 member custodian groups), it is a permanent, irrecoverable loss with no workaround once dissolution executes. "Permanent and irrecoverable" bumps this above a pure Low severity.

**Mitigation (2026-07-12, v3.0.0)**: `ADM_DISSOLVE_CUSTODIAN` now requires `memberCount === 1` and the dissolve change's `memberAddr` to name that last member; the member box is deleted together with the group box. Extra members are removed beforehand via `ADM_REMOVE_MEMBER` (which already reclaims their boxes), so no box is orphaned by dissolution. Regression-tested in `contract.e2e.spec.ts` (M-01 tests).

---

### R-36 — Proposal Boxes for Dissolved Custodian Groups Cannot Be Pruned (Permanent MBR Loss)

**Category**: Availability · **Severity**: Medium · **5-Yr Probability**: <1% · **Residual Risk**: Low · **Status**: **Mitigated** (2026-07-12 remediation, v3.0.0)
**Related Finding**: [M-02](./2026-07-12-audit-report-ai-claude-sonnet-4-6.md#m-02-proposal-boxes-for-dissolved-custodian-groups-cannot-be-pruned-permanent-mbr-loss)

`pruneProposal` calls `_assertMember(proposal.groupId)`, which first asserts `this.groups(groupId).exists`. After `ADM_DISSOLVE_CUSTODIAN` deletes the group box, this assertion fails for all proposals linked to the dissolved group — including already-cancelled and already-executed proposals past their expiry round. Proposal boxes, payload chunk boxes, and approval boxes for those proposals are permanently irrecoverable.

**Why 15%**: Same base rate as R-35 (same dissolution event triggers both). The MBR loss from proposal boxes is larger than from member boxes: a multi-chunk proposal with 3 payload slots and 3 approvals could lock 20,000–30,000 µALGO permanently. Like R-35, the risk is structural and will affect any custodian group that has had proposals created during its lifetime before dissolution.

**Mitigation (2026-07-12, v3.0.0)**: `pruneProposal` now applies the membership check only while the group box still exists; once the group is dissolved, anyone may prune the terminal, past-expiry proposal (pruning only reclaims MBR to the app account). Regression-tested in `contract.e2e.spec.ts` (M-02 test).

---

### R-37 — `ADM_CHANGE_THRESHOLD` and `_createGroup` Allow Threshold = 0

**Category**: Governance · **Severity**: Low · **5-Yr Probability**: <1% · **Residual Risk**: Low · **Status**: **Mitigated** (2026-07-12 remediation, v3.0.0)
**Related Finding**: [L-01](./2026-07-12-audit-report-ai-claude-sonnet-4-6.md#l-01-adm_change_threshold-and-_creategroup-allow-threshold--0)

`_applyAdminChange` for `ADM_CHANGE_THRESHOLD` and `_createGroup` both allow `change.threshold = 0` (no lower-bound check). Setting threshold=0 is functionally equivalent to threshold=1 in the current implementation (the proposer's auto-approval satisfies `1 >= 0`), but it is semantically incorrect and creates potential confusion for frontends/tooling that display "requires X approvals." `bootstrapGroup` correctly enforces `threshold >= 1`; the inconsistency is in the governed-change paths.

**Why 5%**: requires a legitimate admin to either accidentally type 0 (fat-finger) or deliberately set a zero threshold. Functional impact is equivalent to threshold=1 in current code, so the probability reflects an operator being confused by tooling displaying "0 approvals required" rather than any security bypass. No fund-loss path identified.

**Mitigation (2026-07-12, v3.0.0)**: `ADM_CHANGE_THRESHOLD` now asserts `threshold >= 1`; `_createGroup` asserts `threshold === 1` (a new group has exactly one member). `_adminAddMember` also gained the zero-address guard from the same audit's L-02. Regression-tested in `contract.e2e.spec.ts` (L-01/L-02 tests).

---

### R-38 — Custodian Guard Containment Excludes `ACT_APPL`/`ACT_ACFG` Value Movement

**Category**: Governance/Economic · **Severity if realized**: High · **5-Yr Probability**: 8% · **Residual Risk**: Medium · **Status**: Open
**Related Finding**: [M-01 (Fable 5)](./2026-07-12-audit-report-ai-claude-fable-5.md)

Asset guards deduct only for `TX_PAYMENT`/`TX_ASSET` entries. A custodian group granted `ACT_APPL` can make arbitrary application calls with the safe's authority (e.g. withdrawing the safe's external-protocol deposits to an attacker address), and one granted `ACT_ACFG` can reconfigure assets the safe manages (e.g. clawback role) — value movement no guard bounds. This directly undercuts the documented custodian property ("cannot exceed their per-asset guard allocation even if the underlying protocol is compromised"), which is the feature's whole point, since the threat model explicitly assumes the custodian signer may be compromised.

**Why 8%**: requires (a) an operator granting a custodian action bits beyond pay/axfer — plausible via tooling defaults or misunderstanding of guard scope, given the documentation currently overstates the guarantee — and (b) the custodian protocol actually being compromised (a subset of general smart-contract-risk base rates for DeFi integrations over 5 years). Neither alone realizes the risk; jointly, 8% reflects custodian adoption being new but the misconfiguration being easy and invisible until exploited.

**Mitigation path**: restrict custodian `allowedActions` to `ACT_PAY|ACT_AXFER` at `_createGroup` (custodian branch) and in `ADM_SET_POLICY` when the target is a custodian (~tens of bytes against the current 1,224-byte margin); alternatively, correct the documentation to scope the guard guarantee to transfers only. Code fix preferred.

**Mitigation (2026-07-13, v3.1.0)**: shipped the code fix. A shared `_assertCustodianActions` asserts `allowedActions <= (ACT_PAY | ACT_AXFER)` for custodian groups at all three write paths — `_seedGroup`, `_createGroup` (`ADM_CREATE_CUSTODIAN`), and `ADM_SET_POLICY` on a custodian target. A custodian can no longer hold `ACT_APPL`/`ACT_ACFG`/`ACT_KEYREG`/`ACT_REKEY`, so the guard guarantee is airtight. Regression-tested (`contract.e2e.spec.ts`, "custodian groups cannot be created with, or widened to, actions beyond pay/axfer"). `PRODUCT-DESCRIPTION.md`/`CLAUDE.md` guard-scope note added. Re-scored 8% → <1%, Status → Mitigated.

---

### R-39 — Validator Library Pinning/Deployment Surface

**Category**: Upgrade/Migration · **Severity if realized**: Medium · **5-Yr Probability**: 2% · **Residual Risk**: Low · **Status**: Partially Mitigated

v3.0.0 makes every safe's payload validation depend on an external, per-network `AlgoSafeTxnValidator` deployment chosen at `createApplication` time. The on-chain design is robust: the safe verifies the target app's approval-program sha256 against a compile-time pin, and the pinned bytecode rejects update/delete forever, so a wrong or malicious validator **cannot** be pinned (verified this audit: on-chain assert + off-chain `verifyValidatorApp` + build-time `sync-validator-hash.ts` all agree on `0dd69234…`). Residual risk is operational: `VALIDATOR_DEPLOYMENTS` is still unpopulated for TestNet/MainNet (both entries `0n`), so early non-local deployments must pass hand-verified explicit app IDs; and a compromised build pipeline could alter the pinned hash itself, which folds into R-27 (compiler/supply chain). There is currently no e2e test of the pin-rejection path (see audit I-04).

**Why 2%**: the exploitable path requires subverting the build/release pipeline (R-27 territory) or an integrator bypassing both verification layers; the plain "operator pins the wrong app" mistake fails loudly on-chain.

**Mitigation path**: populate `VALIDATOR_DEPLOYMENTS` after first TestNet/MainNet deployments; add the `createApplication` pin-rejection e2e test; reproducible-build verification per R-19/R-27.

**Update (2026-07-13, v3.1.0)**: the pin-rejection e2e test now exists (`contract.e2e.spec.ts`, "createApplication rejects an app that is not the pinned validator") — it deploys a bare NoOp app and confirms safe creation reverts with `'validator bytecode mismatch'`, plus a nonexistent-app case. `VALIDATOR_DEPLOYMENTS` remains unpopulated (still requires an explicit, hand-verified app ID for non-local deployments), so status stays Partially Mitigated.

---

### R-40 — Residual Zero-Address Input Gaps in Governed Admin Paths

**Category**: State Machine · **Severity if realized**: Low · **5-Yr Probability**: 3% · **Residual Risk**: Low · **Status**: Open
**Related Finding**: [L-01/L-02 (Fable 5)](./2026-07-12-audit-report-ai-claude-fable-5.md)

The 2026-07-12 L-02 remediation added a zero-address guard to `_adminAddMember`, but two sibling paths still accept `Global.zeroAddress`: `_createGroup` (initial member of `ADM_CREATE_GROUP`/`ADM_CREATE_CUSTODIAN` — creates an inert group whose sole member can never sign; recoverable) and `ADM_ADD_REKEYED_ADDR` (a zero registry entry that, when consumed by `buildMigrationRekeyPayload`, becomes a premature self-rekey entry in the migration group, causing a confusing atomic-revert migration failure). Neither has a fund-loss path.

**Why 3%**: `AdminChange` has 15 mostly-unused fields per change type, making a defaulted/zeroed `memberAddr` an easy tooling mistake; impact is bounded to wasted MBR, operator confusion, and a recoverable migration failure.

**Mitigation path**: mirror the existing `'member required'`/`'address required'` asserts in both paths; defensively reject zero addresses in `buildMigrationRekeyPayload`; extend the L-02 regression tests.

**Mitigation (2026-07-13, v3.1.0)**: `_createGroup` now asserts `memberAddr !== zeroAddress`; `ADM_ADD_REKEYED_ADDR` asserts the same (mirroring `bootstrapRekeyedAddress`); `buildMigrationRekeyPayload` throws on a zero-address entry. Regression-tested (`contract.e2e.spec.ts`, "creating a group with the zero address as initial member is rejected", "registering the zero address as a rekeyed address is rejected"). Re-scored 3% → <1%, Status → Mitigated.

---

## Change Log

| Date | Change | Audit Reference |
|---|---|---|
| 2026-07-07 | Initial registry created (32 risks) alongside a fresh, independent audit pass | `2026-07-07-audit-report-ai-claude-sonnet-5.md` |
| 2026-07-07 | Same-day remediation: R-01, R-06, R-07, R-08, R-15 re-scored from Open to Mitigated after H-01/M-01/M-02/M-03/L-01 were fixed in `contract.algo.ts` v1.7.0 (working tree, not yet committed) with regression tests added for each. R-05's confidence note updated (its only identified non-zero path, R-06, is now closed). | `2026-07-07-audit-report-ai-claude-sonnet-5.md` "Remediation Update" section |
| 2026-07-07 | Independent follow-up audit against commit `4cdbbe5` (the fixes above, now committed to `main`). R-01, R-06, R-07, R-08, R-15 mitigation-path notes updated to remove "not yet committed" and cite independent re-verification of each fix against its regression test. Two new risks added: R-33 (`CLAUDE.md`/`PRODUCT-DESCRIPTION.md` stale relative to the v1.7.0 `approveProposal`/`ADM_SET_PAUSED` breaking change) and R-34 (off-chain keyreg `online` mapping misclassifies a standard "go offline" registration). Header "Reviewed against commit" updated to `4cdbbe5`. | `2026-07-07-audit-report-ai-claude-sonnet-5-v2.md` |
| 2026-07-07 | Same-day remediation of the v2 audit's findings: R-34 re-scored Open → Mitigated (keyreg `online` mapping fixed, round-trip regression test added); R-33 re-scored Open → Partially Mitigated at 10% (the specific v1.7.0 doc gap closed in `CLAUDE.md`/`PRODUCT-DESCRIPTION.md`, structural recurrence risk remains pending a CI doc-sync check). L-01 (v2) also fixed: `appendTransactionGroupPayload` gained the expiry check, shipping as `contract.algo.ts` v1.8.0 (approval hash `d66a4b63...7d10`), 65/65 tests passing. All fixes in the working tree, not yet committed. | `2026-07-07-audit-report-ai-claude-sonnet-5-v2.md` "Remediation Update" section |
| 2026-07-12 | Claude Sonnet 4.6 audit of commit `76d86186` (v2.0.0 Custodian Groups). R-25 re-scored from Monitoring/20%/Medium → **Open/85%/High** (program at 5-byte margin, effectively zero headroom). Three new risks added: R-35 (member box MBR after dissolution, Medium), R-36 (proposal box MBR after dissolution, Medium), R-37 (threshold=0 allowed, Low). All prior R-01 through R-34 risks re-verified: no regressions found. R-33 (documentation lag) confirmed Partially Mitigated — v2.0.0 IS documented in CLAUDE.md. 69/69 tests passed. | `2026-07-12-audit-report-ai-claude-sonnet-4-6.md` |
| 2026-07-12 | Same-day remediation of the audit's findings, shipping as contract **v3.0.0** (working tree, not yet committed). C-01/R-25: size-reduction pass (getters removed, bootstrap consolidated, payload validation externalised to the hash-pinned immutable `AlgoSafeTxnValidator` library contract) → approval program 6,968/8,192 bytes; CI size gate added at 7,800 bytes; R-25 re-scored Open/85%/High → **Mitigated/15%/Low**. M-01/R-35: dissolution now deletes the last member box (requires memberCount==1 + named memberAddr) → **Mitigated**. M-02/R-36: `pruneProposal` membership check waived once the group box is gone → **Mitigated**. L-01/R-37: threshold lower bounds added in `ADM_CHANGE_THRESHOLD` and `_createGroup` → **Mitigated**. L-02: zero-address guard added to `_adminAddMember`. I-01: five new custodian e2e scenarios added (ASA guard transfer, ALGO and ASA close-out live-balance accounting, guard update, multi-payment compounding) plus M-01/M-02/L-01/L-02 regressions; 76/76 tests passing. | `2026-07-12-audit-report-ai-claude-sonnet-4-6.md` §7 |
| 2026-07-12 | Claude Fable 5 audit of commit `d2baaab` (v3.0.0, now **committed to `main`**). Independently re-verified at the committed code: R-25 Mitigated (6,968/8,192 bytes, CI gate active), R-35/R-36/R-37 Mitigated (fixes committed, regression tests passing), validator hash pin sound (on-chain assert matches `0dd69234…`), all codecs/constants in sync, full suite passing on LocalNet. R-33 **recurred** with v3.0.0 (`PRODUCT-DESCRIPTION.md` still documents the removed getters, no validator coverage) — re-scored 10% → 15%, Status → Open ([M-02]). Three new risks: R-38 (custodian guards don't bound `ACT_APPL`/`ACT_ACFG`, Medium residual, [M-01]), R-39 (validator pinning/deployment surface, Low residual, Partially Mitigated), R-40 (residual zero-address gaps in `_createGroup`/`ADM_ADD_REKEYED_ADDR`, Low, [L-01]/[L-02]). All other entries re-reviewed: no further changes. | `2026-07-12-audit-report-ai-claude-fable-5.md` |
| 2026-07-13 | Same-session remediation of the Fable-5 findings, shipping as contract **v3.1.0** (working tree, not yet committed; approval hash `0ec5f000…`, 7,043/8,192 bytes, CI size gate green). R-38/M-01 → **Mitigated** (custodian `allowedActions` restricted to pay/axfer via shared `_assertCustodianActions` at all three write paths). R-40/L-01/L-02 → **Mitigated** (zero-address asserts in `_createGroup` and `ADM_ADD_REKEYED_ADDR`; `buildMigrationRekeyPayload` throws on zero). R-33/M-02 → **Partially Mitigated** at 12% (`PRODUCT-DESCRIPTION.md` updated for the v3.0.0 read-surface + validator architecture; `CLAUDE.md` gained the v3.1.0 bullet; structural recurrence risk persists pending a CI doc-sync check). R-39 pin-rejection e2e test added (still Partially Mitigated pending `VALIDATOR_DEPLOYMENTS` population). I-01 bitmask bounds added to `_createGroup`. 89/89 contract tests pass on LocalNet (5 new Fable-5 regression tests). Frontend: asset-guard management, member removal, custodian creation, and a safe-wide pause control added; `getClient` return type narrowed to fix a TS2590 union-complexity break the new client version triggered; 3 new Playwright governance tests. | `2026-07-12-audit-report-ai-claude-fable-5.md` §Remediation |
