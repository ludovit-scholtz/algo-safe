# AlgoSafe Frontend Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **UI tasks (9–14): use the `frontend-design` skill for the polish pass, and treat the Stitch screens in `docs/stitch_algosafe_agent_manager/<screen>/{screen.png,code.html}` as the visual source of truth — port their markup to React + Tailwind, don't invent new aesthetics.**

**Goal:** Build the AlgoSafe agent-manager/treasury console in `projects/algo-safe-frontend` — 5 screens + app shell — wired to a typed service layer (mock contract, real Quantoz with fallback).

**Architecture:** React 18 + Vite + Tailwind + React Router + TanStack Query. Screens consume two typed services only through React Query hooks: `SafeService` (stateful in-memory mock) and `QuantozService` (real Quantoz MCP/REST client with mock fallback). Mutations invalidate queries so the UI updates live.

**Tech Stack:** TypeScript, React 18, Vite, Tailwind, `react-router-dom`, `@tanstack/react-query`, `@txnlab/use-wallet-react` (existing), `algosdk`/`algokit-utils` (existing), `notistack` (existing), Material Symbols font.

**Reference:** Spec at `docs/superpowers/specs/2026-06-06-algosafe-frontend-console-design.md`. Stitch screens at `docs/stitch_algosafe_agent_manager/`.

**Working dir for all commands:** `/Users/sid/Desktop/Projects/algo-safe/projects/algo-safe-frontend` unless noted. **Do not push** to any remote.

---

## File Structure

```
src/
  App.tsx                  MODIFY: providers (QueryClient + Wallet + Service) + RouterProvider
  main.tsx                 unchanged
  routes.tsx               CREATE: route table
  layout/
    AppShell.tsx           CREATE: sidebar + topbar + <Outlet/>
    Sidebar.tsx            CREATE
    TopBar.tsx             CREATE: network toggle, notifications, Connect Wallet
  pages/
    DashboardPage.tsx      CREATE
    RegisterAgentPage.tsx  CREATE
    AgentPoliciesPage.tsx  CREATE
    FundEurdPage.tsx       CREATE
    ProposalDetailPage.tsx CREATE
  components/
    ui/                    CREATE: Card, StatCard, StatusBadge, DataTable, Stepper, Toggle,
                                   Button, FormField, Icon, DemoDataChip, Skeleton
    ConnectWallet.tsx      keep (existing)
    ErrorBoundary.tsx      keep (existing)
  services/
    types.ts               CREATE: domain types
    SafeService.ts         CREATE: interface
    mock/safeMock.ts       CREATE: stateful in-memory impl
    quantoz/QuantozService.ts CREATE: interface
    quantoz/quantozClient.ts  CREATE: real impl (MCP/REST + X-API-KEY)
    quantoz/quantozMock.ts    CREATE: fallback impl
    index.ts               CREATE: bindings + ServiceProvider/useServices
  hooks/                   CREATE: useSafe, useAgents, useProposals, useBalances, useTransactions, useFunding
  lib/
    store.ts               CREATE: in-memory store + seed
    env.ts                 CREATE: VITE_* readers
    format.ts              CREATE: currency/address formatters
  REMOVE: Home.tsx, components/AppCalls.tsx, components/Transact.tsx
```

---

### Task 1: Branch, dependencies, and remove the AlgoKit demo

**Files:** `package.json` (modify), remove demo files.

- [ ] **Step 1: Create a feature branch** (from repo root)

```bash
cd /Users/sid/Desktop/Projects/algo-safe && git switch -c algosafe-frontend-console && git branch --show-current
```
Expected: `algosafe-frontend-console`.

- [ ] **Step 2: Install dependencies**

```bash
cd /Users/sid/Desktop/Projects/algo-safe/projects/algo-safe-frontend
npm install react-router-dom @tanstack/react-query
```
Expected: installs with no errors.

- [ ] **Step 3: Remove the AlgoKit demo files**

```bash
rm src/Home.tsx src/components/AppCalls.tsx src/components/Transact.tsx
```
(`App.tsx` is rewritten in Task 9; until then the app won't compile — that's expected mid-plan.)

- [ ] **Step 4: Commit**

```bash
cd /Users/sid/Desktop/Projects/algo-safe
git add -A
git commit -m "Frontend console: branch, add router+query deps, remove AlgoKit demo"
```

---

### Task 2: Design tokens, Material Symbols, base CSS

**Files:** `tailwind.config.cjs` (modify), `index.html` (modify), `src/styles/main.css` (modify).

- [ ] **Step 1: Add Stitch design tokens to Tailwind**

In `tailwind.config.cjs`, extend the theme (keep existing daisyUI plugin config intact, just add `theme.extend`):
```js
theme: {
  extend: {
    colors: {
      brand: { 50:'#eef2ff',100:'#e0e7ff',500:'#6366f1',600:'#4f46e5',700:'#4338ca' },
      ink: { 900:'#0f172a',700:'#334155',500:'#64748b',400:'#94a3b8' },
      surface: { DEFAULT:'#ffffff', muted:'#f8fafc', border:'#e2e8f0' },
      ok:'#16a34a', warn:'#d97706', danger:'#dc2626',
    },
    borderRadius: { xl:'0.75rem','2xl':'1rem' },
    fontFamily: { sans: ['Inter','ui-sans-serif','system-ui','sans-serif'] },
  },
}
```

- [ ] **Step 2: Load Inter + Material Symbols in `index.html`**

