# AlgoSafe Console v2 — Frontend Reimplementation Design

**Date:** 2026-06-06
**Status:** Approved (design), pending spec review
**Supersedes the screen set of:** `2026-06-06-algosafe-frontend-console-design.md`

## Goal

Reimplement the AlgoSafe frontend (`projects/algo-safe-frontend`) against the **new sample screen set** in `projects/algo-safe-samplescreens/`, applying the dark "Midnight Navy" design system, while reusing the existing mock service layer (no real-contract wiring in this scope).

## Decisions (locked)

1. **Scope:** the 6 new sample screens only. Drop the standalone `AgentPoliciesPage` and `FundEurdPage`; their function folds into Register Agent (inline policy preview) and Assets (Add Funds / Buy EURD), respectively.
2. **Theme:** dark "Midnight Navy" (`projects/algo-safe-samplescreens/algo_safe/DESIGN.md`). The stray light "Institutional Treasury Console" design system is *not* used.
3. **Data layer:** reuse the existing typed `SafeService`/`QuantozService` mock + React Query. Pure UI rebuild; real `AlgoSafeClient`/live-Quantoz wiring stays a separate later task.

This is an **in-place** rebuild in `projects/algo-safe-frontend` so the existing Vercel deployment continues to work unchanged.

## What is reused vs. replaced

**Reused as-is (logic), restyled (visuals):**
- `services/` layer pattern: mock `SafeService` (`mock/safeMock.ts`) + `QuantozService` (`quantoz/*`) with graceful fallback + "demo data" chip. Binding in `services/index.ts`.
- `hooks/` (React Query wrappers).
- `App.tsx` provider stack (QueryClient → Snackbar → Wallet → Service → Router).
- Wallet/network plumbing (`utils/network`, `interfaces/network.ts`, `lib/env.ts`, `components/ConnectWallet.tsx`, `Account.tsx`, `ErrorBoundary.tsx`).
- UI primitives in `components/ui/`: `Card`, `DataTable`, `StatCard`, `Stepper`, `Toggle`, `Button`, `FormField`, `StatusBadge`, `Icon`, `DemoDataChip`, `Skeleton` — kept, restyled for dark.

**Replaced:**
- All `pages/` (new screen set).
- `layout/` chrome (`AppShell`, `Sidebar`, `TopBar`) — now two shells (pre-safe, console).
- `routes.tsx` (new IA below).
- `tailwind.config.js` (light → dark Midnight Navy).
- `lib/store.ts` seed (single safe → multiple safes + asset/treasury seed).
- `index.css` / `index.html` (dark base, JetBrains Mono).

**Removed:**
- `pages/AgentPoliciesPage.tsx`, `pages/FundEurdPage.tsx`, `pages/Placeholder.tsx`.

## Information architecture (routes)

Two shells: a **pre-safe shell** (no sidebar) and an **in-safe console shell** (sidebar + top bar with safe switcher).

| Route | Screen (source folder) | Shell |
|---|---|---|
| `/` | Safe Selection (`algo_safe_selection`) | pre-safe |
| `/initialize` | Initialize Smart Account (`initialize_smart_account`) | pre-safe |
| `/safe/:safeId` | Agent Dashboard (`agent_economy_dashboard`) | console |
| `/safe/:safeId/agents/register` | Register AI Agent (`register_ai_agent`) | console |
| `/safe/:safeId/proposals` | Transaction Proposals — list (`transaction_proposals`) | console |
| `/safe/:safeId/proposals/:id` | Proposal Detail (retained from v1, restyled) | console |
| `/safe/:safeId/assets` | Treasury Assets (`treasury_assets`) | console |

**Console sidebar nav:** Dashboard · Proposals · Assets. **Top bar:** safe switcher (returns to `/`), connect-wallet, demo-data chip. **Primary action:** "+ Register Agent" (top bar / dashboard) → register route.

Legacy v1 routes (`/agents`, `/fund`, `/proposals/:id` at root, `/settings`) are removed/redirected to `/`.

## Data model extensions (mock, in `services/types.ts`)

New types:

```ts
export type SafeTier = string // e.g. "2-of-3 Multisig"
export interface SafeSummary {
  safeId: string
  name: string
  appId: number
  address: string
  tier: SafeTier
  totalValueEur: number
  agentCount: number
  status: 'active' | 'paused'
}

export type AssetHoldingType = 'native' | 'stablecoin' | 'lending'
export interface AssetHolding {
  symbol: AssetSymbol
  name: string          // "Algorand Native", "EURD"
  assetId?: number
  amount: number        // human units
  valueEur: number
  type: AssetHoldingType
  apy?: number          // for lending positions
}

export interface TreasurySummary {
  totalValueEur: number
  availableAlgo: number
  availableEurd: number
}

export interface CreateSafeInput {
  name: string
  threshold: number
  signerCount: number
  initialDepositEurd: number
}
```

`SafeService` interface additions:

```ts
listSafes(): Promise<SafeSummary[]>
getSafe(safeId: string): Promise<Safe>      // now parameterized
createSafe(input: CreateSafeInput): Promise<SafeSummary>
listAssets(safeId: string): Promise<AssetHolding[]>
getTreasury(safeId: string): Promise<TreasurySummary>
```

