# Algo Safe

**Policy-Driven Smart Accounts for the Agent Economy**

Algo Safe is designed for the emerging agent economy, allowing AI agents to operate within predefined on-chain policies on Algorand. These policies define what agents can access, spend, and execute, ensuring actions remain transparent and controlled. By supporting standards such as x402, agents can securely authorize actions, pay for services, and access paid APIs while staying within approved spending and governance rules.

* Policy-Controlled Accounts for AI Agents on Algorand
* Secure AI Agent Wallets and Treasuries on Algorand
* Programmable Accounts for Humans and AI Agents

**A policy-driven smart account for Algorand teams, treasuries, builders, validators, and AI agents.**

Algo Safe is an on-chain safe for Algorand: a wallet-like smart account controlled by configurable signer groups, spending rules, and transparent transaction proposals. It is inspired by the operational safety of products like Safe on EVM chains, but designed around Algorand-native primitives: fast finality, atomic transaction groups, application calls, Algorand Standard Assets, participation key management, and wallet signing through the Algorand wallet ecosystem.

The goal is simple: make it easy for humans and automated agents to prepare, review, co-sign, and execute authorized Algorand actions without forcing users to reason directly about raw transaction bytes.

---

## Why Algorand Users Need This

Algorand already supports powerful transaction composition, but the user experience for shared custody is still too manual for many real teams. Treasury operators, DAOs, startups, validators, payment agents, and protocol maintainers need a frontend that turns low-level Algorand concepts into safe workflows.

Common needs:

- **Shared custody without operational chaos**: Teams need M-of-N approval, clear roles, and a reliable way to rotate members without moving funds to a new account each time.
- **Wallet compatibility**: Users should connect with familiar Algorand wallets through `@txnlab/use-wallet`, including Pera, Defly, Exodus, Daffi, LocalNet/KMD, and WalletConnect-capable providers where supported.
- **Atomic transaction clarity**: Algorand transaction groups are all-or-nothing. Users need to see the exact ordered payload and inner transaction group preview before signing, including payments, ASA transfers, application calls, key registration, asset configuration, and rekey transactions.
- **Application-call-first UX**: dApps often need the safe to authorize a single high-level action that expands into a complete atomic group. The UI should let a user prepare one safe execution request, then review the resulting group before collecting signed approval app calls.
- **ASA-aware treasury management**: Teams hold ALGO and many ASAs. The safe must show asset balances, opt-in requirements, decimals, metadata, and receiver readiness.
- **Validator and governance operations**: Algorand accounts may need key registration (`keyreg`) and governance-related actions. These should be approvable through the same policy flow as payments.
- **Agentic payments with limits**: AI agents and automation services need constrained budgets. Humans should be able to delegate low-risk spending while keeping high-risk actions behind stricter signer groups.
- **Failure-resistant approval**: Signers may use different wallets, devices, and networks. The frontend must recover from disconnects, stale rounds, rejected approval app calls, indexer lag, and partially collected approvals.

---

## Product Vision

Algo Safe should become the default custody and coordination layer for serious Algorand accounts.

It should feel like a professional treasury console, not a developer demo. A signer should be able to connect a wallet, understand what is pending, inspect exactly what will happen on-chain, sign only what they intend to approve, and leave. An admin should be able to create signer groups, add or remove members, change thresholds, and enforce policy without hand-crafting transactions.

Longer term, Algo Safe can also support post-quantum signer schemes and agent-controlled accounts, giving Algorand users a path toward future-proof custody and automated payments without giving up on-chain enforcement.

---

## Core Concepts

### Safe Account

A safe is an Algorand smart account governed by an application. The safe owns or controls assets and executes approved actions only when policy requirements are satisfied.

Each safe has:

- A name and description
- A network (`localnet`, `testnet`, or `mainnet`)
- An application ID after deployment
- One or more signer groups
- Policy rules for thresholds, spending limits, and administration
- A transaction history and proposal queue

### Signer Groups

A signer group is a named set of accounts with an approval threshold. A safe can have multiple signer groups with administrative privileges; admin power is not limited to a single hardcoded group. Each group declares the actions it can approve, whether it can administer safe configuration, and the spending limits that apply to actions executed through that group.

Examples:

| Group | Members | Threshold | Purpose |
| --- | --- | --- | --- |
| Admins | 5 human accounts | 3-of-5 | Safe configuration, upgrades, high-value transactions |
| Treasury | 3 finance operators | 2-of-3 | Recurring operational payments and ASA transfers |
| Validator Ops | 2 operators | 2-of-2 | Key registration and participation-key actions |
| Agent | 1 automation account | 1-of-1 | Low-value automated payments within daily limits |

Signer groups must be first-class objects in both the contract model and the frontend. Users should never have to infer group state from raw addresses. Any change to signer groups, thresholds, admin privileges, or policies must itself be represented as a co-signed governed proposal so the contract can enforce administrative changes with the same threshold rules as fund movement.

**Governance safety.** The safe is intentionally non-upgradable, so there is no recovery path if governance is ever locked out. The contract rejects any `ADM_SET_PRIVILEGES` or `ADM_SET_ACTIVE` change that would strip `PRIV_GROUP` from, or deactivate, the last remaining active group holding it — but operators should still design topology defensively: maintain at least two independent groups with `PRIV_GROUP` where practical, and never approve a change that would leave governance dependent on a single admin group.

### Account Types

When a user adds an account to a signer group, they choose an account type. The safe treats account type as metadata plus a verification rule, so different cryptographic schemes can coexist in the same safe.

Supported account types:

- **Standard account**: A normal Ed25519 Algorand account controlled by a single key (Pera, Defly, Exodus, Daffi, Ledger, KMD, etc.).
- **Multisig account**: An Algorand multisignature account with its own ordered addresses, threshold, and version.
- **Rekeyed / operational account**: An account whose authorization address has been rekeyed for operational control. (Separately from signer identity, accounts rekeyed *to the safe* become spendable sources for payment and asset-transfer proposals — see Rekeyed Accounts As Safe-Controlled Addresses.)
- **Agent account**: An automation/MCP-controlled account constrained by strict policy limits.
- **Quantum-secure account**: A post-quantum account whose signatures are verified against a quantum-resistant scheme.

#### Quantum-Secure Accounts

Algorand is designed with post-quantum security in mind. The network already uses **Falcon** (a NIST-selected post-quantum signature scheme) to secure **State Proofs**, and the AVM exposes a **`falcon_verify`** opcode that lets smart contracts and logic signatures verify FALCON-1024 post-quantum signatures on-chain.

Algo Safe makes the **quantum-secure account a first-class account type** that users can add to any signer group:

- A quantum-secure signer is authorized by a post-quantum (Falcon) key, not only by a classical Ed25519 key.
- Approval of that signer's portion of a proposal is verified by the signed approval app call, with post-quantum verification used only for account types that cannot be authenticated directly by the transaction sender.
- A quantum-secure account can be a sole signer, or combined with standard, multisig, and agent accounts in the same group for hybrid classical + post-quantum security.
- The frontend submits approvals through the `algo-safe` library, so the UX of adding, approving, and removing a quantum-secure signer matches the standard flow.

This lets teams future-proof high-value safes against quantum attacks while keeping the same approval, policy, and audit experience.

### Spending And Action Policies

Policies determine what a signer group can approve. The deployed contract enforces:

