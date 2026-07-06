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
- **Governance lockout guard**: `activePrivGroupCount` (GlobalState) tracks active groups holding `PRIV_GROUP`; blocks any admin change that would leave zero — checked both at proposal-validation and execution time
- **Box pruning**: `pruneProposal(proposalId, ensureBudgetValue)` deletes a terminal (`STATUS_EXECUTED`/`STATUS_CANCELLED`), past-expiry proposal's box and payload boxes to reclaim MBR; `getActivePrivGroupCount()` is the read-only getter for the lockout counter above

## Working with the `algo-safe` npm package

The frontend depends on `algo-safe` (the contracts package, published to npm; `workspace:*` in this monorepo) for constants, typed clients, and tx-building helpers. The deployed contract has shipped multiple **breaking** versions, so the package supports several approval-program hashes side by side:

- `getAlgoSafeContractVersion(algodClient, appId)` — hashes the deployed approval program and returns its `ContractHash`, or `undefined` if unrecognized.
- `getClient(version ?? 'latest')` — returns the typed client constructor matching that hash. Feed it straight into `algorand.client.getTypedAppClientById(...)`.
- `LATEST_CONTRACT_HASH` — the current deployed version's hash. Compare against it (or treat `undefined`/`'latest'` as latest) to branch on version-specific ABI differences.

**Always detect the version before calling the contract** — never assume `'latest'` is what's actually deployed on a given `appId`.

### Breaking changes seen across versions (don't assume the old shape)
- **Payload is now a tagged envelope.** `proposeTransactionGroup`/`appendTransactionGroupPayload` take `(uint64,byte[])[]` — each entry is `(txType, data)` where `data` is the ARC4 struct for that type. The old flat 24-field `SafeTxn` tuple is gone. `getTransactionGroup` returns these `[txType, data]` tuples; read fields by `decodePaymentTxn` / `decodeAssetTxn` / `decodeAppTxn` / `decodeKeyRegTxn` / `decodeAssetConfigTxn` on `data`, **not** by tuple index. App calls now carry full `onCompletion` + dynamic `appArgs`/`accounts`/`foreignApps`/`foreignAssets`; key-registration and asset-config (`TX_ACFG`, `ACT_ACFG`, `ACT_ALL=31`) are executable transaction types. The frontend's `algoSafeProposals.ts` (`deriveTxPreview`/`deriveAmount`) reads old tuple positions and must be migrated to the decoders.
- `proposeAssetTransfer` was **removed** in the latest contract. Build asset-transfer/opt-in proposals with the generic path instead: `toSafeTxnGroup([createAssetSafeTxn({...})])` passed to `appClient.send.proposeTransactionGroup({ args: { groupId, payload, expiryRound } })`. Same pattern applies to payments via `createPaymentSafeTxn` if you ever need a one-off group.
- `getTransactionGroup` gained a second arg (`payloadIndex`) in the latest contract; the older contract only takes `proposalId`. The client's union type makes this uncallable through normal typing — branch on `isLatest` (from `buildAppClient` in `algoSafeProposals.ts`) and accept a narrow `as any` cast on that one call rather than fighting the union type.
- `Proposal` gained `numPayloads` in the latest contract. Cast `client.getProposal(...)` results to the latest `Proposal` type (`as ContractProposal`) rather than widening every consumer function's signature to the union — none of the current code paths read `numPayloads` from older proposals.
- Bitmask constants follow the **deployed contract**, not any historical npm naming: `PRIV_GROUP=1`, `PRIV_POLICY=2`, `PRIV_ALL=7` (bit 4 reserved). If a published `algo-safe` version exports different names (e.g. `PRIV_MEMBER`, `PRIV_THRESHOLD`), that's a packaging bug — verify against `contract.algo.ts` and fix `src/constants.ts`, don't propagate the wrong names into the frontend.

### Contract change workflow (mandatory)
- **Every change to `contract.algo.ts` must increment `CONTRACT_VERSION`** (the `BIATEC-ALGO-SAFE-vX.Y.Z` constant at the top of the file) **and be followed by `pnpm build`** in `algo-safe-contracts`. The build regenerates artifacts, writes the new client under `clients/<approval-hash>/`, and re-syncs `src/versioned-clients.generated.ts` + `src/latest-client.ts`.
- **One new client connector per git commit.** A commit that changes the contract must add exactly one new `clients/<hash>/` folder — never accumulate several intermediate hashes across build iterations in one commit.
- **Never delete committed clients; prune only uncommitted ones.** Committed `clients/<hash>/` folders correspond to deployed contract versions and must stay for version detection. After a successful build, delete only the *untracked* (not yet committed) `clients/<hash>/` folders that were superseded by newer build iterations — keep the newest — then re-run `pnpm run sync-versioned-client` so the registry only references clients that still exist. `git status --short projects/algo-safe-contracts/clients/` shows which folders are untracked (`??`).