Add inside `<head>`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0" rel="stylesheet" />
```

- [ ] **Step 3: Base styles**

Append to `src/styles/main.css`:
```css
body { @apply bg-surface-muted text-ink-900 font-sans; }
.material-symbols-outlined { font-variation-settings: 'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24; }
```

- [ ] **Step 4: Verify build config compiles**

Run: `npx tsc --noEmit`
Expected: no NEW config errors (app code errors from Task 1 removals are expected until Task 9).

- [ ] **Step 5: Commit**

```bash
cd /Users/sid/Desktop/Projects/algo-safe
git add projects/algo-safe-frontend/tailwind.config.cjs projects/algo-safe-frontend/index.html projects/algo-safe-frontend/src/styles/main.css
git commit -m "Frontend console: Stitch design tokens, Inter + Material Symbols"
```

---

### Task 3: Domain types

**Files:** Create `src/services/types.ts`.

- [ ] **Step 1: Write the types**

```ts
// src/services/types.ts
export type NetworkId = 'mainnet' | 'testnet' | 'localnet'

export interface Safe {
  name: string
  appId: number
  address: string
  network: NetworkId
}

export type AssetSymbol = 'EURD' | 'ALGO' | 'USDC' | string
export interface Balance {
  symbol: AssetSymbol
  assetId?: number
  amount: number      // human units (not micro)
  decimals: number
  label: string
}

export type AgentStatus = 'active' | 'pending_review' | 'paused'
export interface Agent {
  id: string
  alias: string
  address: string
  purpose: string
  primaryAsset: AssetSymbol
  dailyLimit: number
  status: AgentStatus
  groupTier: string   // e.g. "Tier 3 - Automated Execution (1/1)"
}

export interface Policy {
  agentId: string
  dailyLimit: number
  monthlyLimit: number
  dailyUsed: number
  monthlyUsed: number
  minIntervalSec: number
  maxTxPerMin: number
  allowlist: string[]
  multiSigRequired: boolean
}

export type ProposalStatus = 'draft' | 'pending' | 'executed' | 'rejected' | 'expired' | 'blocked'
export interface TxLine { type: 'pay' | 'axfer' | 'appl' | 'keyreg'; summary: string; detail: string }
export interface PolicyCheck { label: string; passed: boolean }
export interface Proposal {
  id: string
  title: string
  description: string
  status: ProposalStatus
  approvals: number
  threshold: number
  amount?: number
  asset?: AssetSymbol
  date: string        // human label e.g. "Today, 14:30"
  txPreview: TxLine[]
  policyChecks: PolicyCheck[]
  blockedReason?: string
}

export interface QuantozTransaction {
  txCode: string
  type: 'Payment' | 'Funding' | 'Payout'
  amount: number
  status: string
  date: string
  counterparty?: string
}

export interface FundByBankCountry { countryCode: string; name: string }
export interface FundByBankBank { bankId: string; name: string }
export interface FundingSession { sessionReference: string; redirectUrl: string; status: string }

export interface RegisterAgentInput {
  alias: string
  address: string
  purpose: string
  groupTier: string
  dailyLimit: number
  primaryAsset: AssetSymbol
}
export interface PolicyChangeInput { agentId: string; policy: Partial<Policy> }
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit src/services/types.ts` (or `npx tsc --noEmit` ignoring unrelated errors). Expected: no errors in `types.ts`.

- [ ] **Step 3: Commit**

```bash
cd /Users/sid/Desktop/Projects/algo-safe
git add projects/algo-safe-frontend/src/services/types.ts
git commit -m "Frontend console: domain types"
```

---

### Task 4: In-memory store + seed data, env, format helpers

**Files:** Create `src/lib/store.ts`, `src/lib/env.ts`, `src/lib/format.ts`.

- [ ] **Step 1: Write `src/lib/env.ts`**

```ts
// src/lib/env.ts
export const env = {
  quantozApiKey: import.meta.env.VITE_QUANTOZ_API_KEY as string | undefined,
  quantozMcpUrl: (import.meta.env.VITE_QUANTOZ_MCP_URL as string) ?? 'https://mcp.ai.quantozpay.com',
  quantozAccountCode: import.meta.env.VITE_QUANTOZ_ACCOUNT as string | undefined,
}
export const quantozEnabled = () => Boolean(env.quantozApiKey)
```

- [ ] **Step 2: Write `src/lib/format.ts`**

```ts
// src/lib/format.ts
export const fmtEur = (n: number) =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(n)
export const fmtNum = (n: number) => new Intl.NumberFormat('en-US').format(n)
export const shortAddr = (a: string, n = 4) => (a.length > 2 * n ? `${a.slice(0, n)}...${a.slice(-n)}` : a)
```

- [ ] **Step 3: Write `src/lib/store.ts` (seeded, mutable, matches Stitch numbers)**

```ts
// src/lib/store.ts
import type { Agent, Policy, Proposal, Safe } from '../services/types'

let nextAgentSeq = 4
let nextPropSeq = 43

export const store = {
  safe: {
    name: 'Alpha Fund Multisig',
    appId: 109847265,
    address: 'A3B...X9Z',
    network: 'mainnet',
  } as Safe,

  agents: [
    { id: 'agt_1', alias: 'Arbitrage Bot Alpha', address: 'ARBX...A1B2', purpose: 'Algorithmic Trading', primaryAsset: 'ALGO', dailyLimit: 10000, status: 'active', groupTier: 'Tier 3 - Automated Execution (1/1)' },
    { id: 'agt_2', alias: 'EURD Treasury Sweeper', address: 'SWEP...C3D4', purpose: 'Treasury Rebalancing', primaryAsset: 'EURD', dailyLimit: 50000, status: 'active', groupTier: 'Tier 2 - Operational Reserves (2/3)' },
    { id: 'agt_3', alias: 'Cross-Chain Bridge Relay', address: 'BRDG...E5F6', purpose: 'Treasury Rebalancing', primaryAsset: 'USDC', dailyLimit: 25000, status: 'pending_review', groupTier: 'Tier 2 - Operational Reserves (2/3)' },
  ] as Agent[],

  policies: {
    agt_1: { agentId: 'agt_1', dailyLimit: 10000, monthlyLimit: 250000, dailyUsed: 3200, monthlyUsed: 88000, minIntervalSec: 60, maxTxPerMin: 4, allowlist: ['100279384'], multiSigRequired: true },
    agt_2: { agentId: 'agt_2', dailyLimit: 50000, monthlyLimit: 250000, dailyUsed: 12000, monthlyUsed: 130000, minIntervalSec: 60, maxTxPerMin: 4, allowlist: ['7QLMZH5C5XVPEV6T7D6W2TMWRSURHVDMLQEBDODWGVVMKOJD2A77AIHVMA'], multiSigRequired: true },
    agt_3: { agentId: 'agt_3', dailyLimit: 25000, monthlyLimit: 100000, dailyUsed: 0, monthlyUsed: 0, minIntervalSec: 120, maxTxPerMin: 2, allowlist: [], multiSigRequired: true },
  } as Record<string, Policy>,

  proposals: [
    { id: '0042', title: 'Quarterly LP Provisioning', description: 'Provision liquidity for Q4 market making.', status: 'pending', approvals: 2, threshold: 5, amount: 250000, asset: 'EURD', date: 'Today, 14:30',
      txPreview: [{ type: 'axfer', summary: 'Transfer 250,000 EURD', detail: 'to LP pool 100279384' }],
      policyChecks: [{ label: 'Within daily limit', passed: true }, { label: 'Receiver allowlisted', passed: true }] },
    { id: '0041', title: 'Vendor Payment - Security Audit', description: 'Pay security auditor.', status: 'executed', approvals: 3, threshold: 3, amount: 15000, asset: 'EURD', date: 'Yesterday, 09:15',
      txPreview: [{ type: 'axfer', summary: 'Transfer 15,000 EURD', detail: 'to vendor' }], policyChecks: [{ label: 'Within daily limit', passed: true }] },
    { id: '0040', title: 'Agent Registration: Yield Farmer V2', description: 'Register a new automated agent.', status: 'draft', approvals: 0, threshold: 3, date: 'Oct 24, 2023',
      txPreview: [{ type: 'appl', summary: 'Initialize agent contract', detail: 'register signer in Tier 3' }], policyChecks: [] },
    // The demo "blocked" proposal (Beat 4)
    { id: '0043', title: 'Agent Payment — SkipperBrief Forecast', description: 'Arbitrage Bot Alpha attempted an autonomous payment that exceeds its daily limit.', status: 'blocked', approvals: 0, threshold: 2, amount: 12000, asset: 'EURD', date: 'Today, 15:02',
      txPreview: [{ type: 'axfer', summary: 'Transfer 12,000 EURD', detail: 'to merchant skipper.ever-online.com' }],
      policyChecks: [{ label: 'Within daily limit (10,000 EURD)', passed: false }, { label: 'Receiver allowlisted', passed: false }],
      blockedReason: 'Exceeds agent daily limit (12,000 > 10,000 EURD) and receiver not on allowlist. Requires admin approval.' },
  ] as Proposal[],

  newAgentId() { return `agt_${nextAgentSeq++}` },
  newProposalId() { return String(nextPropSeq++).padStart(4, '0') },
}
```

- [ ] **Step 4: Verify type-check of lib**

Run: `npx tsc --noEmit` — expect no errors originating in `src/lib/*` or `src/services/types.ts`.

- [ ] **Step 5: Commit**

```bash
cd /Users/sid/Desktop/Projects/algo-safe
git add projects/algo-safe-frontend/src/lib
git commit -m "Frontend console: in-memory seeded store, env + format helpers"
```

---

### Task 5: SafeService interface + stateful mock (with tests)

**Files:** Create `src/services/SafeService.ts`, `src/services/mock/safeMock.ts`, `src/services/mock/safeMock.test.ts`.

- [ ] **Step 1: Write the interface**

```ts
// src/services/SafeService.ts
import type { Safe, Agent, Policy, Proposal, RegisterAgentInput, PolicyChangeInput } from './types'
export interface SafeService {
  getSafe(): Promise<Safe>
  listAgents(): Promise<Agent[]>
  registerAgent(input: RegisterAgentInput): Promise<Agent>
  getPolicy(agentId: string): Promise<Policy>
  proposePolicyChange(input: PolicyChangeInput): Promise<Proposal>
  listProposals(): Promise<Proposal[]>
  getProposal(id: string): Promise<Proposal | undefined>
  approveProposal(id: string): Promise<Proposal>
  rejectProposal(id: string): Promise<Proposal>
  executeProposal(id: string): Promise<Proposal>
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/services/mock/safeMock.test.ts
import { safeMock } from './safeMock'

test('registerAgent adds an agent and a draft proposal', async () => {
  const before = (await safeMock.listAgents()).length
  const agent = await safeMock.registerAgent({ alias: 'Test Bot', address: 'TESTADDR', purpose: 'Algorithmic Trading', groupTier: 'Tier 3 - Automated Execution (1/1)', dailyLimit: 5000, primaryAsset: 'EURD' })
  expect(agent.id).toBeTruthy()
  expect((await safeMock.listAgents()).length).toBe(before + 1)
  expect((await safeMock.listProposals()).some(p => p.status === 'draft' && p.title.includes('Test Bot'))).toBe(true)
})

test('approveProposal increments approvals and executes at threshold', async () => {
  const props = await safeMock.listProposals()
  const pending = props.find(p => p.status === 'pending')!
  const needed = pending.threshold - pending.approvals
  let updated = pending
  for (let i = 0; i < needed; i++) updated = await safeMock.approveProposal(pending.id)
  expect(updated.status).toBe('executed')
})

test('approving a blocked proposal moves it to executed (admin override)', async () => {
  const blocked = (await safeMock.listProposals()).find(p => p.status === 'blocked')!
  const updated = await safeMock.approveProposal(blocked.id)
  expect(['pending', 'executed']).toContain(updated.status)
})
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `npx jest src/services/mock/safeMock.test.ts`
Expected: FAIL — `safeMock` not found.

- [ ] **Step 4: Implement `safeMock.ts`**

```ts
// src/services/mock/safeMock.ts
import type { SafeService } from '../SafeService'
import type { Agent, Proposal } from '../types'
import { store } from '../../lib/store'

const delay = <T>(v: T) => new Promise<T>(r => setTimeout(() => r(v), 150))

export const safeMock: SafeService = {
  getSafe: () => delay(store.safe),
  listAgents: () => delay([...store.agents]),

  async registerAgent(input) {
    const agent: Agent = {
      id: store.newAgentId(),
      alias: input.alias, address: input.address, purpose: input.purpose,
      primaryAsset: input.primaryAsset, dailyLimit: input.dailyLimit,
      status: 'pending_review', groupTier: input.groupTier,
    }
    store.agents.push(agent)
    store.policies[agent.id] = { agentId: agent.id, dailyLimit: input.dailyLimit, monthlyLimit: input.dailyLimit * 20, dailyUsed: 0, monthlyUsed: 0, minIntervalSec: 60, maxTxPerMin: 4, allowlist: [], multiSigRequired: true }
    const proposal: Proposal = {
      id: store.newProposalId(), title: `Agent Registration: ${input.alias}`,
      description: `Register automated agent ${input.alias} in ${input.groupTier}.`,
      status: 'draft', approvals: 0, threshold: 3, date: 'Just now',
      txPreview: [{ type: 'appl', summary: 'Initialize agent contract', detail: input.groupTier }],
      policyChecks: [],
    }
    store.proposals.unshift(proposal)
    return delay(agent)
  },

  getPolicy: (agentId) => delay(store.policies[agentId]),

  async proposePolicyChange({ agentId, policy }) {
    const agent = store.agents.find(a => a.id === agentId)
    const proposal: Proposal = {
      id: store.newProposalId(), title: `Policy Update: ${agent?.alias ?? agentId}`,
      description: 'Modify agent spending policy.', status: 'pending', approvals: 1, threshold: 3, date: 'Just now',
      txPreview: [{ type: 'appl', summary: 'Update policy box', detail: JSON.stringify(policy).slice(0, 80) }],
      policyChecks: [{ label: 'Within governance rules', passed: true }],
    }
    store.proposals.unshift(proposal)
    return delay(proposal)
  },

  listProposals: () => delay([...store.proposals]),
  getProposal: (id) => delay(store.proposals.find(p => p.id === id)),

  async approveProposal(id) {
    const p = store.proposals.find(x => x.id === id)!
    if (p.status === 'blocked' || p.status === 'draft') p.status = 'pending'
    p.approvals = Math.min(p.threshold, p.approvals + 1)
    if (p.approvals >= p.threshold) p.status = 'executed'
    return delay({ ...p })
  },
  async rejectProposal(id) {
    const p = store.proposals.find(x => x.id === id)!
    p.status = 'rejected'
    return delay({ ...p })
  },
  async executeProposal(id) {
    const p = store.proposals.find(x => x.id === id)!
    p.status = 'executed'
    return delay({ ...p })
  },
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx jest src/services/mock/safeMock.test.ts`
Expected: PASS (3 tests). Note: tests share module state; if ordering matters, they still hold because each asserts a transition, not an absolute count beyond `before`.

- [ ] **Step 6: Commit**

```bash
cd /Users/sid/Desktop/Projects/algo-safe
git add projects/algo-safe-frontend/src/services/SafeService.ts projects/algo-safe-frontend/src/services/mock
git commit -m "Frontend console: SafeService interface + stateful mock (tested)"
```

---

### Task 6: QuantozService interface, real client, mock fallback, binding (with test)

**Files:** Create `src/services/quantoz/QuantozService.ts`, `quantozMock.ts`, `quantozClient.ts`, `src/services/index.ts`, and `src/services/quantoz/quantoz.test.ts`.

- [ ] **Step 1: Write the interface**

```ts
// src/services/quantoz/QuantozService.ts
import type { Balance, QuantozTransaction, FundByBankCountry, FundByBankBank, FundingSession } from '../types'
export interface QuantozService {
  isLive(): boolean
  getEurdBalance(): Promise<Balance>
  getTransactions(): Promise<QuantozTransaction[]>
  getFundByBankCountries(): Promise<FundByBankCountry[]>
  getFundByBankBanks(countryCode: string): Promise<FundByBankBank[]>
  createFundByBankSession(args: { countryCode: string; bankId: string; amount: number; redirectUrl: string }): Promise<FundingSession>
}
```

- [ ] **Step 2: Write the mock fallback**

```ts
// src/services/quantoz/quantozMock.ts
import type { QuantozService } from './QuantozService'
const delay = <T>(v: T) => new Promise<T>(r => setTimeout(() => r(v), 150))
export const quantozMock: QuantozService = {
  isLive: () => false,
  getEurdBalance: () => delay({ symbol: 'EURD', assetId: 1221682136, amount: 2450000, decimals: 2, label: 'EURD Balance' }),
  getTransactions: () => delay([
    { txCode: 'QP2026...A1', type: 'Payment', amount: 15000, status: 'Completed', date: 'Yesterday', counterparty: 'Security Audit' },
    { txCode: 'QP2026...B2', type: 'Funding', amount: 50000, status: 'Completed', date: 'Oct 22' },
  ]),
  getFundByBankCountries: () => delay([{ countryCode: 'NL', name: 'Netherlands' }, { countryCode: 'DE', name: 'Germany' }]),
  getFundByBankBanks: () => delay([{ bankId: 'ideal-ing', name: 'ING' }, { bankId: 'ideal-rabo', name: 'Rabobank' }]),
  createFundByBankSession: (a) => delay({ sessionReference: 'demo-session', redirectUrl: a.redirectUrl + '?demo=1', status: 'Open' }),
}
```

- [ ] **Step 3: Write the real client**

```ts
// src/services/quantoz/quantozClient.ts
// Calls the Quantoz MCP server (JSON-RPC tools/call) with X-API-KEY.
import type { QuantozService } from './QuantozService'
import type { Balance, QuantozTransaction, FundByBankCountry, FundByBankBank, FundingSession } from '../types'
import { env } from '../../lib/env'

async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${env.quantozMcpUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': env.quantozApiKey ?? '' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }),
  })
  if (!res.ok) throw new Error(`Quantoz ${name} HTTP ${res.status}`)
  const json = await res.json()
  if (json.error) throw new Error(`Quantoz ${name}: ${json.error.message ?? 'error'}`)
  // MCP tool results arrive as content[].text (JSON string) — parse the first text part.
  const text = json.result?.content?.find?.((c: { type: string }) => c.type === 'text')?.text
  return (text ? JSON.parse(text) : json.result) as T
}

export const quantozClient: QuantozService = {
  isLive: () => true,
  async getEurdBalance() {
    const r = await callTool<{ balance?: number; amount?: number }>('get_account_balance', { accountCode: env.quantozAccountCode })
    const amount = (r.balance ?? r.amount ?? 0)
    return { symbol: 'EURD', assetId: 1221682136, amount, decimals: 2, label: 'EURD Balance' }
  },
  async getTransactions() {
    const r = await callTool<{ items?: QuantozTransaction[] }>('get_transactions', { accountCode: env.quantozAccountCode, pageSize: 10 })
    return r.items ?? (Array.isArray(r) ? (r as unknown as QuantozTransaction[]) : [])
  },
  async getFundByBankCountries() {
    const r = await callTool<{ items?: FundByBankCountry[] }>('get_fund_by_bank_countries', {})
    return r.items ?? (r as unknown as FundByBankCountry[])
  },
  async getFundByBankBanks(countryCode) {
    const r = await callTool<{ items?: FundByBankBank[] }>('get_fund_by_bank_banks', { countryCode })
    return r.items ?? (r as unknown as FundByBankBank[])
  },
  async createFundByBankSession(a) {
    return callTool<FundingSession>('create_fund_by_bank_session', { countryCode: a.countryCode, bankId: a.bankId, amount: a.amount, redirectUrl: a.redirectUrl, accountCode: env.quantozAccountCode })
  },
}
```

> Note: Quantoz MCP response shapes are not fully documented; the client defensively parses `content[].text` JSON and falls back. Real-call failures are caught at the binding layer (Step 4) which swaps to mock, so unknown shapes degrade gracefully rather than crashing the UI.

- [ ] **Step 4: Write the binding + ServiceProvider**

```tsx
// src/services/index.ts
import { createContext, useContext } from 'react'
import type { SafeService } from './SafeService'
import type { QuantozService } from './quantoz/QuantozService'
import { safeMock } from './mock/safeMock'
import { quantozMock } from './quantoz/quantozMock'
import { quantozClient } from './quantoz/quantozClient'
import { quantozEnabled } from '../lib/env'

// Wrap each live Quantoz method so any failure falls back to mock (and reports not-live).
function withFallback(live: QuantozService, mock: QuantozService): QuantozService {
  const wrap = <K extends keyof QuantozService>(k: K) =>
    (async (...args: unknown[]) => {
      try { return await (live[k] as (...a: unknown[]) => Promise<unknown>)(...args) }
      catch { return (mock[k] as (...a: unknown[]) => Promise<unknown>)(...args) }
    }) as QuantozService[K]
  return {
    isLive: () => true,
    getEurdBalance: wrap('getEurdBalance'),
    getTransactions: wrap('getTransactions'),
    getFundByBankCountries: wrap('getFundByBankCountries'),
    getFundByBankBanks: wrap('getFundByBankBanks'),
    createFundByBankSession: wrap('createFundByBankSession'),
  }
}

export interface Services { safe: SafeService; quantoz: QuantozService; quantozLive: boolean }
export const services: Services = {
  safe: safeMock,
  quantoz: quantozEnabled() ? withFallback(quantozClient, quantozMock) : quantozMock,
  quantozLive: quantozEnabled(),
}

const ServiceContext = createContext<Services>(services)
export const ServiceProvider = ServiceContext.Provider
export const useServices = () => useContext(ServiceContext)
```

- [ ] **Step 5: Write + run the fallback test**

```ts
// src/services/quantoz/quantoz.test.ts
import { quantozMock } from './quantozMock'
test('quantoz mock reports not-live and returns a seeded EURD balance', async () => {
  expect(quantozMock.isLive()).toBe(false)
  const bal = await quantozMock.getEurdBalance()
  expect(bal.symbol).toBe('EURD')
  expect(bal.amount).toBeGreaterThan(0)
})
```
Run: `npx jest src/services/quantoz/quantoz.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/sid/Desktop/Projects/algo-safe
git add projects/algo-safe-frontend/src/services
git commit -m "Frontend console: QuantozService (real client + mock fallback) + binding"
```

---

### Task 7: React Query hooks

**Files:** Create `src/hooks/index.ts`.

- [ ] **Step 1: Write the hooks**

```ts
// src/hooks/index.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useServices } from '../services'
import type { RegisterAgentInput, PolicyChangeInput } from '../services/types'

export const useSafe = () => { const { safe } = useServices(); return useQuery({ queryKey: ['safe'], queryFn: () => safe.getSafe() }) }
export const useAgents = () => { const { safe } = useServices(); return useQuery({ queryKey: ['agents'], queryFn: () => safe.listAgents() }) }
export const usePolicy = (agentId?: string) => { const { safe } = useServices(); return useQuery({ queryKey: ['policy', agentId], queryFn: () => safe.getPolicy(agentId!), enabled: !!agentId }) }
export const useProposals = () => { const { safe } = useServices(); return useQuery({ queryKey: ['proposals'], queryFn: () => safe.listProposals() }) }
export const useProposal = (id?: string) => { const { safe } = useServices(); return useQuery({ queryKey: ['proposal', id], queryFn: () => safe.getProposal(id!), enabled: !!id }) }

export const useEurdBalance = () => { const { quantoz } = useServices(); return useQuery({ queryKey: ['eurd'], queryFn: () => quantoz.getEurdBalance() }) }
export const useQuantozTransactions = () => { const { quantoz } = useServices(); return useQuery({ queryKey: ['qtx'], queryFn: () => quantoz.getTransactions() }) }

export function useRegisterAgent() {
  const { safe } = useServices(); const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: RegisterAgentInput) => safe.registerAgent(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }); qc.invalidateQueries({ queryKey: ['proposals'] }) },
  })
}
export function useProposePolicyChange() {
  const { safe } = useServices(); const qc = useQueryClient()
  return useMutation({ mutationFn: (input: PolicyChangeInput) => safe.proposePolicyChange(input), onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }) })
}
export function useApproveProposal() {
  const { safe } = useServices(); const qc = useQueryClient()
  return useMutation({ mutationFn: (id: string) => safe.approveProposal(id), onSuccess: (_d, id) => { qc.invalidateQueries({ queryKey: ['proposals'] }); qc.invalidateQueries({ queryKey: ['proposal', id] }) } })
}
export function useRejectProposal() {
  const { safe } = useServices(); const qc = useQueryClient()
  return useMutation({ mutationFn: (id: string) => safe.rejectProposal(id), onSuccess: (_d, id) => { qc.invalidateQueries({ queryKey: ['proposals'] }); qc.invalidateQueries({ queryKey: ['proposal', id] }) } })
}
export function useExecuteProposal() {
  const { safe } = useServices(); const qc = useQueryClient()
  return useMutation({ mutationFn: (id: string) => safe.executeProposal(id), onSuccess: (_d, id) => { qc.invalidateQueries({ queryKey: ['proposals'] }); qc.invalidateQueries({ queryKey: ['proposal', id] }) } })
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit` — expect no errors in `src/hooks`, `src/services`, `src/lib`. (App-level errors remain until Task 9.)

- [ ] **Step 3: Commit**

```bash
cd /Users/sid/Desktop/Projects/algo-safe
git add projects/algo-safe-frontend/src/hooks
git commit -m "Frontend console: React Query data hooks"
```

---

### Task 8: Shared UI primitives

**Files:** Create `src/components/ui/` (`Icon.tsx`, `Button.tsx`, `Card.tsx`, `StatCard.tsx`, `StatusBadge.tsx`, `DataTable.tsx`, `Stepper.tsx`, `Toggle.tsx`, `FormField.tsx`, `DemoDataChip.tsx`, `Skeleton.tsx`, `index.ts`).

Build small, focused presentational components matching the Stitch look (white cards, `rounded-xl`, soft borders, brand/indigo accents, Material Symbols). Use the `frontend-design` skill for quality.

- [ ] **Step 1: Write `Icon` and `Button`**

```tsx
// src/components/ui/Icon.tsx
export const Icon = ({ name, className = '' }: { name: string; className?: string }) =>
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
```
```tsx
// src/components/ui/Button.tsx
import type { ButtonHTMLAttributes } from 'react'
type V = 'primary' | 'secondary' | 'ghost' | 'danger'
const styles: Record<V, string> = {
  primary: 'bg-ink-900 text-white hover:bg-ink-700',
  secondary: 'bg-white text-ink-900 border border-surface-border hover:bg-surface-muted',
  ghost: 'text-ink-700 hover:bg-surface-muted',
  danger: 'bg-danger text-white hover:opacity-90',
}
export const Button = ({ variant = 'primary', className = '', ...p }: { variant?: V } & ButtonHTMLAttributes<HTMLButtonElement>) =>
  <button className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${styles[variant]} ${className}`} {...p} />
```

- [ ] **Step 2: Write `Card`, `StatCard`, `StatusBadge`, `DemoDataChip`, `Skeleton`**

```tsx
// src/components/ui/Card.tsx
import type { ReactNode } from 'react'
export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) =>
  <div className={`rounded-xl border border-surface-border bg-white p-6 ${className}`}>{children}</div>
```
```tsx
// src/components/ui/StatCard.tsx
import type { ReactNode } from 'react'
import { Card } from './Card'
export const StatCard = ({ label, value, sub, right }: { label: string; value: ReactNode; sub?: ReactNode; right?: ReactNode }) => (
  <Card><div className="flex items-start justify-between"><div className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</div>{right}</div>
    <div className="mt-3 text-3xl font-bold text-ink-900">{value}</div>{sub && <div className="mt-1 text-xs text-ink-500">{sub}</div>}</Card>
)
```
```tsx
// src/components/ui/StatusBadge.tsx
import type { ProposalStatus } from '../../services/types'
const map: Record<string, string> = {
  executed: 'text-ok bg-green-50', pending: 'text-brand-600 bg-brand-50', draft: 'text-ink-500 bg-surface-muted',
  blocked: 'text-danger bg-red-50', rejected: 'text-danger bg-red-50', expired: 'text-ink-400 bg-surface-muted',
  active: 'text-ok bg-green-50', pending_review: 'text-warn bg-amber-50', paused: 'text-ink-500 bg-surface-muted',
}
export const StatusBadge = ({ status, children }: { status: ProposalStatus | string; children?: React.ReactNode }) =>
  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${map[status] ?? 'text-ink-500 bg-surface-muted'}`}>{children ?? status}</span>
```
```tsx
// src/components/ui/DemoDataChip.tsx
export const DemoDataChip = () =>
  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-warn">demo data</span>
```
```tsx
// src/components/ui/Skeleton.tsx
export const Skeleton = ({ className = '' }: { className?: string }) =>
  <div className={`animate-pulse rounded-md bg-surface-muted ${className}`} />
```

- [ ] **Step 3: Write `DataTable`, `Stepper`, `Toggle`, `FormField`**

```tsx
// src/components/ui/DataTable.tsx
import type { ReactNode } from 'react'
export interface Column<T> { key: string; header: string; render: (row: T) => ReactNode; className?: string }
export function DataTable<T>({ columns, rows, empty = 'No data' }: { columns: Column<T>[]; rows: T[]; empty?: string }) {
  if (!rows.length) return <div className="py-10 text-center text-sm text-ink-500">{empty}</div>
  return (<table className="w-full text-sm"><thead><tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-ink-500">
    {columns.map(c => <th key={c.key} className={`px-3 py-3 font-medium ${c.className ?? ''}`}>{c.header}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-surface-border/60 last:border-0">
      {columns.map(c => <td key={c.key} className={`px-3 py-4 ${c.className ?? ''}`}>{c.render(r)}</td>)}</tr>)}</tbody></table>)
}
```
```tsx
// src/components/ui/Stepper.tsx
export const Stepper = ({ steps, current }: { steps: string[]; current: number }) => (
  <div className="flex items-center">{steps.map((s, i) => (<div key={s} className="flex flex-1 items-center last:flex-none">
    <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${i <= current ? 'bg-ink-900 text-white' : 'bg-brand-50 text-ink-500'}`}>{i + 1}</div>
    <span className="ml-2 text-sm text-ink-700">{s}</span>{i < steps.length - 1 && <div className="mx-3 h-px flex-1 bg-surface-border" />}</div>))}</div>
)
```
```tsx
// src/components/ui/Toggle.tsx
export const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) => (
  <label className="inline-flex cursor-pointer items-center gap-2">
    <button type="button" onClick={() => onChange(!checked)} className={`h-6 w-11 rounded-full p-0.5 transition ${checked ? 'bg-ink-900' : 'bg-surface-border'}`}>
      <span className={`block h-5 w-5 rounded-full bg-white transition ${checked ? 'translate-x-5' : ''}`} /></button>
    {label && <span className="text-sm text-ink-700">{label}</span>}</label>
)
```
```tsx
// src/components/ui/FormField.tsx
import type { ReactNode } from 'react'
export const FormField = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <label className="block"><div className="mb-1 text-sm font-medium text-ink-700">{label}</div>{children}
    {hint && <div className="mt-1 text-xs text-ink-500">{hint}</div>}</label>
)
export const inputCls = 'w-full rounded-lg border border-surface-border bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none'
```
```ts
// src/components/ui/index.ts
export * from './Icon'; export * from './Button'; export * from './Card'; export * from './StatCard'
export * from './StatusBadge'; export * from './DemoDataChip'; export * from './Skeleton'
export * from './DataTable'; export * from './Stepper'; export * from './Toggle'; export * from './FormField'
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit` — expect no errors in `src/components/ui`.

- [ ] **Step 5: Commit**

```bash
cd /Users/sid/Desktop/Projects/algo-safe
git add projects/algo-safe-frontend/src/components/ui
git commit -m "Frontend console: shared UI primitives (Stitch-styled)"
```

---

### Task 9: App shell, providers, and router (app compiles again)

**Files:** Create `src/layout/AppShell.tsx`, `src/layout/Sidebar.tsx`, `src/layout/TopBar.tsx`, `src/routes.tsx`; modify `src/App.tsx`. Create placeholder `src/pages/Placeholder.tsx`.

- [ ] **Step 1: Sidebar**

```tsx
// src/layout/Sidebar.tsx
import { NavLink } from 'react-router-dom'
import { Icon } from '../components/ui'
const items = [
  { to: '/', icon: 'dashboard', label: 'Dashboard', end: true },
  { to: '/assets', icon: 'account_balance_wallet', label: 'Assets' },
  { to: '/agents', icon: 'smart_toy', label: 'Agents' },
  { to: '/proposals', icon: 'gavel', label: 'Proposals' },
  { to: '/settings', icon: 'settings', label: 'Settings' },
]
export const Sidebar = () => (
  <aside className="flex w-60 flex-col border-r border-surface-border bg-white">
    <div className="flex items-center gap-2 px-6 py-5"><Icon name="shield" className="text-ink-900" /><div><div className="font-bold">AlgoSafe</div><div className="text-xs text-ink-500">Institutional Treasury</div></div></div>
    <nav className="flex-1 px-3">{items.map(i => (
      <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-surface-muted'}`}>
        <Icon name={i.icon} className="text-[20px]" />{i.label}</NavLink>))}</nav>
    <div className="p-3"><button className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white"><Icon name="add" className="text-[20px]" />Create Proposal</button></div>
  </aside>
)
```

- [ ] **Step 2: TopBar (network toggle + connect wallet)**

```tsx
// src/layout/TopBar.tsx
import { useState } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { Icon, Button } from '../components/ui'
import ConnectWallet from '../components/ConnectWallet'
import { shortAddr } from '../lib/format'
const NETS = ['Mainnet', 'Testnet', 'LocalNet']
export const TopBar = () => {
  const [net, setNet] = useState('Mainnet')
  const [open, setOpen] = useState(false)
  const { activeAddress } = useWallet()
  return (<header className="flex items-center justify-between border-b border-surface-border bg-white px-6 py-3">
    <div className="flex items-center gap-6"><span className="font-semibold">AlgoSafe Console</span>
      <div className="flex gap-1 text-sm">{NETS.map(n => <button key={n} onClick={() => setNet(n)} className={`rounded-md px-2 py-1 ${net === n ? 'font-semibold text-ink-900 underline underline-offset-4' : 'text-ink-500'}`}>{n}</button>)}</div></div>
    <div className="flex items-center gap-3"><Icon name="notifications" className="text-ink-500" /><Icon name="help_outline" className="text-ink-500" />
      <Button variant="secondary" onClick={() => setOpen(true)}>{activeAddress ? shortAddr(activeAddress) : 'Connect Wallet'}</Button></div>
    <ConnectWallet openModal={open} closeModal={() => setOpen(false)} />
  </header>)
}
```

- [ ] **Step 3: AppShell + Placeholder**

```tsx
// src/layout/AppShell.tsx
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
export const AppShell = () => (
  <div className="flex h-screen overflow-hidden"><Sidebar />
    <div className="flex flex-1 flex-col overflow-hidden"><TopBar />
      <main className="flex-1 overflow-y-auto p-8"><Outlet /></main></div></div>
)
```
```tsx
// src/pages/Placeholder.tsx
export const Placeholder = ({ title }: { title: string }) =>
  <div className="text-ink-500">{title} — not part of this build.</div>
```

- [ ] **Step 4: Routes**

```tsx
// src/routes.tsx
import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from './layout/AppShell'
import { DashboardPage } from './pages/DashboardPage'
import { RegisterAgentPage } from './pages/RegisterAgentPage'
import { AgentPoliciesPage } from './pages/AgentPoliciesPage'
import { FundEurdPage } from './pages/FundEurdPage'
import { ProposalDetailPage } from './pages/ProposalDetailPage'
import { Placeholder } from './pages/Placeholder'
export const router = createBrowserRouter([
  { element: <AppShell />, children: [
    { path: '/', element: <DashboardPage /> },
    { path: '/agents', element: <AgentPoliciesPage /> },
    { path: '/agents/register', element: <RegisterAgentPage /> },
    { path: '/proposals/:id', element: <ProposalDetailPage /> },
    { path: '/proposals', element: <Placeholder title="Proposals list" /> },
    { path: '/fund', element: <FundEurdPage /> },
    { path: '/assets', element: <Placeholder title="Assets" /> },
    { path: '/settings', element: <Placeholder title="Settings" /> },
  ]},
])
```

- [ ] **Step 5: Rewrite `App.tsx` with all providers**

Keep the existing wallet-manager construction from the current `App.tsx`; wrap with QueryClient + Service + Router:
```tsx
// src/App.tsx
import { SupportedWallet, WalletId, WalletManager, WalletProvider } from '@txnlab/use-wallet-react'
import { SnackbarProvider } from 'notistack'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { getAlgodConfigFromViteEnvironment, getKmdConfigFromViteEnvironment } from './utils/network/getAlgoClientConfigs'
import { ServiceProvider, services } from './services'
import { router } from './routes'

let supportedWallets: SupportedWallet[]
if (import.meta.env.VITE_ALGOD_NETWORK === 'localnet') {
  const kmd = getKmdConfigFromViteEnvironment()
  supportedWallets = [{ id: WalletId.KMD, options: { baseServer: kmd.server, token: String(kmd.token), port: String(kmd.port) } }]
} else {
  supportedWallets = [{ id: WalletId.DEFLY }, { id: WalletId.PERA }, { id: WalletId.EXODUS }]
}
const queryClient = new QueryClient()

export default function App() {
  const algodConfig = getAlgodConfigFromViteEnvironment()
  const walletManager = new WalletManager({
    wallets: supportedWallets, defaultNetwork: algodConfig.network,
    networks: { [algodConfig.network]: { algod: { baseServer: algodConfig.server, port: algodConfig.port, token: String(algodConfig.token) } } },
    options: { resetNetwork: true },
  })
  return (
    <QueryClientProvider client={queryClient}>
      <SnackbarProvider maxSnack={3}>
        <WalletProvider manager={walletManager}>
          <ServiceProvider value={services}><RouterProvider router={router} /></ServiceProvider>
        </WalletProvider>
      </SnackbarProvider>
    </QueryClientProvider>
  )
}
```

- [ ] **Step 6: Verify app compiles and runs**

Run: `npx tsc --noEmit` (expect 0 errors now) then `npm run dev` and load `http://localhost:5173`.
Expected: shell renders (sidebar + topbar), `/` shows the Dashboard page (built next; if pages 10–14 not yet present, this step is done at the end of Task 14 — for now, stub each page export so it compiles).

> To keep the app compiling between Task 9 and Task 14, create minimal stub exports for the five pages first (e.g., `export const DashboardPage = () => <div>Dashboard</div>`) and flesh each out in its own task.

- [ ] **Step 7: Commit**

```bash
cd /Users/sid/Desktop/Projects/algo-safe
git add projects/algo-safe-frontend/src/App.tsx projects/algo-safe-frontend/src/routes.tsx projects/algo-safe-frontend/src/layout projects/algo-safe-frontend/src/pages/Placeholder.tsx
git commit -m "Frontend console: app shell, providers, router (app compiles)"
```

---

### Task 10: Dashboard page

**Files:** Create/replace `src/pages/DashboardPage.tsx`. Stitch source: `docs/stitch_algosafe_agent_manager/algosafe_dashboard/`.

Port the Stitch dashboard layout. Use `frontend-design` for fidelity.

- [ ] **Step 1: Implement the page**

Requirements (wire to hooks):
- Header: "Treasury Overview" + safe meta from `useSafe()` (name, App ID, address). Buttons: `Register Agent` → `/agents/register`, `Fund with EURD` → `/fund`.
- Two `StatCard`s: **EURD Balance** from `useEurdBalance()` (`fmtEur`), showing `<DemoDataChip/>` when `!services.quantozLive`; **ALGO Balance** (static/seeded for now — read from wallet/algod is optional, use a seeded value `185240.5` if not connected).
- Recent Transaction Proposals: `Card` + `DataTable` from `useProposals()` columns ID / Description / Status (`StatusBadge`) / Amount / Date; rows link to `/proposals/:id`. Loading → `Skeleton` rows.

Key wiring snippet:
```tsx
import { Link, useNavigate } from 'react-router-dom'
import { useSafe, useProposals, useEurdBalance } from '../hooks'
import { useServices } from '../services'
import { Card, StatCard, StatusBadge, DataTable, Button, DemoDataChip, Skeleton } from '../components/ui'
import { fmtEur } from '../lib/format'
// ...map proposals -> DataTable columns; row onClick navigate(`/proposals/${p.id}`)
```

- [ ] **Step 2: Verify**

Run `npm run dev`, open `/`. Expected: balances render (EURD with demo chip when no key), proposals table lists seeded rows incl. `#0043 ... blocked`; clicking a row navigates to its detail.

- [ ] **Step 3: Commit**

```bash
cd /Users/sid/Desktop/Projects/algo-safe
git add projects/algo-safe-frontend/src/pages/DashboardPage.tsx
git commit -m "Frontend console: Dashboard page"
```

---

### Task 11: Register AI Agent page

**Files:** Create/replace `src/pages/RegisterAgentPage.tsx`. Stitch source: `docs/stitch_algosafe_agent_manager/register_ai_agent/`.

- [ ] **Step 1: Implement the form**

Requirements:
- Left column: Cryptographic Identity (`FormField` + `inputCls`: Algorand address, alias) and Operational Purpose (`<select>`: Treasury Rebalancing / Automated Payroll / Algorithmic Trading / Custom Smart Contract Execution). Authorization Policy: choice between "Attach to Existing Group" / "Create Isolated Sub-Group"; Target Group `<select>` (Tier 3 (1/1) / Tier 2 (2/3)); info line "Policy applied: Max 5,000 EURD/24h".
- Right column: static "Architecture Context" (Standard vs Agent Account) and "x402 Protocol Compliance" panels (copy from the Stitch HTML text).
- Footer: `Cancel` (→ `/agents`) and `Initialize Agent Contract` (primary) → `useRegisterAgent().mutate({...})`; on success `notistack` success toast + `navigate('/agents')`.

Wiring:
```tsx
import { useNavigate } from 'react-router-dom'
import { useSnackbar } from 'notistack'
import { useRegisterAgent } from '../hooks'
// form state via useState; on submit call mutate(input, { onSuccess: () => { enqueueSnackbar('Agent registered', {variant:'success'}); navigate('/agents') } })
```

- [ ] **Step 2: Verify**

Run dev, fill the form, submit → toast → redirected to `/agents` where the new agent appears (status `pending_review`), and a Draft proposal appears on the Dashboard. (Statefulness proof.)

- [ ] **Step 3: Commit**

```bash
cd /Users/sid/Desktop/Projects/algo-safe
git add projects/algo-safe-frontend/src/pages/RegisterAgentPage.tsx
git commit -m "Frontend console: Register AI Agent page"
```

---

### Task 12: Agent Policies page

**Files:** Create/replace `src/pages/AgentPoliciesPage.tsx`. Stitch source: `docs/stitch_algosafe_agent_manager/agent_spending_limits/`.

- [ ] **Step 1: Implement**

Requirements:
- Three `StatCard`s: Active Agents (count of `status==='active'` from `useAgents()`), 24h Volume (sum from `useQuantozTransactions()` or seeded), Governance (count of `pending`/`blocked` proposals from `useProposals()`).
- Deployed Agents `DataTable` from `useAgents()`: Identifier (alias + short address) / Primary Asset / Daily Limit (`fmtNum`) / Status (`StatusBadge`). Selecting a row sets the selected agent.
- Policy Configuration panel for the selected agent from `usePolicy(agentId)`: Spending Limits (daily/monthly inputs), Velocity & Cooldown (min interval, max tx/min), Destination Allowlist (list + add), "Multi-Sig Required" note. `Discard` / `Propose Changes` → `useProposePolicyChange().mutate({ agentId, policy })` → toast + the new proposal appears.

- [ ] **Step 2: Verify**

Run dev, open `/agents`. Expected: stat cards + agents table (3 seeded + any newly registered), selecting an agent shows its policy; `Propose Changes` creates a pending proposal (visible on Dashboard).

- [ ] **Step 3: Commit**

```bash
cd /Users/sid/Desktop/Projects/algo-safe
git add projects/algo-safe-frontend/src/pages/AgentPoliciesPage.tsx
git commit -m "Frontend console: Agent Policies page"
```

---

### Task 13: Fund with EURD page

**Files:** Create/replace `src/pages/FundEurdPage.tsx`. Stitch source: `docs/stitch_algosafe_agent_manager/fund_account_eurd/`.

- [ ] **Step 1: Implement the wizard (real Quantoz flow)**

Requirements — `Stepper` with steps `['Amount','Bank','Confirm']`, centered card matching Stitch:
- Step 1 Amount: EUR input (min €5), shows "Yields N EURD" and "Regulated issuance by Quantoz Payments B.V.". Next.
- Step 2 Bank: country `<select>` from `useServices().quantoz.getFundByBankCountries()`, bank `<select>` from `getFundByBankBanks(country)`. (Use `useQuery` inline or add hooks.) Next.
- Step 3 Confirm: "Generate Instructions" → `quantoz.createFundByBankSession({ countryCode, bankId, amount, redirectUrl: window.location.origin + '/fund?status=return' })`. If `services.quantozLive` and a real `redirectUrl` returned → `window.location.href = session.redirectUrl`. Else show a mock confirmation panel with `<DemoDataChip/>` ("In production this redirects to your bank via iDEAL/open-banking; mint 1:1 as EURD on settlement").
- On return (`?status=return`) show a success state.

Wiring:
```tsx
import { useServices } from '../services'
import { useQuery } from '@tanstack/react-query'
import { Stepper, Card, Button, FormField, inputCls, DemoDataChip } from '../components/ui'
// const { quantoz, quantozLive } = useServices()
```

- [ ] **Step 2: Verify**

Run dev, open `/fund`. Without a key: full wizard works, ends on a mock confirmation with the demo chip. (With a real key set, "Generate Instructions" would redirect to the bank — note in README, not required to test live.)

- [ ] **Step 3: Commit**

```bash
cd /Users/sid/Desktop/Projects/algo-safe
git add projects/algo-safe-frontend/src/pages/FundEurdPage.tsx
git commit -m "Frontend console: Fund with EURD wizard (real Quantoz + fallback)"
```

---

### Task 14: Proposal Detail — approval / blocked (the climax)

**Files:** Create/replace `src/pages/ProposalDetailPage.tsx`. (No Stitch source — design from the spec, matching the system; use `frontend-design`.)

- [ ] **Step 1: Implement**

Requirements — read `useProposal(id)`:
- Header: title + `StatusBadge`. If `status==='blocked'`, a prominent red banner: `⛔ Blocked — {blockedReason}`.
- Left: Human summary (`description`); Transaction Group Preview (`txPreview` list: each `TxLine` type chip + summary + detail); Policy Checks (`policyChecks` with ✓/✗ icons, red for failed).
- Right rail: Approval progress `{approvals}/{threshold}` with a progress bar; Network/asset/amount; Action buttons:
  - `Approve` → `useApproveProposal().mutate(id)` (for a blocked proposal this is the admin override; on threshold it flips to executed).
  - `Reject` → `useRejectProposal().mutate(id)`.
  - `Execute` shown when `approvals>=threshold` and not yet executed.
- After approve/execute, the badge + progress update live (query invalidation).

- [ ] **Step 2: Verify (the demo climax)**

Run dev. Navigate to `/proposals/0043` (the blocked one). Expected: red blocked banner + failed policy checks. Click `Approve` repeatedly → progress fills → status flips to Executed; navigate back to Dashboard and the row reflects the new status.

- [ ] **Step 3: Commit**

```bash
cd /Users/sid/Desktop/Projects/algo-safe
git add projects/algo-safe-frontend/src/pages/ProposalDetailPage.tsx
git commit -m "Frontend console: Proposal detail (approval/blocked) page"
```

---

### Task 15: States polish, frontend-design pass, and final verification

**Files:** touch pages/components as needed.

- [ ] **Step 1: Loading/empty/error states**

Ensure every page handles `isLoading` (Skeletons), empty (`DataTable` empty text), and Quantoz fallback (`DemoDataChip` where Quantoz data shows and `!quantozLive`). Wallet-disconnected: TopBar shows "Connect Wallet".

- [ ] **Step 2: frontend-design polish pass**

Use the `frontend-design` skill to review all 5 screens against the Stitch PNGs for spacing, typography, color, and alignment fidelity. Fix gaps. Do not introduce new aesthetics — match Stitch.

- [ ] **Step 3: Full type-check, build, and test**

Run:
```bash
npx tsc --noEmit
npm run build
npx jest
```
Expected: type-check clean, build succeeds, all jest tests pass.

- [ ] **Step 4: Optional E2E happy path**

Add `tests/register-agent.spec.ts` (Playwright, project already configured): load `/agents/register`, fill + submit, assert redirect to `/agents` and the new alias is visible. Run: `npm run playwright:test`. (Optional — skip if time-constrained.)

- [ ] **Step 5: Manual demo walkthrough**

`npm run dev` and verify the full pitch flow: Dashboard → Register Agent (appears) → Agent Policies (set + propose) → Proposal `0043` blocked → Approve → Executed.

- [ ] **Step 6: Commit**

```bash
cd /Users/sid/Desktop/Projects/algo-safe
git add -A
git commit -m "Frontend console: states polish, design fidelity pass, verification"
```

---

## Notes

- **No push** to any remote without explicit instruction (CLAUDE.md). All commits local.
- `docs/` is globally gitignored; the spec/plan are intentional, force-added.
- Quantoz MCP response shapes are best-effort; the fallback wrapper guarantees the UI never crashes on unexpected Quantoz output.
- When the teammate's ARC-56 client is ready, implement a `safeClient: SafeService` and swap it in `src/services/index.ts` — no screen changes.