- **Action allow-list**: each group's `allowedActions` bitmask gates which transaction types the group can execute (`pay`, `axfer`, `appl`, `keyreg`, `acfg`, `rekey`).
- **Daily limit** for one configured spending asset per signer group (`limitAssetId = 0` means ALGO).
- **Monthly limit** for the same tracked asset per signer group.
- **Close-out sweep accounting**: a payment or asset transfer with a close-to address sweeps the sending account's *entire* remaining ALGO/ASA balance, not just the declared amount — the contract counts the live balance against the limit in that case, so a close-out cannot bypass a group's spending limit.
- **Execution cooldown**: a group with nonzero `cooldownRounds` must wait that many rounds between successive transaction-group executions (the group's first-ever execution is exempt). Cooldowns are capped at 10,000,000 rounds so a misconfigured value can never freeze a group permanently.
- **Membership-epoch invalidation**: removing a member from a group increments its `membershipEpoch`; every pending proposal snapshots the epoch at creation, and both approval and execution require the epochs to still match — so removing a (possibly compromised) signer instantly invalidates all approvals collected so far and forces re-approval from scratch.
- **Threshold hardening at execution**: a proposal snapshots the group threshold at creation, but execution requires the *higher* of the snapshot and the group's live threshold, so raising a threshold in response to an incident immediately applies to already-pending proposals.

Daily and monthly limits store their current usage directly in the signer group record, alongside the tracked `limitAssetId`. The contract updates the group's current daily and monthly usage whenever a proposal executes movement of the configured tracked asset: `limitAssetId = 0` counts ALGO payments, while any nonzero `limitAssetId` counts ASA transfers for that specific asset. Period windows (24 h daily, 30-day monthly) reset lazily on the first spend after they elapse. Limit usage is not stored in a separate box.

Frontend-level policy concepts such as allowed receiver lists and required admin approval for unknown receivers remain product-roadmap items layered on top of these on-chain rules.

### Transaction Proposals

A proposal is a human-readable request to execute one or more Algorand transactions or one administrative safe change.

Every proposal must show:

- Proposal title and purpose
- Requested signer group
- Current approval progress
- Required threshold
- Exact typed payload and inner transaction group preview
- Human-readable effects
- Raw transaction details for advanced users
- Simulation result where available
- Expiration round or time
- Network and genesis hash

Proposals do not store a `groupTxnHash`. The approved content for executable actions is always the canonical ordered transaction list itself, stored on-chain as tagged `(txType, data)` envelopes. A single payment, asset transfer, or app call is represented as a one-item transaction group. Mixed groups such as `pay + appl` or several `appl` calls are first-class proposals. Large groups that exceed the ~2 KB per-ABI-argument limit are split across up to six payload chunks, appended by the proposer before anyone else approves; once an independent signer has approved, the payload is immutable. On execution, the contract emits the approved ordered list as one AVM inner transaction group. Signer-group administration remains a separate governed admin payload.

---

## Supported Algorand Actions

Algo Safe supports the actions Algorand users actually need. The deployed contract executes these transaction types from governed proposals:

- **Payment (`pay`)**: Send ALGO, fund accounts, pay service providers, close accounts only when explicitly allowed. Payments can be sent from the safe's own address or from any external address that has been rekeyed to the safe.
- **Asset transfer (`axfer`)**: Send ASAs, opt in to assets, opt out of assets, and handle ASA decimals safely — again from the safe itself or from a rekeyed external address.
- **Application call (`appl`)**: Call dApps, governance contracts, DeFi protocols, and the Algo Safe contract itself, with full `onCompletion`, application arguments, and foreign account/app/asset references (app create and update are intentionally not supported through the safe).
- **Key registration (`keyreg`)**: Register participation keys, go online/offline, and manage validator participation workflows.
- **Asset configuration (`acfg`)**: Create new ASAs owned by the safe, reconfigure the mutable address roles (manager/reserve/freeze/clawback) of assets the safe manages, or destroy them.
- **Rekey (`rekey`)**: Under admin consensus, rekey the safe's application account itself to another address — for example a newly deployed safe contract during a migration — or release a previously rekeyed external account back to its own key. Executed as a zero-amount self-payment carrying `RekeyTo`, and doubly gated: the executing group must hold the dedicated `ACT_REKEY` action bit **and** the group-admin privilege (`PRIV_GROUP`), with the group's M-of-N threshold met like any proposal.

Each signer group's `allowedActions` bitmask (`ACT_PAY=1`, `ACT_AXFER=2`, `ACT_APPL=4`, `ACT_KEYREG=8`, `ACT_ACFG=16`, `ACT_REKEY=32`) controls which of these the group may approve.

Algorand atomic groups may contain a mix of transaction types. The frontend must make that power understandable instead of hiding it: signers approve the exact ordered list, not a vague action label.

### Rekeyed Accounts As Safe-Controlled Addresses

Algorand's rekeying primitive lets any account hand its signing authority to another address. Algo Safe uses this in both directions:

- **Inbound — spend from rekeyed addresses.** Any Algorand address can be rekeyed to the safe's application address. From then on, payment and asset-transfer entries in a proposal can name that address as their `sender`, and the safe executes them as inner transactions from that account (the AVM itself enforces that an inner-transaction sender is either the application account or an account rekeyed to it). A zero-address `sender` means the safe's own account. This lets one safe govern a whole fleet of addresses — legacy accounts, per-purpose deposit addresses, validator accounts — without moving funds first. Spending limits still apply: a close-out from a rekeyed sender counts that account's full swept balance against the group's limit.
- **Outbound — migration and release.** A rekey proposal (`RekeyTxn`) can rekey the safe's own application account to a newly deployed safe (or any other address), migrating custody without moving assets, or rekey a previously captured external account back to its own key to release it. Because a rekey permanently transfers control, it is reserved for admin consensus: the executing group must hold both the dedicated `ACT_REKEY` action bit (which existing groups do not hold unless governance explicitly grants it) and the group-admin privilege (`PRIV_GROUP`), and the rekey executes only once that admin group's M-of-N threshold is met — both checked at execution time against the group's live state.
- **Registry — admins track what the safe controls.** The contract keeps an admin-governed **rekeyed-address registry** (one box per address, with a label): entries are added and removed through governed admin proposals (`ADM_ADD_REKEYED_ADDR` / `ADM_REMOVE_REKEYED_ADDR`, requiring group-admin privilege at threshold). The registry is bookkeeping — the AVM enforces actual spendability regardless — but it makes the safe's controlled fleet auditable in the UI and drives migrations.

### Safe Upgrade (Migration To A New Contract Version)

The contract is non-upgradable in place, so moving to a newer contract version is a **migration**: deploy a fresh safe on the latest contract, clone the configuration, and rekey custody over. The frontend exposes this as a guided flow:

1. **Deploy & clone.** A fresh safe is deployed and seeded through the clone-friendly bootstrap path: the creator calls `bootstrapGroup` once per active signer group (full policy, threshold, privileges, and all members in one call), `bootstrapRekeyedAddress` for every registry entry, then `finalizeBootstrap`. Until finalization the new safe accepts **no proposals** (members of seeded groups cannot act mid-clone), and finalization requires at least one active group holding group-admin privileges — the same lockout guard as normal governance. Usage counters, membership epochs, and pending proposals are intentionally not cloned.
2. **Migration rekey.** On the old safe, a single governed transaction-group proposal rekeys every registered external address — and the old safe's own application account last — to the new safe's application address. It executes only under admin consensus (`ACT_REKEY` + `PRIV_GROUP` at full threshold).
3. **Cut-over.** After execution the new contract controls every address; funds never moved. The old app remains on-chain as history but can no longer spend.

---

## Custodian Groups — DeFi Protocol Integration

Custodian Groups are a specialised signer-group type designed to make Algo Safe the primary on-chain asset store for lending, streaming, and other DeFi protocols built on Algorand. A Custodian Group is governed by a smart contract address (the "protocol custodian"), not by a human wallet, and carries no admin privileges — its entire scope of action is bounded by explicitly configured **Asset Guards**.

### What Is A Custodian Group?

| Property | Standard Group | Custodian Group |
|---|---|---|
| Members | Human accounts, agents | Smart-contract addresses |
| Admin privileges | Configurable | Always zero (`PRIV_*` blocked at execution) |
| Spending limits | Daily / monthly limits | Asset Guard allocation per asset |
| Create | Admin proposal (`ADM_CREATE_GROUP`) | Admin proposal (`ADM_CREATE_CUSTODIAN`) |
| Dissolve | Admin proposal | Self-dissolution by custodian only (`ADM_DISSOLVE_CUSTODIAN`) |
| Guard management | N/A | Admin-only (`ADM_SET_GUARD` / `ADM_REMOVE_GUARD`) |

### Asset Guards

An Asset Guard is a bounded allocation of a specific asset (ALGO or any ASA, keyed by `assetId`) reserved exclusively for one Custodian Group. The Custodian Group may transfer **at most** the guarded `lockedAmount` of that asset per guard; each execution deducts from the allocation atomically, reverting if the inner transaction group fails, so the deduction is always consistent with the actual transfer.

Guards are managed exclusively through admin proposals (`ADM_SET_GUARD` and `ADM_REMOVE_GUARD`). Any group holding `PRIV_GROUP` can propose setting or removing a guard; no custodian co-approval is required. This keeps the Algorand smart-contract program within the AVM binary-size ceiling while still giving admins the ability to pre-authorise bounded protocol spending.

`assetId = 0` is the ALGO guard; any non-zero value is an ASA guard. A Custodian Group can hold multiple simultaneous guards across different assets.

Use cases:

- **Lending protocol liquidation**: the lending smart contract is added as the sole member of a Custodian Group. An admin sets an ALGO (or ASA) guard covering the expected liquidation budget. When a loan's health factor falls below threshold, the lending contract proposes and executes a liquidation payment — within the guarded allocation — without requiring any admin co-signature at liquidation time.
- **Payment streaming**: a streaming contract holds a pre-allocated guard covering the total amount to be released. The streaming contract draws from it on schedule. Admins set the guard at stream initiation; the custodian spends it incrementally without admin involvement.

### Guard Operations

| Change type | Who can propose | Effect |
|---|---|---|
| `ADM_CREATE_CUSTODIAN` | Any group with `PRIV_GROUP` | Creates a new custodian group and adds its first member |
| `ADM_SET_GUARD` | Any group with `PRIV_GROUP` | Creates or updates an asset guard (increments `guardCount` on first creation) |
| `ADM_REMOVE_GUARD` | Any group with `PRIV_GROUP` | Deletes an asset guard (decrements `guardCount`) |
| `ADM_DISSOLVE_CUSTODIAN` | The custodian group itself only | Removes the group and its last member box (blocked unless `guardCount == 0` and `memberCount == 1`) |

### Self-Dissolution

A Custodian Group can only be dissolved by itself (`ADM_DISSOLVE_CUSTODIAN` proposed by the Custodian Group — admin groups cannot propose this for a non-self group). Dissolution is blocked at execution unless all Asset Guards have been removed first (`guardCount == 0`) **and** the group has been pruned to a single member (`memberCount == 1`) — extra members are removed beforehand via `ADM_REMOVE_MEMBER`, which reclaims each member box's minimum balance. The dissolve proposal names the last member, whose box is deleted together with the signer-group record, so dissolution locks no storage minimum balance. Terminal proposals created by the group before dissolution remain prunable afterwards (the prune authorization check is waived once the group record is gone), so their storage deposits are recoverable too. On dissolution `groupCount` is decremented.

### Security Properties Summary

| Property | Mechanism |
|---|---|
| Guard creation/modification | Admin-only (`PRIV_GROUP` required); custodian cannot self-allocate |
| Guard removal | Admin-only (`PRIV_GROUP` required) |
| Custodian dissolution | Self-proposed only; blocked until `guardCount == 0` |
| Admin privileges on custodian | Execution-time block: `ADM_SET_PRIVILEGES` on a custodian group always reverts |
| Guard spend enforcement | AVM atomic: guard deducted before inner-txn group; revert on failure restores state |
| Custodian rekey | Blocked at execution: custodian groups cannot execute rekey transactions |

---

## x402 Agent Payment Flow

x402 is an HTTP-native payment protocol built around `402 Payment Required`. A service provider protects a resource, the AI agent requests it, the provider returns payment requirements, and the agent retries the request with a signed payment payload. The important correction is that the agent normally sends the signed `PAYMENT-SIGNATURE` back to the resource server, not directly to the facilitator. The resource server then asks the facilitator to verify and settle the payment, and the facilitator returns settlement confirmation to the resource server.

For Algo Safe, the agent does not hand-build the Algorand payment. It calls the `algo-safe` npm library, which builds an app-call-based safe execution request, checks the signer-group policy, submits the required signed approval app call, and returns the x402 payment payload that can be sent with the retried HTTP request.

### Standard x402 Flow

```mermaid
sequenceDiagram
    participant Agent as AI agent / x402 client
    participant Provider as Resource server / service provider
    participant Facilitator as x402 facilitator
    participant Chain as Algorand network

    Agent->>Provider: GET protected resource
    Provider-->>Agent: 402 Payment Required + PAYMENT-REQUIRED header
    Agent->>Agent: select PaymentRequirements
    Agent->>Provider: Retry request + PAYMENT-SIGNATURE header
    Provider->>Facilitator: POST /verify PaymentPayload + PaymentRequirements
    Facilitator->>Chain: verify payment can settle
    Chain-->>Facilitator: verification result
    Facilitator-->>Provider: VerificationResponse valid
    Provider->>Facilitator: POST /settle PaymentPayload + PaymentRequirements
    Facilitator->>Chain: submit/confirm payment
    Chain-->>Facilitator: confirmed transaction
    Facilitator-->>Provider: PaymentExecutionResponse
    Provider-->>Agent: 200 OK + resource + PAYMENT-RESPONSE header
```

### Algo Safe x402 Flow

```mermaid
sequenceDiagram
    participant Agent as AI agent
    participant Library as algo-safe npm library
    participant Safe as Algo Safe app
    participant Provider as Resource server
    participant Facilitator as x402 facilitator
    participant Chain as Algorand network

    Agent->>Provider: GET protected resource
    Provider-->>Agent: 402 Payment Required + accepted schemes/networks/assets
    Agent->>Library: buildX402Payment(requirements, signerGroupId)
    Library->>Safe: create or load app-call payment proposal
    Safe-->>Library: policy result + typed app call payload
    Library->>Agent: request signed approval app call
    Agent->>Library: signed approveProposal app call
    Library->>Agent: PaymentPayload for PAYMENT-SIGNATURE
    Agent->>Provider: Retry request + PAYMENT-SIGNATURE header
    Provider->>Facilitator: POST /verify payload + requirements
    Facilitator->>Chain: simulate/verify app call payment
    Chain-->>Facilitator: valid or invalid
    Facilitator-->>Provider: VerificationResponse
    Provider->>Facilitator: POST /settle payload + requirements
    Facilitator->>Chain: submit signed app call / payment group
    Chain-->>Facilitator: confirmed transaction id
    Facilitator-->>Provider: PaymentExecutionResponse
    Provider-->>Agent: 200 OK + resource + PAYMENT-RESPONSE header
```

### Component Responsibilities

```mermaid
flowchart LR
    Agent[AI agent] -->|HTTP request| Provider[Service provider]
    Provider -->|402 + requirements| Agent
    Agent -->|requirements + signer group| Library[algo-safe npm library]
    Library -->|policy checked app call payload| Safe[Algo Safe app]
    Library -->|PAYMENT-SIGNATURE payload| Agent
    Agent -->|retry with payment header| Provider
    Provider -->|verify and settle| Facilitator[x402 facilitator]
    Facilitator -->|simulate submit confirm| Chain[Algorand]
    Chain -->|tx confirmation| Facilitator
    Facilitator -->|execution response| Provider
    Provider -->|paid resource| Agent
```

### Protocol Notes

- The service provider advertises price, network, scheme, recipient, asset, and any facilitator details in the `402 Payment Required` response.
- The agent retries the original request with `PAYMENT-SIGNATURE`; the resource server remains the HTTP counterparty for the paid resource.
- The facilitator verifies and settles payments for the resource server. This keeps the provider from running its own Algorand infrastructure.
- On Algorand, the x402 payment payload can represent the safe-approved app call or transaction group needed to transfer value under the selected x402 scheme and network.
- The `algo-safe` library is responsible for turning the x402 payment requirements into a governed safe proposal/app call, enforcing daily and monthly signer-group usage, submitting the safe signer approval app call, and exposing the final payload to the agent.

---

## EURD Onramp And Offramp (Quantoz)

Algo Safe integrates **EURD**, the regulated euro stablecoin issued by **Quantoz Payments B.V.** (Netherlands), so teams can fund and defund their safe with real euros without leaving the custody workflow. EURD is electronic money compliant with the European **Electronic Money Directive (EMD)** and, when issued as an e-money token (EMT), with the **Markets in Crypto-Assets Regulation (MiCAR)**. Holders have a right of redemption against the issuer at any time and at par value. On Algorand, EURD is an Algorand Standard Asset (ASA ID `1221682136`), so it behaves like any other ASA inside the safe while remaining fully fiat-backed (1:1 reserves held in segregated accounts with Tier 1 banks and AAA EU government bonds).

This makes EURD a natural treasury asset for an Algorand safe: an **onramp** converts incoming EUR (via SEPA/bank transfer) into EURD delivered to the safe's controlled address, and an **offramp** redeems EURD held by the safe back into EUR paid out to a bank account.

### Integration Model

Algo Safe consumes the **Quantoz Payments API** documented at `https://portal.quantozpay.com/documentation`. Quantoz exposes three integration models; Algo Safe targets the **blockchain-based EUR accounts on Algorand** model (self-hosted wallets), with optional support for the **embedded payments** model where a partner acts on behalf of end users.

As with every other capability, the frontend never calls the Quantoz API or constructs EURD transfers directly. EURD onramp/offramp is exposed **only through the `algo-safe` npm library**, which:

- Wraps the Quantoz Payments REST API behind typed, documented methods.
- Builds and previews the resulting Algorand atomic groups (for example the ASA opt-in to EURD and any required application calls) so they pass through the same proposal, policy, and approval flow as any other safe action.
- Hands wallet signing back to the caller's `TransactionSigner`; the library never holds keys or banking credentials.
- Keeps Quantoz API keys/secrets server-side, never embedded in the reference frontend bundle.

### Onramp (Buy / Mint EURD Into The Safe)

Purpose: turn EUR into EURD credited to the safe's controlled Algorand address.

Flow:

1. Operator chooses **Add funds (EURD)** and enters a target amount.
2. The library ensures the safe is **opted in** to the EURD ASA, proposing an `axfer` opt-in transaction through the normal governed flow if needed.
3. The library requests onramp instructions from Quantoz (deposit reference / SEPA details, or an embedded-payment authorization, depending on the integration model).
4. The operator (or partner) completes the EUR deposit.
5. Quantoz mints/issues EURD and transfers it to the safe's controlled address on Algorand.
6. The dashboard reflects the new EURD balance once on-chain and Quantoz settlement confirm.

Requirements:

- Show KYC/onboarding state required by Quantoz before an onramp can proceed, in plain language.
- Show deposit reference, expected settlement time, fees, and minimums returned by the API.
- Track onramp requests as first-class items with states: `initiated`, `awaiting EUR deposit`, `EUR received`, `EURD issued`, `settled on-chain`, `failed`, `expired`.
- Surface the EURD ASA id, decimals, and opt-in status exactly like any other ASA.

### Offramp (Sell / Redeem EURD Out Of The Safe)

Purpose: redeem EURD held by the safe back into EUR paid to a bank account.

Flow:

1. Operator chooses **Withdraw to EUR (EURD)**, enters an amount, and selects a verified payout IBAN.
2. The library builds the EURD redemption as a **governed proposal**: the EURD `axfer` (and any required `appl`) is previewed as an exact atomic group and routed through the safe's signer groups and policies.
3. Required signers approve under the normal M-of-N threshold.
4. On execution, EURD leaves the safe to the Quantoz redemption address on Algorand.
5. Quantoz burns/redeems the EURD and pays out EUR to the destination bank account.
6. The activity log records the on-chain txn id together with the Quantoz redemption reference.

Requirements:

- Redemption must respect the safe's spending limits, allowlists, and admin-approval rules (for example treating a payout IBAN like an allowlisted receiver).
- Show payout IBAN, fees, minimums, expected EUR settlement time, and the redemption reference.
- Track offramp requests with states: `proposed`, `awaiting approvals`, `EURD sent on-chain`, `redeemed`, `EUR paid out`, `failed`, `cancelled`.
- Flag the EURD redemption recipient address as a known, verified Quantoz address so signers can review it confidently.

### Why This Belongs In The Safe

- **Treasury completeness**: teams can move between EUR and on-chain value under the same M-of-N approval, policy, and audit guarantees as payments and ASA transfers.
- **Agent budgets in euros**: agent signer groups can be funded with EURD and constrained by the same daily/monthly limits, enabling euro-denominated agentic payments.
- **One audit trail**: every onramp and offramp appears in the activity log alongside the proposals, approval app calls, and executed transaction ids that authorized it.
- **Boundary preserved**: third-party apps, scripts, and AI/MCP agents get the same EURD onramp/offramp by calling the `algo-safe` library, never the Quantoz API directly.

---

## Packaging And Architecture

Algo Safe is delivered as two layers with a strict boundary between them. Every consumer — the reference frontend, third-party apps, automation scripts, and AI/MCP agents — interacts with a safe **only** through the `algo-safe` npm library. The library is the single source of truth that builds, simulates, and submits Algorand atomic transaction groups; callers hand it a wallet `TransactionSigner` and never assemble raw transactions themselves.

### Architecture Diagram

```mermaid
flowchart TB
    subgraph Consumers["Consumers (any TypeScript/JavaScript environment)"]
        FE["algo-safe-frontend<br/>(reference React client)"]
        TP["Third-party apps & UIs"]
        BOT["Scripts, bots & backends"]
        AGENT["AI / MCP agents"]
    end

    subgraph Wallets["Wallet Layer (@txnlab/use-wallet)"]
        W["Pera · Defly · Exodus · Daffi<br/>Ledger · KMD/LocalNet · WalletConnect"]
        PQ["Quantum-secure signer<br/>(Falcon / post-quantum key)"]
    end

    subgraph Library["algo-safe npm library (public API — single source of truth)"]
        API["Public API<br/>safe create · signer groups · proposals · approvals · execute · queries"]
        BUILD["Transaction group builder<br/>pay · axfer · appl · keyreg · acfg · rekey"]
        POLICY["Policy & threshold logic<br/>limits · allowlists · M-of-N"]
        CLIENT["Generated typed clients + ARC-56 app spec"]
        API --> BUILD
        API --> POLICY
        BUILD --> CLIENT
    end

    subgraph Chain["Algorand Network"]
        APP["Algo Safe Application<br/>(smart account / AVM app)"]
        SAFEADDR["Controlled safe address<br/>ALGO + ASA holdings"]
        ALGOD["algod · indexer · simulate"]
        VERIFY["On-chain approval validation<br/>Txn.sender · multisig · falcon_verify when needed"]
    end

    FE --> API
    TP --> API
    BOT --> API
    AGENT --> API

    API -- "active address + TransactionSigner" --> W
    API -- "post-quantum approval data when needed" --> PQ
    W -- "signs approveProposal app call" --> BUILD
    PQ -- "external signer proof when needed" --> POLICY

    CLIENT -- "atomic transaction group" --> ALGOD
    ALGOD --> APP
    APP --> SAFEADDR
    APP --> VERIFY

    classDef boundary fill:#0b7285,stroke:#063,color:#fff;
    classDef chain fill:#364fc7,stroke:#1a2a6c,color:#fff;
    class API,BUILD,POLICY,CLIENT boundary;
    class APP,SAFEADDR,ALGOD,VERIFY chain;
```

**Boundary rule:** consumers call only the library's public API. The library owns transaction building, policy enforcement, signing handoff, and on-chain submission, so the frontend, third parties, and agents all share identical, audited logic.

### `algo-safe` npm Library (from `algo-safe-contracts`)

The output of `algo-safe-contracts` is a reusable, publishable **npm library** named `algo-safe` that anyone can install and use, not just this project's frontend.

The library must:

- Compile the Algorand TypeScript smart contracts and ship the ARC-56 app spec(s) and generated typed clients.
- Export a stable, documented, semver-versioned public API surface.
- Provide high-level methods for every safe operation, including safe creation, signer-group management, proposal building, approval/co-signing, execution, read/query helpers, and EURD onramp/offramp via the Quantoz Payments API.
- Build the exact Algorand atomic transaction groups (`pay`, `axfer`, `appl`, `keyreg`, `acfg`, `rekey`) internally so callers never assemble raw transactions by hand.
- Accept a wallet/signer handoff (for example an Algorand `TransactionSigner`) so the library performs signing through the caller's wallet rather than holding keys.
- Be framework-agnostic and usable from any TypeScript/JavaScript environment: web frontends, Node.js backends, scripts, bots, and AI/MCP agents.
- Hide AVM and ARC-56 implementation details behind typed methods, while still exposing the assembled transaction group for inspection.

The library is the single source of truth for how to interact with an Algo Safe. Any third party can build their own UI, automation, or integration on top of it.

### Frontend (`algo-safe-frontend`)

The frontend is a **reference client** of the `algo-safe` npm library and nothing more.

Hard requirements:

- The frontend must interact with Algo Safe **exclusively through methods exported by the `algo-safe` npm library**.
- The frontend must not import generated contract clients directly, hand-build transactions, hardcode ABI method selectors, or construct atomic groups on its own.
- All safe reads, proposal building, signing, and execution must go through the library's public API.
- Wallet connection (via `@txnlab/use-wallet`) only provides the active address and `TransactionSigner`, which are handed to the library; the library does the rest.
- If the frontend needs a new capability, it must be added to the library's public API first, then consumed by the frontend.

This boundary guarantees that the frontend, third-party apps, and automated agents all share identical, audited transaction-building and policy logic.

---

## Smart Contract Model

This section is the on-chain model from which the Algo Safe Algorand smart contract is constructed. It reflects how the Algorand Virtual Machine (AVM) actually works, so the contract maps cleanly onto AVM primitives instead of fighting them.

### AVM Grounding

The contract is written in **Algorand TypeScript** (PuyaTs) and compiled to **TEAL / AVM bytecode**; it is not normal TypeScript. The model is constrained by AVM realities:

- **One application, two programs.** Every Algorand app is an **Approval Program** (all app calls except ClearState) plus a **Clear State Program** (cleanup only). No critical authorization logic lives in Clear State, because users can always clear their local state.
- **Two fundamental types.** At the AVM level everything is `uint64` or `bytes` (≤ 4096 bytes). Higher-level shapes (structs, addresses, ABI tuples) are ARC-4 encodings over `bytes`.
- **The safe address is the application account.** The smart account that holds ALGO and ASAs (including EURD) is the **application's account**. All payments, ASA transfers, app calls, key registrations, asset configurations, and rekeys are executed as **inner transactions** signed by the application, each with `fee: 0` (the caller covers fees via fee pooling). Payments and asset transfers may alternatively be sent **from any external account rekeyed to the application address** — the AVM authorizes an inner-transaction sender exactly when it is the app account or rekeyed to it — so one safe can govern many addresses.
- **No re-entrancy.** An application cannot call itself, even indirectly through inner transactions; the AVM enforces this.
- **Hard limits drive storage choices.** Global state is capped (64 KV pairs, key+value <= 128 bytes), so per-group, per-member, per-proposal, and per-approval records live in **box storage** (`Box` / `BoxMap`), whose MBR is funded by the app account. Algorand protocol transaction groups can contain up to 16 transactions; the Algo Safe contract stores a variable-length list of executable inner transactions per transaction-group proposal (bounded by `MAX_GROUP_TXNS`, currently 16, so it tracks the protocol limit), split across up to six payload-chunk boxes when it exceeds one ~2 KB ABI argument. The opcode budget is 700 per app call; every ABI method takes an `ensureBudgetValue` argument that raises the available budget via opup inner transactions before execution's decode/validate/stage passes run. Terminal proposals past expiry can be pruned (`pruneProposal`) to reclaim their box MBR.
- **Approval authentication comes from the signed app call.** A standard approval is an `approveProposal` application call signed by the signer account. The AVM has already verified the transaction signature before the approval program runs, so the contract checks `Txn.sender` against the signer group and records only the approval fact. The `Approval` box never stores a signature. Explicit opcodes such as `falcon_verify` are used only for signer types that cannot be authenticated directly as the transaction sender.

### Storage Layout

The application keeps a small fixed **global state** for configuration and counters, and uses **box storage** for the unbounded, per-entity records (signer groups, members, proposals, approvals, typed transaction payloads, and signer-group change payloads). Composite box keys give O(1) lookups without account opt-in. Daily and monthly usage counters live inside each signer group's box value; there is no separate `LimitUsage` box.

```mermaid
classDiagram
    class Application {
        +ApprovalProgram
        +ClearStateProgram
        +appAccount : controlled safe address (ALGO + ASA + EURD)
    }

    class GlobalState {
        +name : string
        +creator : Account
        +bootstrapped : uint64
        +nextGroupId : uint64
        +nextProposalId : uint64
        +groupCount : uint64
        +paused : uint64 (emergency pause, set via ADM_SET_PAUSED; blocks tx-group actions only, never governance)
        +version : string (CONTRACT_VERSION)
        +activePrivGroupCount : uint64 (governance lockout guard)
    }

    class SignerGroup {
        «BoxMap key: groupId»
        +name : string
        +threshold : uint64
        +memberCount : uint64
        +adminPrivileges : uint64 (bitmask GROUP=1 / POLICY=2)
        +allowedActions : uint64 (bitmask pay/axfer/appl/keyreg/acfg/rekey)
        +limitAssetId : uint64 (0 = ALGO, nonzero = tracked ASA for daily/monthly limits)
        +dailyLimit : uint64
        +dailyUsage : uint64
        +dailyPeriodStart : uint64
        +monthlyLimit : uint64
        +monthlyUsage : uint64
        +monthlyPeriodStart : uint64
        +cooldownRounds : uint64 (capped at 10,000,000)
        +lastExecutionRound : uint64
        +membershipEpoch : uint64 (bumped on member removal)
        +active : uint64
    }

    class Member {
        «BoxMap key: groupId+account»
        +accountType : uint64 (1 standard / 2 multisig / 3 rekeyed / 4 agent / 5 quantum)
        +label : string
        +addr : Account
    }

    class Proposal {
        «BoxMap key: proposalId»
        +groupId : uint64
        +status : uint64 (1 active / 2 ready / 3 executed / 4 cancelled)
        +payloadType : uint64 (1 transactionGroup / 5 adminChange)
        +approvalsCount : uint64
        +threshold : uint64 (snapshot at creation)
        +expiryRound : uint64
        +proposer : Account
        +numPayloads : uint64 (payload chunks in use, 1..6)
        +epochAtCreation : uint64 (membershipEpoch snapshot)
        +payloadVersion : uint64 (starts 1, bumped per payload edit; approvals bind to it)
        +totalTxns : uint64 (running txn count across chunks, capped at MAX_GROUP_TXNS)
    }

    class TransactionGroupPayload {
        «BoxMap key: proposalId*7+payloadIndex»
        +txns : SafeTxn[]  «ordered, group total 1..MAX_GROUP_TXNS»
    }

    class SafeTxn {
        +txType : uint64 (1 pay / 2 axfer / 3 appl / 4 keyreg / 5 acfg / 6 rekey)
        +data : bytes (ARC4-encoded per-type struct)
    }

    class PaymentTxn {
        +sender : Account (zero = safe itself, else rekeyed-to-safe address)
        +receiver : Account
        +amount : uint64
        +hasClose / closeRemainderTo
        +note : string
    }

    class AssetTxn {
        +sender : Account (zero = safe itself, else rekeyed-to-safe address)
        +xferAsset : uint64
        +assetReceiver : Account
        +assetAmount : uint64
        +hasAssetClose / assetCloseTo
        +note : string
    }

    class AppTxn {
        +appId : uint64
        +onCompletion : uint64 (update rejected)
        +appArgs : bytes[]
        +accounts / foreignApps / foreignAssets
        +note : string
    }

    class KeyRegTxn {
        +online : uint64
        +voteKey / selectionKey / stateProofKey : bytes
        +voteFirst / voteLast / voteKeyDilution : uint64
    }

    class AssetConfigTxn {
        +configAsset : uint64 (0 = create, else reconfigure/destroy)
        +total / decimals / defaultFrozen
        +unitName / assetName / url / metadataHash
        +manager / reserve / freeze / clawback : Account
        +note : string
    }

    class RekeyTxn {
        +sender : Account (zero = safe itself)
        +rekeyTo : Account (new auth address)
        +note : string
    }

    class AdminChange {
        «BoxMap key: proposalId»
        +changeType : uint64 (1 createGroup / 2 addMember / 3 removeMember / 4 changeThreshold / 5 setPolicy / 6 setPrivileges / 7 setActive / 8 addRekeyedAddr / 9 removeRekeyedAddr / 10 setPaused)
        +targetGroupId : uint64
        +groupName / memberAddr / memberType / memberLabel
        +threshold / adminPrivileges / allowedActions
        +limitAssetId / dailyLimit / monthlyLimit / cooldownRounds
        +activeFlag : uint64
    }

    class RekeyedAddressEntry {
        «BoxMap key: account (prefix r)»
        +label : string
        +addedRound : uint64
    }

    class Approval {
        «BoxMap key: proposalId+Txn.sender»
        +signer : Account
        +round : uint64
    }

    Application "1" --> "1" GlobalState : holds
    Application "1" --> "*" SignerGroup : BoxMap
    SignerGroup "1" --> "*" Member : BoxMap
    Application "1" --> "*" Proposal : BoxMap
    Proposal "1" --> "0..6" TransactionGroupPayload : BoxMap
    Proposal "1" --> "0..1" AdminChange : BoxMap
    Proposal "1" --> "*" Approval : BoxMap
    TransactionGroupPayload "1" --> "*" SafeTxn : ordered list
    SafeTxn <|-- PaymentTxn : txType 1
    SafeTxn <|-- AssetTxn : txType 2
    SafeTxn <|-- AppTxn : txType 3
    SafeTxn <|-- KeyRegTxn : txType 4
    SafeTxn <|-- AssetConfigTxn : txType 5
    SafeTxn <|-- RekeyTxn : txType 6
```

`TransactionGroupPayload` is the executable payload shape used by the contract. Each stored transaction is a tagged envelope `(txType, data)` where `data` is the ARC4 encoding of exactly one per-type struct — so an entry occupies only the bytes its own type needs, and the payload array stays homogeneous on the wire. A one-action proposal is still a transaction group with a single entry. The combined group length across all payload chunks is bounded by `MAX_GROUP_TXNS` (currently 16, matching the Algorand protocol group limit); any mix of payment, asset transfer, app call, key registration, asset config, and rekey entries executes as one atomic inner group. Proposals whose encoded payload exceeds one ~2 KB ABI argument spread it across up to six chunk slots (`proposalId*7 + payloadIndex` box keys), appended by the proposer via `appendTransactionGroupPayload` — allowed only while the proposer's own auto-approval is the sole approval, so no independent signer ever approves a payload that can still change.

### ABI Method Surface

The application is intentionally **non-updatable and non-deletable** for custody safety — there is no upgrade or teardown path (migration is done by rekeying the safe account to a new deployment under admin consensus; see Safe Upgrade above). `createApplication` initialises global state; a new safe is then seeded either by `bootstrap` (creator-only, once: genesis 1-of-1 admin group) or by the clone-friendly path (`bootstrapGroup`/`bootstrapRekeyedAddress` repeated as needed, closed by `finalizeBootstrap`), used to copy an existing safe's configuration during a migration. Every other privileged change flows through governed proposals. Read-only getters use `@abimethod({ readonly: true })` so clients can query without a state-changing call; every method takes an `ensureBudgetValue` argument so callers can raise the opcode budget in the same call.

```mermaid
flowchart TB
    subgraph Lifecycle["Lifecycle & bootstrap"]
        C1["createApplication(name) — init global state"]
        C2["bootstrap(groupName) — creator-only, once: genesis 1-of-1 admin group"]
        C3["bootstrapGroup(seed, members, budget) — creator-only, pre-finalize: clone a full group"]
        C4["bootstrapRekeyedAddress(addr, label) — creator-only, pre-finalize"]
        C5["finalizeBootstrap() — closes seeding; requires an active admin group"]
    end

    subgraph Proposals["Proposal lifecycle"]
        P1["proposeTransactionGroup(groupId, payload, expiryRound, execute, budget)"]
        P1A["appendTransactionGroupPayload(proposalId, payloadIndex 2..6, payload, budget)"]
        P1B["proposeAdminChange(groupId, change, expiryRound, budget)"]
        P2["approveProposal(proposalId, expectedPayloadVersion, budget) — approval binds to the reviewed payload version"]
        P3["executeProposal(proposalId, budget) → inner txn group"]
        P4["cancelProposal(proposalId, budget)"]
        P5["pruneProposal(proposalId, budget) — reclaim box MBR of terminal, expired proposals"]
    end

    subgraph AdminChanges["AdminChange payload types (applied by executeProposal)"]
        A1["ADM_CREATE_GROUP — new group + first member"]
        A2["ADM_ADD_MEMBER / ADM_REMOVE_MEMBER"]
        A3["ADM_CHANGE_THRESHOLD"]
        A4["ADM_SET_POLICY — actions, tracked asset, limits, cooldown"]
        A5["ADM_SET_PRIVILEGES / ADM_SET_ACTIVE — lockout-guarded"]
        A6["ADM_ADD_REKEYED_ADDR / ADM_REMOVE_REKEYED_ADDR — registry"]
        A7["ADM_SET_PAUSED — emergency pause (tx groups only; governance stays live)"]
    end

    subgraph Reads["Read-only getters"]
        R1["getConfig()"]
        R2["getSignerGroup(groupId)"]
        R3["getProposal(proposalId)"]
        R4["getTransactionGroup(proposalId, payloadIndex)"]
        R5["getMember(groupId, account) / isMember(groupId, account)"]
        R6["hasApproved(proposalId, account)"]
        R7["getActivePrivGroupCount()"]
        R8["isRekeyedAddress(account) / getRekeyedAddress(account)"]
    end

    P1B --> A1
    P1B --> A2
    P1B --> A3
    P1B --> A4
    P1B --> A5
    P3 --> A1
```

Every administrative change (create group, add/remove member, change threshold, set policy, set privileges, set active) is itself a **governed action**: it is created as an `AdminChange` proposal via `proposeAdminChange`, approved under the proposing group's M-of-N threshold, and only then applied by `executeProposal`. The contract never trusts a single caller for privileged changes, and it supports more than one admin-capable signer group.

Two behaviors worth calling out:

- **Propose-and-execute in one call.** `proposeTransactionGroup(..., execute: true)` auto-approves the proposer and immediately attempts execution — it succeeds only for a 1-of-1 group whose policy allows the transactions, letting single-signer groups (typically agents) pay in one app call.
- **Admin privileges are safe-wide, not self-scoped.** `PRIV_GROUP` lets a group administer *any* group in the safe, and `PRIV_POLICY` lets it change *any* group's spending policy. A **governance lockout guard** (`activePrivGroupCount`) rejects — at both proposal validation and execution time — any change that would strip `PRIV_GROUP` from, or deactivate, the last remaining active group holding it, since the non-upgradable contract has no other recovery path.

### Proposal State Machine

A proposal carries the **exact typed payload** it authorizes. For executable actions, that payload is always an ordered `TransactionGroupPayload`; a single transaction is just a one-entry group. A signer approves by submitting a signed `approveProposal(proposalId, expectedPayloadVersion)` app call from the signer account, where `expectedPayloadVersion` is the proposal's `payloadVersion` read (via `getProposal`) at review time — if the proposer edits a payload chunk after the signer reviewed it but before the approval confirms, the version no longer matches and the stale approval reverts instead of silently binding to different content. The blockchain validates that transaction signature before contract logic runs; the contract then checks that `Txn.sender` is a member of the requested signer group and records the approval. If the ordered payload changes, pending approvals are invalidated by the version bump and must be collected again. During `executeProposal`, the approved transaction list is converted into one atomic inner transaction group. For signer-group changes, the approved admin payload mutates the group, member, threshold, policy, or admin-privilege boxes.

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> SimulationPending : submit for dry-run
    SimulationPending --> SimulationFailed : simulate rejects
    SimulationPending --> ReadyForApprovals : simulate ok
    SimulationFailed --> Draft : rebuild group
    ReadyForApprovals --> WaitingForApprovals : first valid approval
    WaitingForApprovals --> WaitingForApprovals : approval (threshold not met)
    WaitingForApprovals --> ReadyToExecute : threshold met
    ReadyToExecute --> Executed : executeProposal() inner txns succeed
    ReadyToExecute --> FailedOnChain : inner group fails (atomic rollback)
    WaitingForApprovals --> Expired : past expiryRound
    ReadyForApprovals --> Expired : past expiryRound
    WaitingForApprovals --> Cancelled : cancelProposal()
    Draft --> Cancelled : cancelProposal()
    Executed --> [*]
    Expired --> [*]
    Cancelled --> [*]
    FailedOnChain --> [*]
```

### Execution Flow (Approval to Inner Transactions)

When the threshold is met, `executeProposal` re-checks policy, loads the approved typed payload, and either applies a signer-group administration change or emits the authorized actions as **inner transactions** from the application account. The inner group is atomic — all inner transactions succeed or all roll back.

```mermaid
sequenceDiagram
    participant Caller as Caller (library + signer)
    participant App as Algo Safe Application
    participant Store as Box storage
    participant Inner as Inner transactions
    participant Chain as Algorand (algod)

    Caller->>App: executeProposal(proposalId, ensureBudgetValue)
    App->>Store: load Proposal + SignerGroup + payload chunks
    App->>App: assert status == READY, round <= expiryRound
    App->>App: assert approvalsCount >= max(snapshot, live threshold)
    App->>App: assert membershipEpoch unchanged since creation
    App->>App: assert group active + cooldown elapsed
    App->>App: pass 1 — decode, validate actions, tally spend vs limits
    App->>Inner: pass 2 — stage pay / axfer / appl / keyreg / acfg / rekey (fee = 0, sender = safe or rekeyed address)
    Inner->>Chain: atomic inner group
    Chain-->>App: success or rollback
    App->>Store: update usage + lastExecutionRound + status = EXECUTED
    App-->>Caller: emit Executed event (ARC-28) + txn ids
```

For transaction proposals, execution makes **two passes** over the stored payload chunks:

1. **Validate and account** — every entry is decoded from its `(txType, data)` envelope and checked against the group's `allowedActions` and per-type rules (receiver present, app-call reference limits, no app update, rekey target present, …). Payments and transfers of the tracked asset are tallied against the daily/monthly limits, counting the sending account's full live balance when a close-out is present. The group's usage counters and `lastExecutionRound` are written back before staging.
2. **Stage and submit** — each entry is emitted as an inner transaction with `fee: 0` (the caller covers fees via fee pooling) using the low-level `ITxnCreate` builder, setting the inner sender to a rekeyed external address when the entry carries one, and the whole group is submitted atomically.

The opcode budget for both passes is raised by the `ensureBudgetValue` argument the caller supplies (opup inner calls cannot run while the inner group is being staged). The policy check and the final usage write happen in the same app call so limit accounting cannot drift from execution.

### How EURD Maps Onto This Model

EURD is an Algorand Standard Asset, so onramp/offramp reuse the same primitives with no special contract path:

- **Opt-in**: an `axfer` opt-in inner transaction adds EURD to the application account, governed like any ASA opt-in.
- **Offramp redemption**: redeeming EURD to the Quantoz address is a standard `axfer` inner transaction inside a governed proposal, subject to the group's limits and allowlist (the Quantoz payout address is treated as an allowlisted receiver).
- **Onramp**: minting/issuing EURD is performed by Quantoz off-chain; the contract simply receives the resulting ASA into the application account and the balance appears through normal indexer reads.

### Construction Notes (Implementation Guidance)

- Use **`uint64`/`bytes`** and `Uint64()` everywhere in contract code — never JS `number`.
- Store records as plain TS types in `BoxMap`; `clone()` on every box read/write to respect AVM value semantics.
- Fund the application account for **box MBR** before creating groups/proposals (2,500 + 400 × (key + value length) µAlgo per box).
- Set **`fee: 0`** on all inner transactions; the caller covers fees via fee pooling.
- Reserve enough **app calls in the group** for approval, execution, and any external-scheme verification that cannot rely directly on `Txn.sender` authentication.
- Emit **ARC-28 events** for created/approved/executed/cancelled so indexers and the activity log can reconstruct full custody history.

---

## Transaction Builder UX

The transaction builder is the most important part of the product.

Users should be able to prepare a single high-level safe action, then have the frontend assemble and display the exact typed payload that the contract will later execute as an inner transaction group.

This is especially valuable for users who would otherwise need to approve many separate dApp calls on a hardware wallet. For example, a Ledger user may need to authorize several application calls for a DeFi, governance, or operational workflow. Instead of signing each underlying app call one by one, the builder packages the ordered app-call list into one Algo Safe transaction-group proposal. Each signer reviews the canonical list and signs one Algo Safe app-call approval. After the threshold is met, `executeProposal` emits the approved list as one atomic inner transaction group from the safe account.

For example, a dApp or operator may prepare one safe execution request that results in a grouped transaction set containing:

1. A `pay` transaction funding or paying a target account
2. An `axfer` transaction moving an ASA or satisfying an opt-in/transfer requirement
3. An `appl` transaction calling a target application or the Algo Safe approval method
4. A `keyreg` transaction registering or updating participation status

Before any approval app call is signed, the frontend must show the exact ordered payload. This matters because signers approve the canonical payload that will be converted into inner transactions. If the payload changes, approvals must be collected again.

Required builder capabilities:

- Compose single-transaction and multi-transaction proposals
- Support `pay`, `axfer`, `appl`, `keyreg`, and asset configuration (`acfg`) from guided forms
- Support choosing a rekeyed-to-the-safe sending address for payments and asset transfers, defaulting to the safe's own address
- Build rekey proposals (safe migration to a new deployment, or releasing a rekeyed account) with explicit, unmistakable warnings about the transfer of control
- Bundle several app calls into one ordered Algo Safe approval flow for Ledger and other slow/manual signing devices
- Import unsigned transactions from JSON/base64 for advanced users (including native `algosdk.Transaction` conversion via the library)
- Decode and display application arguments, accounts, apps, assets, and boxes where possible
- Simulate or dry-run proposals before approval collection where supported
- Flag dangerous fields such as close remainder, asset close-to, rekey-to, app update/delete, and unknown receivers
- Validate network, fee, min-balance, opt-in, and round validity
- Persist drafts locally until submitted as proposals
- Rebuild stale transaction groups with fresh suggested params before final signing

---

## Frontend Product Requirements

The frontend should be robust enough for real custody operations. It must not be just a connect-wallet button and contract-call demo.

Every screen below is implemented strictly on top of the `algo-safe` npm library: each action maps to a library method, and the frontend never talks to the contract or builds transactions directly.

### 1. Landing / Safe Selector

Purpose: Let users find or create a safe immediately.

Content and actions:

- Connect wallet
- Select network
- Show safes related to the active wallet
- Import safe by app ID
- Create new safe
- Show pending proposals requiring this wallet's approval app call
- Show clear empty, loading, disconnected, and wrong-network states

### 2. Wallet Connection Screen

Purpose: Provide dependable wallet onboarding.

Requirements:

- Use `@txnlab/use-wallet` as the wallet abstraction
- Hand the active address and `TransactionSigner` to the `algo-safe` library; never sign or build transactions in the frontend directly
- Support LocalNet/KMD for development
- Support major Algorand wallets for public networks
- Support WalletConnect-capable flows where the selected provider requires them
- Show active account, wallet provider, network, and balance
- Handle account switching without losing app state
- Block signing when wallet network and app network differ
- Explain rejected approval signing, disconnected wallet, and unsupported provider states in plain language

### 3. Safe Dashboard

Purpose: Give operators a concise operational overview.

Content:

- Safe name, app ID, network, and controlled address
- ALGO balance and minimum balance
- ASA balances with asset IDs, names, decimals, and opt-in status
- Pending proposals grouped by status
- Recent executed proposals
- Signer groups and thresholds
- Spending limit usage for the current day/month
- Warnings for stale proposals, failed simulations, low balance, or pending admin changes

### 4. Create Safe Flow

Purpose: Create a safe without requiring the user to understand contract deployment internals.

Steps:

1. Name the safe
2. Select network
3. Add initial admin accounts
4. Set admin threshold
5. Confirm initial policies
6. Review deployment and funding requirements
7. Sign deployment transactions
8. Show success state with app ID and safe address

Validation:

- Threshold must be between 1 and group member count
- Duplicate accounts are blocked
- Invalid Algorand addresses are blocked
- Creator must understand whether they are part of at least one admin-privileged signer group

### 5. Signer Groups List

Purpose: Show all groups that can authorize safe actions.

Content:

- Group name
- Member count
- Threshold
- Policy summary
- Daily/monthly limit usage for the configured tracked asset
- Last change date
- Pending changes

Actions:

- Add signer group
- Open group detail
- Create proposal to edit group
- Disable or archive a group if policy allows

### 6. Add New Signer Group Flow

Purpose: Let admins define a new authority group.

Steps:

1. Enter group name and description
2. Add member accounts by address, wallet contact, or pasted list
3. Assign display labels to accounts
4. Set threshold
5. Configure limits and allowed action types
6. Review the policy effect
7. Submit as an admin proposal
8. Collect admin approvals
9. Execute after threshold is met

Important UX details:

- Adding a signer group should itself be a governed safe action
- The UI must show whether the connected wallet can propose or approve the change
- The UI should warn when a group has too much authority, such as 1-of-1 admin control

### 7. Signer Group Detail

Purpose: Manage one group clearly.

Content:

- Group metadata
- Members with labels, addresses, and approval activity
- Threshold and policy limits
- Actions allowed for the group
- Pending member additions/removals
- Audit history for the group

Actions:

- Add account to group
- Remove account from group
- Change threshold
- Rename group
- Change spending limits
- Change allowed action types

### 8. Add Account To Signer Group Flow

Purpose: Add a new signer safely.

Steps:

1. Open signer group detail
2. Choose **Add account**
3. Select the account type (standard, multisig, rekeyed, agent, or quantum-secure)
4. Enter the Algorand address for the signer, including the native Algorand address representing a Falcon identity for a quantum-secure account, and optional label
5. Validate address/key format and duplicates
6. Show impact on threshold, quorum, and policy
7. Submit change as a proposal
8. Collect required admin approvals
9. Execute change
10. Show updated group state

Safety requirements:

- Do not silently add an account with admin power
- Warn if adding the account makes a low-threshold group too powerful
- Show whether the new account needs to connect once to verify ownership, if that verification is required by the product policy
- For a quantum-secure account, capture and verify the native Algorand address that represents the Falcon identity so future approvals can be checked on-chain

### 9. Remove Account From Signer Group Flow

Purpose: Remove compromised, retired, or replaced signers without breaking the safe.

Steps:

1. Open signer group detail
2. Choose the account to remove
3. Show effect on group size and threshold
4. Block removal if the remaining member count would be below threshold, unless threshold is changed in the same proposal
5. Show any proposals currently waiting for that signer
6. Submit removal as an admin proposal
7. Collect required approvals
8. Execute change
9. Show updated group state and audit entry

Safety requirements:

- Warn when removing the last active admin
- Warn when removing the connected wallet's own account
- Support bundled member removal plus threshold adjustment
- Consider a timelock for high-risk admin removals

### 10. Proposal Builder

Purpose: Create safe actions from guided workflows.

Proposal types:

- Send ALGO (from the safe or a rekeyed address)
- Send ASA (from the safe or a rekeyed address)
- Opt in to ASA
- Call application
- Register participation keys
- Create / reconfigure / destroy ASA (asset config)
- Rekey the safe or release a rekeyed account
- Build custom atomic group
- Onramp EUR to EURD (Quantoz)
- Offramp EURD to EUR (Quantoz)
- Add signer group
- Edit signer group
- Add signer
- Remove signer
- Change threshold
- Change policy limits
- Change group privileges / activate / deactivate group

Required states:

- Draft
- Simulation pending
- Simulation failed
- Ready for approvals
- Waiting for approvals
- Ready to execute
- Executed
- Expired
- Cancelled
- Failed on-chain

### 11. Proposal Detail And Approval Screen

Purpose: Let each signer inspect and approve with confidence.

Content:

- Human summary of the requested action
- Approval progress and missing signers
- Full transaction group preview
- Per-transaction decoded details
- Fees and fee payer
- Network and valid round range
- Simulation result
- Policy checks passed/failed
- Raw transaction export

Actions:

- Approve by signing the app call
- Reject
- Comment or attach reason
- Copy proposal link
- Download unsigned/signed transaction data
- Execute when threshold is met

### 12. Co-Signing Queue

Purpose: Give signers a focused worklist.

Content:

- Proposals waiting for the active wallet
- Risk level and transaction type summary
- Expiration
- Requested signer group
- Approval progress

Actions:

- Batch-open proposals
- Sign one proposal at a time
- Reject with reason
- Filter by safe, group, type, and risk

### 13. Activity And Audit Log

Purpose: Make custody history reviewable.

Content:

- Created proposals
- Approval app calls recorded
- Executed transaction IDs
- Failed attempts
- Signer group changes
- Policy changes
- Wallet/account labels changes

Filters:

- Date
- Transaction type
- Signer group
- Account
- Status
- Asset
- Application ID

### 14. Settings And Network Tools

Purpose: Handle operational configuration.

Content:

- Network selection
- App ID configuration
- Indexer/algod status
- Wallet provider status
- Safe metadata
- Address book
- Asset allowlist
- dApp allowlist
- Notification preferences
- Export/import configuration

---

## Robustness Requirements

Algo Safe must treat signing as a high-stakes workflow.

The frontend should handle:

- Wallet disconnects during signing
- Account changes after a proposal is opened
- Wrong network or wrong genesis hash
- Stale suggested params and expired rounds
- Indexer lag after execution
- Duplicate submissions
- Partially approved proposals
- Wallets that sign only subsets of a group
- Mobile deep-link return flows
- User rejection of one transaction in a group
- App call failures due to missing boxes, accounts, apps, or assets
- ASA opt-in and minimum-balance failures
- Fee pooling and insufficient balance
- Dangerous transaction fields such as `rekeyTo`, `closeRemainderTo`, and asset close-out

The UI should never ask users to sign an opaque blob without a decoded explanation and a raw-details escape hatch.

---

## AI Agent And Automation Use Cases

Algo Safe is designed for both human signers and automated agents.

Agent use cases:

- Pay API providers, compute providers, or data services up to a daily cap
- Execute recurring operational payments
- Maintain small working balances for automation
- Trigger dApp interactions within allowlisted contracts
- Request escalation when a transaction exceeds its policy

Agent rules should be visible and enforceable:

- Allowed receivers
- Allowed assets
- Allowed application IDs
- Daily and monthly budgets
- Maximum transaction amount
- Required human approval for exceptions

---

## Quantum-Secure Direction

Quantum-secure signing is a first-class capability, not just a roadmap item. Users can add a **quantum-secure account** to any signer group today (see Account Types), and the frontend treats signer type as metadata plus an on-chain verification rule so post-quantum and classical signers share the same safe experience.

Supported signer types:

- Normal Algorand (Ed25519) wallet signer
- Multisig or rekeyed operational account
- Agent-controlled account with strict policy limits
- Quantum-secure (Falcon / post-quantum) account verified on-chain (for example via the AVM `falcon_verify` opcode)

Because account type is captured as metadata and a verification rule, a single safe can mix classical and post-quantum signers, and future post-quantum schemes can be added without changing the core safe UX.

---

## Research Anchors

This product direction follows Algorand-native patterns:

- Algorand atomic transaction groups are protocol-level all-or-nothing groups where order matters; Algo Safe stores an ordered typed payload and executes it as an atomic inner transaction group.
- Algorand transaction types include payments, asset transfers, application calls, and key registration transactions, all of which matter for treasury and validator operations.
- Algorand applications are invoked through application call transactions and can expose ABI methods for frontend clients.
- `@txnlab/use-wallet` is the standard frontend wallet abstraction for Algorand dApps and supports modern React wallet integration patterns.

---

## Success Criteria

Algo Safe succeeds when an Algorand team can:

1. Create a safe from the frontend
2. Connect with their preferred wallet
3. Add signer groups and members through governed proposals
4. Prepare payment, ASA, app-call, key-registration, asset-configuration, and rekey actions without hand-writing transaction JSON
5. Review the exact typed payload and inner transaction group preview before signing
6. Collect approval app calls across multiple people and wallets
7. Execute only after policy and threshold requirements are met
8. Audit every important custody event after execution
9. Reuse the same `algo-safe` npm library that powers the frontend to build their own apps, scripts, and agents

The end state is a secure, legible, and Algorand-native safe that works for people, organizations, validators, and AI agents.