### Conventions
- **Never redefine contract constants locally** in frontend code (`ACT_*`, `ADM_*`, `PRIV_*`, `TX_*`). Always import from `algo-safe` — they must track the deployed contract exactly, and local copies drift silently.
- Build all transaction payloads through `src/safe-tx.ts` helpers (`createPaymentSafeTxn`, `createAssetSafeTxn`, `createAppCallSafeTxn`, `createKeyRegSafeTxn`, `createAssetConfigSafeTxn`, `toSafeTxnTuple`, `toSafeTxnGroup`, or `algosdkTxnsToSafeTxnGroup` to convert native `algosdk.Transaction[]`) and submit via `proposeTransactionGroup`. Don't hand-roll the `(txType, data)` envelope. Read stored payloads back with the matching `decode*Txn` helpers.
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

## Contract authoring gotchas (PuyaTs / AVM — learned the hard way)

These cost real time in past sessions. Read before editing `contract.algo.ts`.

- **Approval program size ceiling is 8192 bytes** (`MaxExtraAppProgramPages = 3` → 4 pages × 2048). Deploy fails with `tx.ExtraProgramPages exceeds MaxExtraAppProgramPages = 3` if you go over. Enumerating per-length tuple branches (e.g. one `if` per app-arg count) blows past this fast. **Measure the compiled size** before assuming it fits — see `/check-program-size` (or POST `smart_contracts/artifacts/algo_safe/AlgoSafe.approval.teal` to algod `/v2/teal/compile` and `base64`-decode `result`).

- **Dynamic arrays for inner-txn array fields:** `itxn` / `itxnCompose` require **statically-sized tuples** for `appArgs` / `accounts` / `assets` / `apps` (passing a runtime array → `error: Unsupported expression for appArgs`). To build them from a runtime-length array, use the **low-level `op.ITxnCreate`** builder — its `setApplicationArgs` / `setAccounts` / `setAssets` / `setApplications` **append one element per call**, so you can emit them in a `for` loop. This is both unrestricted and far smaller than enumerating lengths. `op.ITxnCreate.begin()` / `next()` / `submit()` drive the group; `setTypeEnum(Uint64(TransactionType.X))`, `setFee`, `setReceiver`, etc. set fields.

- **`ensureBudget()` cannot run while an `op.ITxnCreate` group is open.** It issues opup inner transactions, which fail with `itxn_begin without itxn_submit` mid-group. (The typed `itxnCompose` API *buffers* fields and only emits the real `itxn_begin` at `submit`, so it tolerated mid-build `ensureBudget`; `op.ITxnCreate` emits opcodes immediately.) Pattern: **two passes** — pass 1 decode/validate/spend and `ensureBudget(total)` (no group open); pass 2 stage (`begin`/`next`/field-sets, no `ensureBudget`) then `op.ITxnCreate.submit()`.

- **Native array `.length` is typed `number`, not `uint64`.** On arrays read off a decoded struct (`bytes[]`, `Account[]`, `uint64[]`), `arr.length` trips `error: number is not valid as a variable/parameter type`. Wrap it: `Uint64(arr.length)`. (`bytes.length` on a single `bytes` value is already `uint64` — fine.)

- **`Bytes(x, { length: N })` needs a literal-typed `N`** (`error: Bytes size generic ... must be a literal number`) and fails on a runtime value. The `op.ITxnCreate` key setters (`setVotePk`, `setStateProofPk`, `setConfigAssetMetadataHash`) and the `itxn` fields accept plain `bytes`, so just pass the raw `bytes` and let the AVM enforce size at submit.

- **Heterogeneous ABI lists:** encode them as a homogeneous **tagged envelope** `{ kind: uint64; data: bytes }` where `data` is the per-kind ARC4 struct. On-chain: `decodeArc4<T>(entry.data)`. Off-chain: an `algosdk.ABIType.from('(...)')` codec per kind — **the type string must match the struct's field order byte-for-byte.** (This is exactly how `SafeTxn` works: `(txType, data)`, decoded to `PaymentTxn` / `AssetTxn` / `AppTxn` / `KeyRegTxn` / `AssetConfigTxn`.)

- **algosdk `byte[]` / `byte[][]` decode returns plain `number[]`**, not `Uint8Array`, for nested elements — `decode*Txn` helpers must normalise (`Uint8Array.from(...)`) or round-trip `toEqual` assertions fail.

- **Asset-config (`acfg`) create vs reconfigure:** for a **create** do **not** call `setConfigAsset` at all — setting it to `0` triggers `unavailable Asset 0 during assignment`. Only set `ConfigAsset` for reconfigure/destroy (and there, set only the address roles, not the immutable params).

- **App create/update aren't supported via the safe** (no program bytes carried): require `appId != 0` and reject `onCompletion == 4` (UpdateApplication).

## Plan mode

Plans must be extremely concise. Sacrifice grammar for brevity. End plans with a list of unresolved questions if any exist.
