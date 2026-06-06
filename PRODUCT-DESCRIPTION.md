# Algo Safe

**The first quantum-secure, multi-signature smart account on Algorand — built for both humans and AI agents.**

Algo Safe is an on-chain wallet (smart account) that brings programmable, policy-driven custody to the Algorand blockchain. Think of it as [Gnosis Safe](https://safe.global/) for Algorand — but with native support for **post-quantum cryptography** and **agentic payments**.

---

## What is Algo Safe?

Algo Safe is a fully on-chain "safe" that can execute **any Algorand transaction type**:

- **Payments** (`pay`) — send ALGO
- **Asset transfers** (`axfer`) — send and receive ASAs
- **Application calls** (`appl`) — interact with any smart contract / dApp
- **Key registration** (`keyreg`) — participate in consensus / staking
- ...and every other transaction in an atomic group

Instead of a single private key controlling funds, an Algo Safe is governed by **configurable signer groups** and **spending policies**, giving organizations and autonomous agents bank-grade control over their assets.

---

## Core Concepts

### 🔐 Signer Groups (M-of-N)

A safe is controlled by one or more **signer groups**. Each group consists of **1 to N member accounts**, with a configurable **M-of-N threshold** — meaning at least **M signatures** are required to authorize and execute a transaction group.

Examples of groups within a single safe:

| Group | Members | Threshold | Purpose |
|-------|---------|-----------|---------|
| **Agent** | 1 (single MCP account) | 1-of-1 | Day-to-day automated payments |
| **Admins** | 5 multisig | 3-of-5 | High-value approvals, configuration changes |
| **Treasury** | 3 | 2-of-3 | Periodic large transfers |

### 🛡️ Quantum-Secured Accounts

Signer groups can be backed by **post-quantum cryptographic accounts**, protecting the safe against future quantum-computing attacks. If realized, this makes Algo Safe **the first secure multisig quantum account in the world** — and the first usable for **agentic (AI-driven) payments**.

### 💸 Spending Limits

Every signer group can be assigned **daily and monthly spending limits**. This lets you delegate authority safely:

- Give an **AI agent / MCP account** a low daily limit so it can transact autonomously without manual approval — but cap its exposure.
- Require the **admin multisig** to approve anything above the limit.
- Enforce **monthly budgets** per group at the protocol level, not by trust.

When a transaction would exceed a group's limit, it must be escalated to a higher-authority group (e.g. the admins) to be executed.

---

## Why Algo Safe?

- **Agentic-ready** — Purpose-built so AI agents (via MCP and similar protocols) can hold and spend funds within strict, on-chain-enforced limits.
- **Quantum-safe** — Future-proof custody using post-quantum signature schemes.
- **Universal tx support** — Not just payments: stake, swap, call contracts, and bundle it all atomically.
- **Granular control** — Mix human multisigs and machine accounts in the same safe, each with its own threshold and budget.
- **Trustless enforcement** — Thresholds and limits are enforced by on-chain smart contracts, not off-chain promises.
- **Familiar model** — The security model teams already know from Gnosis Safe, now on Algorand.

---

## Example Use Cases

- **Autonomous AI payments** — An MCP-controlled agent pays for compute, data, or services up to a daily cap, with humans only approving exceptions.
- **DAO / company treasury** — A multisig of admins governs funds, with quantum-secured keys for long-term safety.
- **Hybrid operations** — One safe runs both automated low-value flows and human-approved high-value flows side by side.
- **Staking & governance** — Register participation keys (`keyreg`) and vote, all under multisig control.

---

## Vision

Algo Safe aims to be the **default secure custody layer for Algorand** — combining the proven multisig security model of Gnosis Safe with **post-quantum protection** and **first-class support for the agentic economy**, where both people and AI can move money safely on-chain.
