# AlgoSafe Frontend Console — Design

**Date:** 2026-06-06
**Status:** Approved (design)
**Context:** Algorand x402 hackathon. Builds the **AlgoSafe agent-manager / treasury console** frontend from the provided Stitch screens (`docs/stitch_algosafe_agent_manager/`). A teammate builds the Algo Safe **smart contract** in parallel (the only "backend"); there is no separate backend server. The frontend talks to the contract (mocked for now) and to **Quantoz** (real APIs, with fallback).

## Goal

A navigable, polished React app inside `projects/algo-safe-frontend` that implements the four Stitch screens plus a proposal approval/blocked screen, wired to a typed service layer: **mock** for the contract side (swappable to the real ARC-56 client later) and **real Quantoz** for balances/funding/payments (with graceful mock fallback). It must demo the agent-governance story end-to-end (register agent → appears → set policy → agent payment blocked → human approves).

## Non-goals (out of scope)

- Real on-chain contract calls — mocked behind `SafeService`; teammate's contract swaps in later.
- Real EURD movement / mainnet money / KYC / address whitelisting — UI flows only.
- The x402 weather shop (separate project, `projects/algo-safe-x402-shop`).
- Strict "frontend only via the `algo-safe` npm library" boundary from PRODUCT-DESCRIPTION — we call services directly now; the library can wrap them later.
- Exhaustive test coverage — pragmatic hackathon testing only.

## Where it lives

Inside the existing `projects/algo-safe-frontend` (React 18 + Vite + Tailwind + use-wallet-react + algokit-utils). Keep `App.tsx`'s wallet config and `main.tsx`. Replace the AlgoKit demo (`Home.tsx`, `components/AppCalls.tsx`, `components/Transact.tsx`) with the routed console; keep `ConnectWallet.tsx` and `utils/network/`.

New dependencies: `react-router-dom`, `@tanstack/react-query`, Material Symbols web font (Stitch icons).

## App composition & routing

`main.tsx` → `App.tsx`: `QueryClientProvider` → `WalletProvider` (existing) → `ServiceProvider` (binds services into context) → `RouterProvider`.

Routes (all wrapped by `AppShell` via `<Outlet/>`):
```
/                 Dashboard (Treasury Overview)
/agents           Agent Policies (fleet + policy config)
/agents/register  Register AI Agent
/proposals/:id    Proposal Detail (approval / blocked)
/fund             Fund with EURD (wizard)
```
`AppShell` = left `Sidebar` (Dashboard / Assets / Agents / Proposals / Settings) + `TopBar` (network toggle Mainnet/Testnet/LocalNet, notifications, Connect Wallet). `Assets`/`Settings` nav items may route to lightweight placeholders (not in scope to build fully).

## Service layer (architecture A)

Two typed interfaces; screens consume them only through React Query hooks and never know mock vs real.

```
services/
  types.ts                  Safe, Agent, Policy, Proposal, Balance, Transaction, FundingSession
  SafeService.ts            interface — contract side
  mock/safeMock.ts          STATEFUL in-memory impl (seeded)
  quantoz/QuantozService.ts interface — Quantoz side
  quantoz/quantozClient.ts  REAL impl (MCP/REST + X-API-KEY)
  quantoz/quantozMock.ts    fallback (no key / call fails)
  index.ts                  binds Safe=mock; Quantoz = key ? client : mock
hooks/    useAgents, useProposals, useBalances, useTransactions, useFunding (React Query)
lib/      store (in-memory), env, format
```

`SafeService` (mock now): `getSafe()`, `listAgents()`, `registerAgent()`, `getAgentPolicy()`, `updatePolicyProposal()`, `listProposals()`, `getProposal(id)`, `approveProposal(id)`, `rejectProposal(id)`, `executeProposal(id)`.

`QuantozService` (real + fallback): `getBalance(accountCode?)`, `listAccounts()`, `getTransactions(accountCode)`, `getFundByBankCountries()`, `getFundByBankBanks(countryCode)`, `createFundByBankSession(args)`, `getFundByBankSessionStatus(ref)`.

**Data flow:** component → React Query hook → service → (in-memory store | live Quantoz). Mutations invalidate queries so the UI updates live (register→appears, approve→executed).

**Mock→real swap:** one line in `services/index.ts` — replace `safeMock` with a `safeClient` implementing the same `SafeService` against the teammate's generated ARC-56 client. No screen changes.

## Quantoz integration (real)

Quantoz is an **MCP server** at `https://mcp.ai.quantozpay.com/mcp` (header `X-API-KEY`) plus REST endpoints. `quantozClient.ts` calls it with `VITE_QUANTOZ_API_KEY`. Tools used:
- Accounts: `get_account_balance`, `list_accounts`.
- Funding (the Fund screen): `get_fund_by_bank_countries` → `get_fund_by_bank_banks(countryCode)` → `create_fund_by_bank_session(countryCode, bankId, amount≥5, redirectUrl, accountCode)` → bank redirect → `get_fund_by_bank_session_status(sessionReference)`.
- Transactions: `get_transactions(accountCode)` (Dashboard recent activity, 24h volume).