Existing agent/proposal/policy methods remain; for the demo they operate on the currently-selected safe (the mock keeps a single shared agent/proposal set — acceptable for a demo, documented as such).

**Store reseed (`lib/store.ts`):** two `SafeSummary` entries — "Cold Storage A" and "Governance Treasury" — a `currentSafeId`, an `assets[]`/`treasury` seed (ALGO native, EURD stablecoin, one Active-Lending position), keeping the existing agents/policies/proposals demo set (including blocked proposal `0043`).

**Safe context:** a small `SafeContext` (or route-param resolver) exposes the active `safeId` to console pages and feeds React Query keys (e.g. `['safe', safeId]`, `['assets', safeId]`).

New hooks: `useSafes`, `useSafe(safeId)`, `useCreateSafe`, `useAssets(safeId)`, `useTreasury(safeId)`.

## Theming

Port `algo_safe/DESIGN.md` tokens into `tailwind.config.js` `theme.extend.colors` (semantic names matching the screens' Tailwind config), key values:

- `background` `#0b1326`, `on-background` `#dae2fd`
- surface tonal ramp: `surface-container-lowest` `#060e20` → `surface-container-highest` `#2d3449`
- `primary` (Algorand teal) `#71ffec`, `on-primary` `#003732`, `primary-container` `#00e5d1`
- `secondary` (EURD blue) `#b8c4ff`, `secondary-container` `#004bf9`
- `outline` `#849490`, `outline-variant` `#3b4a47`
- `error` `#ffb4ab`, `error-container` `#93000a`

Typography: Inter (UI) + **JetBrains Mono** (addresses, tx hashes, technical metadata, status labels in all-caps `label-md`). Add the JetBrains Mono `<link>` to `index.html`; extend `fontFamily.mono`. Material Symbols already loaded.

Conventions from DESIGN.md: 1px solid border (`outline-variant`) on every card/interactive element; tonal layering instead of drop shadows; rounded-sm (4px) inputs/buttons, rounded-md (8px) cards, full-round status pills; focus ring transitions to teal.

`index.css`: set base `body { background: #0b1326; color: #dae2fd }` and remove the daisyUI `lofi` light theme (switch to a dark daisyUI theme or drop daisyUI usage in new components).

## New components (`components/ui/` or `components/`)

- `AgentStatusCard` — agent name, status **pulse** indicator (teal active / amber paused / red error) + `code-sm` heartbeat timestamp + daily-limit gauge.
- `AssetRow` — direction/type icon, asset name + `assetId` in mono, amount (`headline-sm`), EUR value, row actions.
- `SafeCard` — safe name, tier, value, agent count, status; click → `/safe/:safeId`.
- `ProposalRow` — status pill, title, consensus `n/threshold`, action button (Approve / Execute / view).
- `PolicyLogicBlock` — `[Condition] + [Action] + [Signers]` block used in Register Agent's policy preview.
- `TransactionPreview` — inbound/outbound indicator, prominent amount, "Verify on Explorer" link.

## Screen detail notes

- **Safe Selection:** grid of `SafeCard`s from `listSafes()`; "Create New Safe" → `/initialize`; "Import Existing Account" → modal/no-op (demo); an "Active Protocol Preview" info panel (static, as drawn).
- **Initialize Smart Account:** reuse `Stepper` — Connect Wallet → Contract Deployment (shows estimated gas, static) → Initial Funding (deposit amount). On finish, `createSafe()` then navigate to `/safe/:safeId`.
- **Agent Dashboard:** `AgentStatusCard`s, daily-spending gauges, activity log, live block-height ticker (mock increment), "Demo Environment" chip.
- **Register AI Agent:** identity form (name, Algorand address, purpose) + `PolicyLogicBlock` preview reflecting daily limit / condition / action; submit → `registerAgent()` (creates a pending proposal, existing behavior) → back to dashboard.
- **Transaction Proposals:** sections Action Required / Awaiting You / Completed; consensus + avg-consensus stats; row → detail; Approve/Execute via existing mutations.
- **Treasury Assets:** total value header, `AssetRow` table (ALGO / EURD / Active Lending), Add Funds + Buy EURD modal that calls the existing Quantoz mock funding flow.

## Quality gates (no CI test suite, per prior preference)

- `pnpm run check-types` clean.
- `pnpm run build` (tsc + vite) clean.
- Manual/Playwright **smoke** of all routes + happy paths: select safe → dashboard → register agent → proposals (approve + view blocked `0043`) → assets (add funds). Not wired to CI.
- Existing unit tests (`safeMock.test.ts`, `quantoz.test.ts`, `ellipseAddress.spec.tsx`) updated to compile against the new types; no new committed CI tests.

## Out of scope

- Real `AlgoSafeClient` wiring / on-chain deploy (separate task).
- Live Quantoz (mainnet + KYC; stays in fallback/demo mode).
- Standalone policy-editor and full iDEAL funding wizard (folded inline / dropped).
- Multi-safe data isolation in the mock (shared agent/proposal set is acceptable for the demo).
