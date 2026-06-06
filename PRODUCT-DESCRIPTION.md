# Algo Safe

**A policy-driven smart account for Algorand teams, treasuries, builders, validators, and AI agents.**

Algo Safe is an on-chain safe for Algorand: a wallet-like smart account controlled by configurable signer groups, spending rules, and transparent transaction proposals. It is inspired by the operational safety of products like Safe on EVM chains, but designed around Algorand-native primitives: fast finality, atomic transaction groups, application calls, Algorand Standard Assets, participation key management, and wallet signing through the Algorand wallet ecosystem.

The goal is simple: make it easy for humans and automated agents to prepare, review, co-sign, and execute authorized Algorand actions without forcing users to reason directly about raw transaction bytes.

---

## Why Algorand Users Need This

Algorand already supports powerful transaction composition, but the user experience for shared custody is still too manual for many real teams. Treasury operators, DAOs, startups, validators, payment agents, and protocol maintainers need a frontend that turns low-level Algorand concepts into safe workflows.

Common needs:

- **Shared custody without operational chaos**: Teams need M-of-N approval, clear roles, and a reliable way to rotate members without moving funds to a new account each time.
- **Wallet compatibility**: Users should connect with familiar Algorand wallets through `@txnlab/use-wallet`, including Pera, Defly, Exodus, Daffi, LocalNet/KMD, and WalletConnect-capable providers where supported.
- **Atomic transaction clarity**: Algorand transaction groups are all-or-nothing. Users need to see the exact ordered group before signing, including payments, ASA transfers, application calls, and key registration transactions.
- **Application-call-first UX**: dApps often need the safe to authorize a single high-level action that expands into a complete atomic group. The UI should let a user prepare one safe execution request, then review the resulting group before collecting signatures.
- **ASA-aware treasury management**: Teams hold ALGO and many ASAs. The safe must show asset balances, opt-in requirements, decimals, metadata, and receiver readiness.
- **Validator and governance operations**: Algorand accounts may need key registration (`keyreg`) and governance-related actions. These should be approvable through the same policy flow as payments.
- **Agentic payments with limits**: AI agents and automation services need constrained budgets. Humans should be able to delegate low-risk spending while keeping high-risk actions behind stricter signer groups.
- **Failure-resistant signing**: Signers may use different wallets, devices, and networks. The frontend must recover from disconnects, stale rounds, rejected signatures, indexer lag, and partially collected approvals.

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

A signer group is a named set of accounts with an approval threshold.

Examples:

| Group | Members | Threshold | Purpose |
| --- | --- | --- | --- |
| Admins | 5 human accounts | 3-of-5 | Safe configuration, upgrades, high-value transactions |
| Treasury | 3 finance operators | 2-of-3 | Recurring operational payments and ASA transfers |
| Validator Ops | 2 operators | 2-of-2 | Key registration and participation-key actions |
| Agent | 1 automation account | 1-of-1 | Low-value automated payments within daily limits |

Signer groups must be first-class objects in both the contract model and the frontend. Users should never have to infer group state from raw addresses.

### Spending And Action Policies

Policies determine what a signer group can approve.

Policy examples:

- Daily ALGO limit per signer group
- Monthly ALGO limit per signer group
- Per-ASA transfer limits
- Allowed receiver lists for agent spending
- Required admin approval for unknown receivers
- Required admin approval for `keyreg`, application update/delete, close-out, or large ASA transfers
- Cooldown period for signer removal or threshold changes

### Transaction Proposals

A proposal is a human-readable request to execute one or more Algorand transactions.

Every proposal must show:

- Proposal title and purpose
- Requested signer group
- Current approval progress
- Required threshold
- Exact transaction group preview
- Human-readable effects
- Raw transaction details for advanced users
- Simulation result where available
- Expiration round or time
- Network and genesis hash

---

## Supported Algorand Actions

Algo Safe should support the actions Algorand users actually need, starting with these core transaction types:

- **Payment (`pay`)**: Send ALGO, fund accounts, pay service providers, close accounts only when explicitly allowed.
- **Asset transfer (`axfer`)**: Send ASAs, opt in to assets, opt out of assets, and handle ASA decimals safely.
- **Application call (`appl`)**: Call dApps, governance contracts, DeFi protocols, and the Algo Safe contract itself.
- **Key registration (`keyreg`)**: Register participation keys, go online/offline, and manage validator participation workflows.

Algorand atomic groups may contain a mix of transaction types. The frontend must make that power understandable instead of hiding it.

---

## Transaction Builder UX

The transaction builder is the most important part of the product.

Users should be able to prepare a single high-level safe action, then have the frontend assemble and display the exact Algorand atomic group that will be signed and submitted.