Known compromises (documented in the UI/README): the API key ships in the browser (no backend); real EURD funding requires mainnet + KYC, so funding is demoed with the real call path but mock fallback when no key. When falling back, the UI shows a visible "demo data" chip.

## Screens

**1. Dashboard (`/`).** Safe identity (`SafeService` mock); EURD balance (`QuantozService` real→fallback); ALGO balance (algod via algokit-utils on connected network, else mock); Recent Transaction Proposals table with statuses (Pending Signatures n/m, Executed, Draft) from `SafeService`. CTAs: Register Agent, Fund with EURD, Create Proposal.

**2. Register AI Agent (`/agents/register`).** Form: cryptographic identity (Algorand address, alias, operational purpose), authorization policy (attach to existing group vs. isolated sub-group, tier/threshold, "Policy applied: Max X EURD/24h"). Static right rail (Architecture Context, x402 Compliance). Submit → `SafeService.registerAgent()` → agent appears in `/agents` + a Draft proposal on Dashboard.

**3. Agent Policies (`/agents`).** Stat cards (active agents, 24h volume, governance); Deployed Agents table; Policy Configuration panel (daily/monthly limits, velocity & cooldown, destination allowlist, "multi-sig required to change"). 24h volume may use `QuantozService.getTransactions()`. `Propose Changes` → governed proposal (mock) → routes to its Proposal Detail.

**4. Fund with EURD (`/fund`).** Wizard adapted to the real Quantoz flow: country → bank → amount (min €5) → `create_fund_by_bank_session` → redirect to bank → return → `get_fund_by_bank_session_status`. Keeps "minted 1:1 as EURD / Regulated by Quantoz Payments B.V." framing. No key → mock confirmation + demo-data chip.

**5. Proposal Detail — approval / blocked (`/proposals/:id`).** Human summary, transaction-group preview, approval progress (M-of-N), policy checks passed/failed, Approve / Reject / Execute. **Blocked state:** an agent payment over its daily EURD limit renders "⛔ Blocked — over daily limit → requires admin approval" with escalation; approving flips Pending→Executed live. This is the pitch's Beat 4.

## Design system

Extract tokens from the Stitch screens into the Tailwind config: light slate background, white cards, indigo/blue primary, slate text scale, `rounded-xl`, soft borders, Inter-style sans; **Material Symbols** icons. Stitch screens are hand-rolled Tailwind (not daisyUI), so build shared primitives to match and stop using daisyUI for these views (leave it installed): `Card`, `StatCard`, `StatusBadge`, `DataTable`, `Stepper`, `Toggle`, `Button`, `FormField`, `Sidebar`, `TopBar`. The Stitch PNG/HTML in `docs/stitch_algosafe_agent_manager/` are the visual source of truth. **Use the `frontend-design` skill during implementation** for the polish pass (spacing, typography, accessible states) — faithful to Stitch, not net-new aesthetics.

## States & error handling

React Query `isLoading` → skeletons; `isError` → `notistack` toasts (already present). Per-screen empty states; Connect-Wallet gate in the shell; network-mismatch warning on the toggle. Quantoz fallback is explicit (mock data + visible "demo data" chip, never silently fake).

## Demo statefulness

In-memory store seeded with realistic data matching the Stitch screens (Alpha Fund Multisig, €2.45M EURD, the three agents, sample proposals). Mutations persist for the session; query invalidation drives live updates. Resets on page reload.

## Testing (pragmatic)

Existing Jest: `SafeService` mock behaves (register adds agent; approve flips status), `QuantozService` falls back without a key, key screens render from the seeded store. One optional Playwright happy-path (register agent → see it on Dashboard) via the project's existing Playwright. No exhaustive coverage.

## File structure

```
src/
  App.tsx                  providers + router (modified)
  main.tsx                 unchanged
  routes.tsx
  layout/   AppShell, Sidebar, TopBar
  pages/    DashboardPage, RegisterAgentPage, AgentPoliciesPage, FundEurdPage, ProposalDetailPage
  components/  Card, StatCard, StatusBadge, DataTable, Stepper, Toggle, Button, FormField, ...
  services/ types, SafeService, mock/safeMock, quantoz/{QuantozService,quantozClient,quantozMock}, index
  hooks/    useAgents, useProposals, useBalances, useTransactions, useFunding
  lib/      store, env, format
  (remove) Home.tsx, components/AppCalls.tsx, components/Transact.tsx
  (keep)   components/ConnectWallet.tsx, utils/network/, components/ErrorBoundary.tsx
```

## Mock vs real (summary)

| Real now | Mocked now (swap later) |
|---|---|
| Quantoz balances, funding, transactions (key + fallback) | Contract: safe, agents, policies, proposals (`SafeService`) |
| Wallet connect, ALGO balance (algod) | Agent registration, approvals, policy changes |

## Notes

- No push to any remote without explicit instruction (CLAUDE.md).
- `docs/` is globally gitignored on this machine; this spec is intentional and force-added.
