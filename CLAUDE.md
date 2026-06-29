# CLAUDE.md — algo-safe

Policy-driven smart account system for Algorand. Enables M-of-N signer groups to govern transactions and admin changes on-chain.

## Project layout

```
algo-safe/                          (pnpm monorepo)
├── projects/
│   ├── algo-safe-contracts/        smart contracts (Algorand TypeScript → AVM)
│   ├── algo-safe-frontend/         React 18 + Vite + Tailwind web UI
│   ├── algo-safe-x402-client/      X402 payment client
│   ├── algo-safe-x402-facilitator/ X402 facilitator server (Hono)
│   └── algo-safe-x402-shop/        X402 demo shop (Hono)
├── AGENTS.md                       AI agent workflow guide (MCP tools, skills)
└── PRODUCT-DESCRIPTION.md          Full product spec
```

## Tech stack (don't read package.json to discover this)

| Layer | Stack |
|---|---|
| Blockchain | Algorand (localnet / testnet / mainnet) |
| Smart contracts | Algorand TypeScript (PuyaTs) → compiled to AVM bytecode |
| Contract tooling | AlgoKit CLI, `@algorandfoundation/algokit-utils` v9 |
| Frontend | React 18, Vite 5, Tailwind 3.3, React Query v5 |
| Wallets | `@txnlab/use-wallet-react` v4 (Pera, Defly, WalletConnect) |
| Testing (contracts) | Vitest + `@algorandfoundation/algorand-typescript-testing` |
| Testing (frontend) | Jest + Playwright |
| Package manager | pnpm (workspace) |
| X402 servers | Hono + `@hono/node-server` |
| Deployment | Vercel (frontend), TestNet (contracts via CI) |

## Key source files (jump here directly)

### Contracts (`projects/algo-safe-contracts/`)
| File | Purpose |
|---|---|
| `smart_contracts/algo_safe/contract.algo.ts` | **Main contract** — all safe logic |
| `smart_contracts/algo_safe/contract.e2e.spec.ts` | E2E tests |
| `smart_contracts/algo_safe/deploy-config.ts` | Deployment config |
| `src/index.ts` | Library entry point |
| `src/safe-tx.ts` | Transaction helpers |
| `src/on-chain.ts` | On-chain state queries |
| `src/admin.ts` | Admin operations |

### Frontend (`projects/algo-safe-frontend/src/`)
| File/Dir | Purpose |
|---|---|
| `App.tsx` | Root component |
| `routes.tsx` | React Router config |
| `components/` | Shared UI components |
| `pages/` | Page-level components |
| `hooks/` | Custom hooks (e.g. `useOnChainSafeHoldings.ts`) |
| `services/` | Business logic |
| `contracts/` | Auto-generated typed clients (do not edit) |

## Commands (don't read package.json to discover these)

### Contracts
```bash
cd projects/algo-safe-contracts
pnpm build                    # compile TS → AVM + generate typed clients
pnpm test                     # unit tests + coverage
pnpm test:e2e                 # e2e tests against localnet
pnpm lint                     # ESLint
pnpm lint:fix                 # ESLint --fix
```

### Frontend
```bash
cd projects/algo-safe-frontend
pnpm dev                      # Vite dev server (http://localhost:5173)
pnpm build                    # tsc + vite build
pnpm test                     # Jest
pnpm playwright:test          # Playwright E2E
pnpm generate:app-clients     # regenerate typed contract clients
```

### AlgoKit (run from any workspace root)
```bash
algokit localnet start        # start local Algorand node
algokit localnet status       # check localnet
algokit localnet reset        # reset localnet state
algokit project run build     # build all
algokit project deploy localnet   # deploy to localnet
algokit project deploy testnet    # deploy to testnet
```

## Contract architecture

The contract (`contract.algo.ts`) is a single AVM application. Key concepts:

- **Proposal lifecycle**: `STATUS_ACTIVE(1)` → `STATUS_READY(2)` → `STATUS_EXECUTED(3)` or `STATUS_CANCELLED(4)`
- **Proposal types**: `PT_TRANSACTION_GROUP(1)` — pay/axfer/appl/keyreg, `PT_ADMIN(5)` — governance changes
- **Signer group**: M-of-N signers with `allowedActions` bitmask (PAY=1, AXFER=2, APPL=4, KEYREG=8) and `adminPrivileges` bitmask (GROUP=1, POLICY=2)
- **Storage**: BoxMap for proposals and signer groups; GlobalState for config
- **Auth**: AVM verifies tx signatures before the program runs; contract checks `Txn.sender` against group membership

## Working with the `algo-safe` npm package

The frontend depends on `algo-safe` (the contracts package, published to npm; `workspace:*` in this monorepo) for constants, typed clients, and tx-building helpers. The deployed contract has shipped multiple **breaking** versions, so the package supports several approval-program hashes side by side:

- `getAlgoSafeContractVersion(algodClient, appId)` — hashes the deployed approval program and returns its `ContractHash`, or `undefined` if unrecognized.
- `getClient(version ?? 'latest')` — returns the typed client constructor matching that hash. Feed it straight into `algorand.client.getTypedAppClientById(...)`.
- `LATEST_CONTRACT_HASH` — the current deployed version's hash. Compare against it (or treat `undefined`/`'latest'` as latest) to branch on version-specific ABI differences.

**Always detect the version before calling the contract** — never assume `'latest'` is what's actually deployed on a given `appId`.

### Breaking changes seen across versions (don't assume the old shape)
- `proposeAssetTransfer` was **removed** in the latest contract. Build asset-transfer/opt-in proposals with the generic path instead: `toSafeTxnGroup([createAssetSafeTxn({...})])` passed to `appClient.send.proposeTransactionGroup({ args: { groupId, payload, expiryRound } })`. Same pattern applies to payments via `createPaymentSafeTxn` if you ever need a one-off group.
- `getTransactionGroup` gained a second arg (`payloadIndex`) in the latest contract; the older contract only takes `proposalId`. The client's union type makes this uncallable through normal typing — branch on `isLatest` (from `buildAppClient` in `algoSafeProposals.ts`) and accept a narrow `as any` cast on that one call rather than fighting the union type.
- `Proposal` gained `numPayloads` in the latest contract. Cast `client.getProposal(...)` results to the latest `Proposal` type (`as ContractProposal`) rather than widening every consumer function's signature to the union — none of the current code paths read `numPayloads` from older proposals.
- Bitmask constants follow the **deployed contract**, not any historical npm naming: `PRIV_GROUP=1`, `PRIV_POLICY=2`, `PRIV_ALL=7` (bit 4 reserved). If a published `algo-safe` version exports different names (e.g. `PRIV_MEMBER`, `PRIV_THRESHOLD`), that's a packaging bug — verify against `contract.algo.ts` and fix `src/constants.ts`, don't propagate the wrong names into the frontend.

### Conventions
- **Never redefine contract constants locally** in frontend code (`ACT_*`, `ADM_*`, `PRIV_*`, `TX_*`). Always import from `algo-safe` — they must track the deployed contract exactly, and local copies drift silently.
- Build all transaction payloads through `src/safe-tx.ts` helpers (`createPaymentSafeTxn`, `createAssetSafeTxn`, `createAppCallSafeTxn`, `createKeyRegSafeTxn`, `toSafeTxnTuple`, `toSafeTxnGroup`) and submit via `proposeTransactionGroup`. Don't hand-roll the `SafeTxnTuple` array shape.
- After bumping the `algo-safe` version (or rebuilding the workspace package with `pnpm build-package`), run `pnpm exec tsc --noEmit` in `algo-safe-frontend` — version bumps regularly surface ABI breaking changes as type errors, which is the fastest way to find every call site that needs updating.
- The frontend's `workspace:*` dependency and the published npm version should point at identical contract hashes; if they diverge, check `src/versioned-clients.generated.ts` (auto-generated by `sync-versioned-client` — never hand-edit) before assuming a frontend bug.

## MCP tools available

Configured in `.mcp.json` (check for it). If missing, MCP won't be available.

| Tool prefix | Purpose |
|---|---|
| `mcp__kapa__search_algorand_knowledge_sources` | Search official Algorand docs |
| `mcp__github__get_file_contents` | Fetch code examples from GitHub |
| `mcp__github__search_code` | Search code across algorandfoundation repos |

Fallback: web search `site:dev.algorand.co {query}` or browse GitHub directly.

## AlgoKit skills (load before writing contract/frontend code)

| Skill | When to use |
|---|---|
| `algorand-core` | AVM constraints, type system, limits |
| `algorand-typescript` | Contract syntax, build, deploy patterns |
| `algorand-frontend` | React + wallet + typed-client patterns |
| `algorand-x402-typescript` | X402 client/server/facilitator patterns |

## Working conventions

- TypeScript strict throughout; no `any` without justification
- `algosdk` v3 API (not v2 — breaking changes in v3)
- `algokit-utils` v9 API
- Generated files in `src/contracts/` and `clients/` — never edit manually
- AVM has only `uint64` and `bytes` types; no floats, no dynamic dispatch
- Max 16 txns per atomic group; budget limits apply — use `ensureBudget()` in contracts
- X402 facilitator URL: `https://facilitator.goplausible.xyz`

## Plan mode

Plans must be extremely concise. Sacrifice grammar for brevity. End plans with a list of unresolved questions if any exist.