For example, a dApp or operator may prepare one safe execution request that results in a grouped transaction set containing:

1. A `pay` transaction funding or paying a target account
2. An `axfer` transaction moving an ASA or satisfying an opt-in/transfer requirement
3. An `appl` transaction calling a target application or the Algo Safe approval method
4. A `keyreg` transaction registering or updating participation status

Before any wallet signature is requested, the frontend must show the exact ordered group. This matters because Algorand signers approve a group ID derived from the ordered transaction set. If the group changes, signatures must be collected again.

Required builder capabilities:

- Compose single-transaction and multi-transaction proposals
- Support `pay`, `axfer`, `appl`, and `keyreg` from guided forms
- Import unsigned transactions from JSON/base64 for advanced users
- Decode and display application arguments, accounts, apps, assets, and boxes where possible
- Simulate or dry-run proposals before signature collection where supported
- Flag dangerous fields such as close remainder, asset close-to, rekey-to, app update/delete, and unknown receivers
- Validate network, fee, min-balance, opt-in, and round validity
- Persist drafts locally until submitted as proposals
- Rebuild stale transaction groups with fresh suggested params before final signing

---

## Frontend Product Requirements

The frontend should be robust enough for real custody operations. It must not be just a connect-wallet button and contract-call demo.

### 1. Landing / Safe Selector

Purpose: Let users find or create a safe immediately.

Content and actions:

- Connect wallet
- Select network
- Show safes related to the active wallet
- Import safe by app ID
- Create new safe
- Show pending proposals requiring this wallet's signature
- Show clear empty, loading, disconnected, and wrong-network states

### 2. Wallet Connection Screen

Purpose: Provide dependable wallet onboarding.

Requirements:

- Use `@txnlab/use-wallet` as the wallet abstraction
- Support LocalNet/KMD for development
- Support major Algorand wallets for public networks
- Support WalletConnect-capable flows where the selected provider requires them
- Show active account, wallet provider, network, and balance
- Handle account switching without losing app state
- Block signing when wallet network and app network differ
- Explain rejected signature, disconnected wallet, and unsupported provider states in plain language

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
- Creator must understand whether they are part of the admin group

### 5. Signer Groups List

Purpose: Show all groups that can authorize safe actions.

Content:

- Group name
- Member count
- Threshold
- Policy summary
- Daily/monthly limit usage
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
3. Enter Algorand address and optional label
4. Validate address format and duplicates
5. Show impact on threshold, quorum, and policy
6. Submit change as a proposal
7. Collect required admin signatures
8. Execute change
9. Show updated group state

Safety requirements:

- Do not silently add an account with admin power
- Warn if adding the account makes a low-threshold group too powerful
- Show whether the new account needs to connect once to verify ownership, if that verification is required by the product policy

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

- Send ALGO
- Send ASA
- Opt in to ASA
- Call application
- Register participation keys
- Build custom atomic group
- Add signer group
- Edit signer group
- Add signer
- Remove signer
- Change threshold
- Change policy limits

Required states:

- Draft
- Simulation pending
- Simulation failed
- Ready for signatures
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

- Approve/sign
- Reject
- Comment or attach reason
- Copy proposal link
- Download unsigned/signed group data
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
- Signatures collected
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
- Partially signed proposals
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

The long-term design should keep room for post-quantum signer support. The frontend should treat signer type as metadata and policy input so future signer schemes can fit into the same safe experience.

Potential signer types:

- Normal Algorand wallet signer
- Multisig or rekeyed operational account
- Agent-controlled account with strict policy limits
- Future post-quantum account or verification scheme

---

## Research Anchors

This product direction follows Algorand-native patterns:

- Algorand atomic transaction groups are protocol-level all-or-nothing groups where order matters and signers approve the exact group ID.
- Algorand transaction types include payments, asset transfers, application calls, and key registration transactions, all of which matter for treasury and validator operations.
- Algorand applications are invoked through application call transactions and can expose ABI methods for frontend clients.
- `@txnlab/use-wallet` is the standard frontend wallet abstraction for Algorand dApps and supports modern React wallet integration patterns.

---

## Success Criteria

Algo Safe succeeds when an Algorand team can:

1. Create a safe from the frontend
2. Connect with their preferred wallet
3. Add signer groups and members through governed proposals
4. Prepare payment, ASA, app-call, and key-registration actions without hand-writing transaction JSON
5. Review the exact atomic group before signing
6. Collect signatures across multiple people and wallets
7. Execute only after policy and threshold requirements are met
8. Audit every important custody event after execution

The end state is a secure, legible, and Algorand-native safe that works for people, organizations, validators, and AI agents.
