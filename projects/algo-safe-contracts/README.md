# algo-safe

> Source, issues and full monorepo (contracts + web UI): **[github.com/ludovit-scholtz/algo-safe](https://github.com/ludovit-scholtz/algo-safe)**

Policy-driven **smart account (multisig safe) for Algorand**, plus the TypeScript client utilities to drive it.

The application account *is* the safe: it holds ALGO and ASAs and only moves value when an **M-of-N signer group** has approved a typed proposal. Every privileged change (creating groups, adding/removing signers, changing thresholds and spending policies) is itself a governed proposal approved under the same threshold rules.

This npm package ships:

- the compiled contract artifacts and **version-aware typed clients**,
- **transaction-building helpers** that encode payments, asset transfers, app calls, key registrations and asset configuration into the safe's compact on-chain payload format,
- **off-chain read helpers** for inspecting safes, signer groups and proposals.

---

## Table of contents

- [Install](#install)
- [Core concepts](#core-concepts)
- [Quick start](#quick-start)
- [Validator library (AlgoSafeTxnValidator)](#validator-library-algosafetxnvalidator)
- [Connecting to a deployed safe (version detection)](#connecting-to-a-deployed-safe-version-detection)
- [Building transaction payloads](#building-transaction-payloads)
  - [Payment](#payment)
  - [Asset transfer / opt-in](#asset-transfer--opt-in)
  - [Application call](#application-call)
  - [Key registration](#key-registration)
  - [Asset configuration (create / reconfigure / destroy)](#asset-configuration-create--reconfigure--destroy)
  - [Convert native algosdk transactions](#convert-native-algosdk-transactions)
- [The proposal lifecycle](#the-proposal-lifecycle)
- [Opcode budget (`ensureBudgetValue`)](#opcode-budget-ensurebudgetvalue)
- [Large groups: multiple payload chunks](#large-groups-multiple-payload-chunks)
- [Governance (admin changes)](#governance-admin-changes)
  - [Spending policies (limits, tracked asset, cooldown)](#spending-policies-limits-tracked-asset-cooldown)
  - [Emergency pause](#emergency-pause)
- [Reading on-chain state](#reading-on-chain-state)
- [Decoding stored payloads](#decoding-stored-payloads)
- [Constants & limits reference](#constants--limits-reference)
- [API reference](#api-reference)
- [Developing this package](#developing-this-package)

---

## Install

```bash
npm install algo-safe algosdk @algorandfoundation/algokit-utils
# or
pnpm add algo-safe algosdk @algorandfoundation/algokit-utils
```

`algosdk` (v3) and `@algorandfoundation/algokit-utils` (v9) are peer-level dependencies you interact with directly.

```ts
import {
  // version + client resolution
  getAlgoSafeContractVersion,
  getClient,
  LATEST_CONTRACT_HASH,
  // typed client / factory
  AlgoSafeFactory,
  // payload builders
  toSafeTxnGroup,
  createPaymentSafeTxn,
  createAssetSafeTxn,
  createAppCallSafeTxn,
  createKeyRegSafeTxn,
  createAssetConfigSafeTxn,
  algosdkTxnsToSafeTxnGroup,
  // governance + constants
  createAdminChange,
  ACT_PAY, ACT_AXFER, ACT_APPL, ACT_KEYREG, ACT_ACFG, ACT_ALL,
  PRIV_GROUP, PRIV_POLICY, PRIV_ALL,
  ADM_CREATE_GROUP, ADM_ADD_MEMBER, ADM_CHANGE_THRESHOLD,
  FAR_EXPIRY, ZERO_ADDR,
} from 'algo-safe'
```

---

## Core concepts

| Concept | Meaning |
|---|---|
| **Safe** | A single deployed app instance. Its app account custodies funds and assets. |
| **Signer group** | An M-of-N set of members with an `allowedActions` bitmask (which transaction types it can move) and an `adminPrivileges` bitmask (which governance changes it can make), plus optional daily/monthly spend limits. A safe can have many groups. |
| **Proposal** | A typed, governed action. Two kinds: a **transaction group** (`PT_TRANSACTION_GROUP`) — one or more pay/axfer/appl/keyreg/acfg/rekey transactions executed atomically as inner transactions — or an **admin change** (`PT_ADMIN`). |
| **Payload version** | Every proposal carries a `payloadVersion` (starts at `1`, bumped on every payload edit). An approval names the version the signer reviewed, so a payload edited after review invalidates the pending approval instead of silently binding to different content. |
| **Approval threshold** | A proposal becomes executable once `threshold` distinct group members have approved. The proposer auto-approves on creation. |

**Proposal status:** `STATUS_ACTIVE(1)` → `STATUS_READY(2)` → `STATUS_EXECUTED(3)` or `STATUS_CANCELLED(4)`.

**Payload encoding.** Each transaction in a group is stored on-chain as a compact tagged envelope `(txType, data)`, where `data` is the ARC4 encoding of exactly that transaction type's fields. You never build this by hand — use the `create*SafeTxn` helpers and `toSafeTxnGroup`.

---

## Quick start

Deploy a safe, fund it, bootstrap the genesis admin group, then propose and execute a payment.

```ts
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import {
  AlgoSafeFactory,
  createPaymentSafeTxn,
  deployValidator,
  resolveValidatorAppId,
  toSafeTxnGroup,
  FAR_EXPIRY,
  ZERO_ADDR,
} from 'algo-safe'

const algorand = AlgorandClient.fromEnvironment() // or .fromClients({ algod })
const deployer = await algorand.account.fromEnvironment('DEPLOYER')

// 1. Resolve (or deploy) the AlgoSafeTxnValidator library for this network.
//    The safe pins it by bytecode hash at creation — see "Validator library".
const validatorAppId = await resolveValidatorAppId(algorand.client.algod).catch(() =>
  deployValidator({ algodClient: algorand.client.algod, sender: deployer.addr.toString(), signer: deployer.signer }),
)

// 2. Create the application.
const factory = algorand.client.getTypedAppFactory(AlgoSafeFactory, { defaultSender: deployer.addr })
const { appClient } = await factory.send.create.createApplication({
  args: { name: 'Treasury Safe', validatorAppId },
})

// 3. Fund the app account so it can pay box MBR and inner-transaction fees.
await algorand.send.payment({ sender: deployer.addr, receiver: appClient.appAddress, amount: (5).algo() })

// 4. Bootstrap: creates group #1 as a 1-of-1 admin group whose sole member is the creator.
await appClient.send.bootstrap({ args: { groupName: 'Admins' } })

// 5. Propose a payment from group #1. The proposer auto-approves; a 1-of-1 group is immediately READY.
const { return: proposalId } = await appClient.send.proposeTransactionGroup({
  args: {
    groupId: 1n,
    payload: toSafeTxnGroup([
      createPaymentSafeTxn({
        sender: ZERO_ADDR,   // zero address = the safe itself; or an address rekeyed to the safe
        receiver: 'RECIPIENT_ADDRESS...',
        amount: (1).algo().microAlgo,
        hasClose: 0n,
        closeRemainderTo: ZERO_ADDR,
        note: 'first payout',
      }),
    ]),
    expiryRound: FAR_EXPIRY,
    execute: false,     // set true to execute in this same call once threshold + limits allow it
    ensureBudgetValue: 0n,
  },
  staticFee: (0.2).algo(),
})

// 6. Execute. `coverAppCallInnerTransactionFees` pays the inner transactions' fees from the outer call.
// `ensureBudgetValue` reserves opcode budget up front for the inner-transaction staging below —
// see "Opcode budget" for how to size it.
await appClient.send.executeProposal({
  args: { proposalId: proposalId!, ensureBudgetValue: 6000n },
  coverAppCallInnerTransactionFees: true,
  maxFee: (0.02).algo(),
})
```

> **Funding matters.** The app account pays the minimum-balance requirement for every box it stores (groups, members, proposals, approvals, payloads) and is the sender of all inner transactions. Keep it funded.

---

## Validator library (AlgoSafeTxnValidator)

Since contract v3.0.0 the safe delegates transaction-payload validation (payments, asset transfers, key registrations, asset configs, rekeys) to a separate ~420-byte **library contract**, `AlgoSafeTxnValidator`, called via inner application call during execution. This keeps the safe's approval program comfortably under the AVM's hard 8 192-byte ceiling and concentrates the validation rules in one tiny contract that can be audited once and shared by every safe on a network.

Trust model — the registry is convenience, not trust:

- The validator is **immutable**: its bytecode declares no update or delete handlers, so the ARC-4 router rejects both forever.
- The safe pins the validator by **bytecode hash**, not by ID: `createApplication(name, validatorAppId)` reads the given app's approval program on-chain, hashes it, and asserts it equals the compiled `AlgoSafeTxnValidator` hash baked into the safe's own bytecode. A wrong or malicious app ID simply fails the create call.
- Because the pinned bytecode can never change or be deleted, this single check at creation holds for the safe's whole lifetime.

Operationally:

- `resolveValidatorAppId(algod)` returns the network's registered validator (from `VALIDATOR_DEPLOYMENTS`, keyed by genesis hash) after re-verifying its bytecode hash; pass `{ appId }` to verify a specific deployment instead.
- `deployValidator({ algodClient, sender, signer })` deploys a fresh one (stateless bare create, no funding needed) — any deployment with matching bytecode is equivalent.
- Executions make one inner app call per non-app-call payload entry (~1 min-fee each, covered by `coverAppCallInnerTransactionFees`); with `populateAppCallResources: true` the validator reference is added automatically. Each inner app call also *adds* 700 to the pooled opcode budget, so delegation costs no budget.
- App-call payloads (`TX_APP`) are still validated inside the safe: their `appArgs` can total 2 048 bytes, which cannot fit through the inner-call argument limit.

---

## Connecting to a deployed safe (version detection)

The deployed contract has shipped multiple **breaking** ABI versions. This package keeps every version's typed client side by side and resolves the right one by hashing the deployed approval program. **Always detect the version before calling a safe** — never assume `'latest'`.

```ts
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { getAlgoSafeContractVersion, getClient } from 'algo-safe'

const algorand = AlgorandClient.fromClients({ algod })

const version = await getAlgoSafeContractVersion(algod, appId) // ContractHash | 'latest'
const AlgoSafeClient = getClient(version)                       // matching client constructor

const client = algorand.client.getTypedAppClientById(AlgoSafeClient, {
  appId,
  defaultSender,
})
```

Or use the one-liner helper, which does the version detection for you:

```ts
import { buildAlgoSafeAppClient } from 'algo-safe'

const client = await buildAlgoSafeAppClient(algod, { appId, address: defaultSender })
```

Compare against `LATEST_CONTRACT_HASH` (treat `undefined`/`'latest'` as latest) when you need to branch on version-specific ABI differences.

---

## Building transaction payloads

A transaction-group proposal carries a `payload` — an array of tagged envelopes produced by `toSafeTxnGroup([...])`. Mix any of the builders below in one array; they execute **atomically and in order** as inner transactions of the safe.

```ts
await client.send.proposeTransactionGroup({
  args: {
    groupId,
    payload: toSafeTxnGroup([ /* …safe txns… */ ]),
    expiryRound: FAR_EXPIRY,
    execute: false,
    ensureBudgetValue: 0n,
  },
  staticFee: (0.2).algo(),
})
```

The proposing group's `allowedActions` must permit every transaction type in the payload, and spend limits (if configured) are enforced at execution time.

Pass `execute: true` to attempt execution in the same call — see [the proposal lifecycle](#the-proposal-lifecycle) and [opcode budget](#opcode-budget-ensurebudgetvalue) for when that succeeds and how to size `ensureBudgetValue` for it.

### Payment

```ts
import { createPaymentSafeTxn, createPaymentPayload, ZERO_ADDR } from 'algo-safe'

const pay = createPaymentSafeTxn({
  sender: ZERO_ADDR,            // zero address = the safe itself; any other value must be
                                // an account rekeyed to the safe's application address
  receiver: 'RECIPIENT...',
  amount: (2.5).algo().microAlgo,
  hasClose: 0n,                 // set to 1n to close the account
  closeRemainderTo: ZERO_ADDR,  // required when hasClose === 1n
  note: 'salary',
})

// Shorthand for a plain transfer with no close:
const pay2 = createPaymentSafeTxn(createPaymentPayload('RECIPIENT...', (1).algo().microAlgo, 'note'))
```

### Asset transfer / opt-in

An opt-in is a 0-amount transfer to the safe's own address.

```ts
import { createAssetSafeTxn, ZERO_ADDR } from 'algo-safe'

// Opt the safe in to an ASA:
const optIn = createAssetSafeTxn({
  sender: ZERO_ADDR,   // zero address = the safe itself; or an address rekeyed to the safe
  xferAsset: assetId,
  assetReceiver: client.appAddress.toString(),
  assetAmount: 0n,
  hasClose: 0n,
  assetCloseTo: ZERO_ADDR,
  note: '',
})

// Send 100 units:
const send = createAssetSafeTxn({
  sender: ZERO_ADDR,
  xferAsset: assetId,
  assetReceiver: 'RECIPIENT...',
  assetAmount: 100n,
  hasClose: 0n,
  assetCloseTo: ZERO_ADDR,
  note: '',
})
```

### Application call

Supports the full Algorand app-call shape: up to **16 app args**, **4 accounts**, **8 foreign apps**, **8 foreign assets** (with the combined references ≤ 8), plus the on-completion action. Creating or updating an app (which requires program bytes) is **not** supported via the safe — `appId` must be non-zero and `onCompletion` may not be `UpdateApplication (4)`.

```ts
import { createAppCallSafeTxn, createAppCallPayload } from 'algo-safe'

// Simple no-op call with two args:
const call = createAppCallSafeTxn(
  createAppCallPayload(appId, [new TextEncoder().encode('vote'), new TextEncoder().encode('yes')]),
)

// Full control via the explicit payload:
const richCall = createAppCallSafeTxn({
  appId,
  onCompletion: 0n,                                   // 0 NoOp, 1 OptIn, 2 CloseOut, 3 ClearState, 5 Delete
  appArgs: [new TextEncoder().encode('method')],
  accounts: ['ACCT_A...'],
  foreignApps: [otherAppId],
  foreignAssets: [assetId],
  note: '',
})
```

### Key registration

Register the safe account online (with participation keys) or take it offline (`online: 0n`, empty keys). Requires the group to have `ACT_KEYREG`.

```ts
import { createKeyRegSafeTxn } from 'algo-safe'

const goOnline = createKeyRegSafeTxn({
  online: 1n,
  voteKey,          // 32 bytes
  selectionKey,     // 32 bytes
  stateProofKey,    // 64 bytes
  voteFirst: 1n,
  voteLast: 11_000n,
  voteKeyDilution: 100n,
})

const goOffline = createKeyRegSafeTxn({
  online: 0n,
  voteKey: new Uint8Array(0),
  selectionKey: new Uint8Array(0),
  stateProofKey: new Uint8Array(0),
  voteFirst: 0n,
  voteLast: 0n,
  voteKeyDilution: 0n,
})
```

### Asset configuration (create / reconfigure / destroy)

Requires the group to have `ACT_ACFG`. Set `configAsset: 0n` to **create**; set it to an existing asset id to **reconfigure** (change the manager/reserve/freeze/clawback roles) or **destroy** (all roles zeroed). On reconfigure the immutable params (`total`, `decimals`, names, url, metadata) are ignored.

```ts
import { createAssetConfigSafeTxn, ZERO_ADDR } from 'algo-safe'

// Create a new ASA owned by the safe:
const create = createAssetConfigSafeTxn({
  configAsset: 0n,
  total: 1_000_000n,
  decimals: 0n,
  defaultFrozen: 0n,
  unitName: 'SAFE',
  assetName: 'Safe Asset',
  url: 'https://example.org',
  metadataHash: new Uint8Array(0), // 0 or exactly 32 bytes
  manager: client.appAddress.toString(),
  reserve: client.appAddress.toString(),
  freeze: ZERO_ADDR,
  clawback: ZERO_ADDR,
  note: '',
})
```

### Spending from rekeyed accounts

Any Algorand address can be rekeyed to the safe's application address; from then on the safe can spend from it. Set `sender` on a payment or asset-transfer payload to that address (the zero address always means the safe's own account). The AVM authorizes an inner-transaction sender exactly when it is the application account or an account rekeyed to it, so no extra contract configuration is needed — but spending limits still apply, and a close-out from a rekeyed sender counts that account's full swept balance against the group's limit.

```ts
const fromRekeyed = createPaymentSafeTxn({
  sender: 'REKEYED_TO_SAFE_ADDRESS...',
  receiver: 'RECIPIENT...',
  amount: (1).algo().microAlgo,
  hasClose: 0n,
  closeRemainderTo: ZERO_ADDR,
  note: '',
})
```

### Rekey (migration / release)

Rekeying is reserved for **admin consensus**: the executing group must hold both the `ACT_REKEY` action bit (a deliberately separate bit that `ACT_ALL`-era groups created before v1.5.0 do not hold) **and** the group-admin privilege (`PRIV_GROUP`), and — like any proposal — the rekey only executes once that group's M-of-N approval threshold is met. Both requirements are checked at execution time against the group's live state, because a rekey permanently transfers control of the sender account. Executed as a 0-amount self-payment carrying `RekeyTo`.

- `sender: ZERO_ADDR` rekeys **the safe's own application account** — e.g. to a newly deployed safe contract's application address to migrate custody without moving assets. After this executes, the old contract can no longer spend from the address.
- `sender: <rekeyed address>, rekeyTo: <that same address>` **releases** a previously captured external account back to its own key.

```ts
import { createRekeySafeTxn, createRekeyPayload, ZERO_ADDR } from 'algo-safe'

// Migrate the safe to a new deployment:
const migrate = createRekeySafeTxn({ sender: ZERO_ADDR, rekeyTo: newSafeAppAddress, note: 'migrate' })
// or: createRekeySafeTxn(createRekeyPayload(newSafeAppAddress, 'migrate'))

// Release a rekeyed external account back to its own key:
const release = createRekeySafeTxn({ sender: externalAddr, rekeyTo: externalAddr, note: '' })
```

### Rekeyed-address registry & safe migration

The safe keeps an **admin-governed registry** of external addresses rekeyed to it (`ADM_ADD_REKEYED_ADDR` / `ADM_REMOVE_REKEYED_ADDR` admin changes; `isRekeyedAddress` / `getRekeyedAddress` getters). The registry is bookkeeping — the AVM enforces actual spendability — but it drives migrations: upgrading to a newer contract version means deploying a fresh safe, cloning the configuration, and rekeying every controlled address (registry entries first, the safe's own account last) to the new deployment.

```ts
import {
  buildMigrationRekeyPayload,
  deployClonedSafe,
  fetchSafeCloneConfig,
  listRekeyedAddresses,
} from 'algo-safe'

// 1. Read the old safe's active groups, members, and registry.
const config = await fetchSafeCloneConfig(algod, { appId: oldAppId, address: oldSafeAddress })

// 2. Deploy a fresh latest-contract safe and seed it (creator-only bootstrap
//    phase: bootstrapGroup per group, bootstrapRekeyedAddress per entry, then
//    finalizeBootstrap — no proposals are accepted until the phase closes).
const { appId, appAddress } = await deployClonedSafe({ algodClient: algod, sender, signer, config })

// 3. Governed rekey on the OLD safe: every registered address, then the safe
//    itself. Requires ACT_REKEY + PRIV_GROUP at the group's full threshold.
const rekeyed = await listRekeyedAddresses(algod, oldAppId)
const payload = buildMigrationRekeyPayload(rekeyed.map((r) => r.address), appAddress)
await oldClient.send.proposeTransactionGroup({ args: { groupId: 1n, payload, expiryRound, execute: false, ensureBudgetValue: 0n }, staticFee: (0.2).algo() })
// ... collect approvals, then executeProposal — custody moves to the new safe.
```

### Convert native algosdk transactions

Already have `algosdk.Transaction` objects (e.g. built by another SDK or a dApp)? Convert a whole atomic group into a safe payload in one call. Payment, asset transfer, app call, key registration and asset config are supported. The source transactions' `sender` is carried through for payments and asset transfers — build them with the safe's address (or an address rekeyed to the safe) as sender. A zero-amount, no-close payment carrying `rekeyTo` converts to a rekey entry; `rekeyTo` on any other transaction shape throws.

```ts
import { algosdkTxnsToSafeTxnGroup } from 'algo-safe'

const payload = algosdkTxnsToSafeTxnGroup([payTxn, appCallTxn]) // SafeTxnTuple[]

await client.send.proposeTransactionGroup({
  args: { groupId: 1n, payload, expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 0n },
  staticFee: (0.2).algo(),
})
```

---

## The proposal lifecycle

```ts
// Create (proposer auto-approves).
const { return: proposalId } = await client.send.proposeTransactionGroup({
  args: { /* …groupId, payload, expiryRound… */, execute: false, ensureBudgetValue: 0n },
  staticFee: (0.2).algo(),
})

// Other members review the proposal, then approve until the threshold is met.
// The approval is bound to the payload version the member reviewed: read the
// proposal first, inspect its content (see "Decoding stored payloads"), and pass
// the observed payloadVersion. If the proposer edits the payload between your
// review and your approval landing, the call reverts with 'payload changed since
// review' instead of approving content you never saw. For admin-change proposals
// the version never changes after creation, so it is always 1n.
const reviewed = await readProposal(client, proposalId!)
await client.send.approveProposal({
  args: { proposalId: proposalId!, expectedPayloadVersion: reviewed!.payloadVersion, ensureBudgetValue: 0n },
  sender: memberB,
})

// Anyone can read progress (off-chain box read — see "Reading on-chain state").
const p = await readProposal(client, proposalId!)
// p!.status === 2n  → READY

// Execute once READY.
await client.send.executeProposal({
  args: { proposalId: proposalId!, ensureBudgetValue: 6000n },
  coverAppCallInnerTransactionFees: true,
  maxFee: (0.02).algo(),
})

// Or cancel while pending (proposer or any group member).
await client.send.cancelProposal({ args: { proposalId: proposalId!, ensureBudgetValue: 0n } })
```

Proposals carry an `expiryRound`. **`FAR_EXPIRY` is test/convenience-only — do not use it for real proposals.** Prefer a bounded expiry (e.g. current round + a few days of rounds): a `STATUS_CANCELLED` proposal can only be pruned to reclaim its box MBR once `Global.round > expiryRound`, so a far-future expiry on a proposal that ends up cancelled forfeits that MBR until the round number catches up (v3.2.0 removed this restriction for `STATUS_EXECUTED` proposals, which are now prunable immediately — 2026-07-16 audit M-01). Once expired, a proposal cannot be approved, executed, or have payload chunks appended.

### Propose-and-execute in one call

For a 1-of-1 group (or any group whose threshold the proposer's auto-approval alone satisfies), pass `execute: true` to `proposeTransactionGroup` to skip the separate `executeProposal` call entirely:

```ts
const { return: proposalId } = await client.send.proposeTransactionGroup({
  args: {
    groupId: 1n, // 1-of-1 group
    payload: toSafeTxnGroup([ /* …safe txns… */ ]),
    expiryRound: FAR_EXPIRY,
    execute: true,
    ensureBudgetValue: 6000n, // sized like executeProposal — see "Opcode budget" below
  },
  coverAppCallInnerTransactionFees: true,
  maxFee: (0.02).algo(),
})
// proposal is already STATUS_EXECUTED(3n) here
```

If the group's threshold requires more than the proposer's own approval, or the transactions exceed the group's spending limits, the whole call fails (the proposal is never created) — same as calling `executeProposal` on a proposal that isn't `STATUS_READY` or that fails a spend-limit check.

---

## Opcode budget (`ensureBudgetValue`)

Every public ABI method takes a trailing `ensureBudgetValue: uint64` argument. When it's greater than `1`, the method's *first* action is `ensureBudget(ensureBudgetValue)` — topping up the call's AVM opcode budget (via opup inner transactions) to at least that value before doing any other work. Passing `0n` (or `1n`) skips the top-up entirely, which is correct for the great majority of calls.

**Why the caller decides this, not the contract.** `ensureBudget`'s opup inner transactions must run *before* the contract opens its own inner-transaction group (`op.ITxnCreate` can't interleave with opup's `itxn_begin`/`itxn_submit`), so the budget has to be reserved once, up front, sized for the specific call about to run. The contract can't know that size in advance — it depends on how many transactions are in the payload, how large each is, and how many payload slots are being executed — so the caller supplies it.

**When you actually need it:** only for `executeProposal` and `proposeTransactionGroup(..., execute: true)`, and only when the proposal executes a transaction group (not an admin change). Every other method accepts `ensureBudgetValue: 0n`. (`createApplication` and `bootstrap` don't take the argument at all.)

| Method | Recommended `ensureBudgetValue` | Why |
|---|---|---|
| `proposeTransactionGroup` (`execute: false`) | `0n` | Storing a payload chunk doesn't decode or stage inner transactions. |
| `proposeTransactionGroup` (`execute: true`) | Same as `executeProposal` below | It runs the identical execution path after auto-approving. |
| `appendTransactionGroupPayload` | `0n` | Same as `proposeTransactionGroup(execute: false)` — storage only. |
| `proposeAdminChange` | `0n` | Validation only; no inner transactions. |
| `approveProposal` | `0n` | A single box write. |
| `executeProposal` | See formula below | Decodes every transaction in every payload slot, then stages them as inner transactions — the only method whose opcode cost scales with the proposal's contents. |
| `cancelProposal` | `0n` | A single status update. |
| _(read state)_ | n/a | State reads happen off-chain via the `read*` helpers — no app call at all. |

**Sizing `executeProposal` (and `proposeTransactionGroup(..., execute: true)`).** The cost is dominated by decoding + validating each transaction (pass 1) and staging each as an inner transaction (pass 2). A conservative estimate, summed over every transaction across every payload slot on the proposal:

```
ensureBudgetValue = 3400
                  + (number of transactions × 700)
                  + Σ per-transaction extra:
                      800   for a payment or asset transfer
                      1000  for a key registration
                      1500  for an asset configuration
                      1500 + 400×(appArgs.length) + 200×(accounts.length + foreignApps.length + foreignAssets.length)
                            for an application call
```

For example, a single payment: `3400 + 700 + 800 = 4900`. Six payments: `3400 + 4200 + 4800 = 12400`. Round up generously — overshooting costs a few extra opup inner transactions (and their fees, which `coverAppCallInnerTransactionFees` + a comfortable `maxFee` will cover); undershooting fails the call with an opcode-budget error partway through staging.

For admin-change proposals (`proposeAdminChange` → `executeProposal`), `0n` is enough — there's no transaction-group decoding or staging.

---

## Large groups: multiple payload chunks

A single ABI argument is limited to ~2 KB, so very large transaction groups are split across **payload slots 1–6**. Create with slot 1, then append the rest *before* the proposal is executed:

```ts
const { return: pid } = await client.send.proposeTransactionGroup({
  args: { groupId: 1n, payload: toSafeTxnGroup(firstChunk), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 0n },
  staticFee: (0.2).algo(),
})

await client.send.appendTransactionGroupPayload({
  args: { proposalId: pid!, payloadIndex: 2n, payload: toSafeTxnGroup(secondChunk), ensureBudgetValue: 0n },
  staticFee: (0.1).algo(),
})
```

All slots execute atomically, in slot then array order, when the proposal is executed. The **aggregate transaction count across all slots is capped at 16** (`MAX_GROUP_TXNS`, tracked in `Proposal.totalTxns` and enforced at append time) — chunking exists for *byte size* (many or large transactions that don't fit one ~2 KB ABI argument), not to exceed the group-size limit. Re-writing an already-used slot replaces its contribution to the total rather than double-counting it.

A few more rules for appends:

- Only the **original proposer** can append, and only while they are still a member of the group.
- Appending is blocked once any **independent approval** has landed (`approvalsCount > 1`), once the proposal has **expired**, and while the safe is **paused**.
- Every successful append bumps `payloadVersion`, so approvals collected before an edit are invalidated (see [the proposal lifecycle](#the-proposal-lifecycle)).

---

## Governance (admin changes)

Group/policy changes are themselves governed proposals. Build the change with `createAdminChange` (it fills sensible defaults), propose it from an admin-capable group, and execute it once approved.

```ts
import { createAdminChange, ADM_CREATE_GROUP, ADM_ADD_MEMBER, ADM_CHANGE_THRESHOLD, ACT_PAY, PRIV_GROUP, FAR_EXPIRY } from 'algo-safe'

async function govern(change) {
  const { return: pid } = await client.send.proposeAdminChange({
    args: { groupId: 1n, change, expiryRound: FAR_EXPIRY, ensureBudgetValue: 0n },
    staticFee: (0.2).algo(),
  })
  await client.send.executeProposal({
    args: { proposalId: pid!, ensureBudgetValue: 0n }, // admin changes don't decode/stage a transaction group
    coverAppCallInnerTransactionFees: true,
    maxFee: (0.02).algo(),
  })
}

// Create a pay-only Treasury group with member A:
await govern(createAdminChange({
  changeType: ADM_CREATE_GROUP,
  groupName: 'Treasury',
  threshold: 1n,
  memberAddr: 'MEMBER_A...',
  allowedActions: ACT_PAY,
  adminPrivileges: 0n,
}))

// Add member B, then require 2-of-2:
await govern(createAdminChange({ changeType: ADM_ADD_MEMBER, targetGroupId: 2n, memberAddr: 'MEMBER_B...' }))
await govern(createAdminChange({ changeType: ADM_CHANGE_THRESHOLD, targetGroupId: 2n, threshold: 2n }))
```

Admin change types: `ADM_CREATE_GROUP`, `ADM_ADD_MEMBER`, `ADM_REMOVE_MEMBER`, `ADM_CHANGE_THRESHOLD`, `ADM_SET_POLICY` (actions + spend limits), `ADM_SET_PRIVILEGES`, `ADM_SET_ACTIVE`, `ADM_ADD_REKEYED_ADDR` / `ADM_REMOVE_REKEYED_ADDR` (rekeyed-address registry), `ADM_SET_PAUSED` (emergency pause). `ADM_SET_POLICY` requires `PRIV_POLICY`; all others require `PRIV_GROUP`.

### Spending policies (limits, tracked asset, cooldown)

`ADM_SET_POLICY` sets a group's allowed actions, spend limits, and execution cooldown in one change. Limits track **one asset per group** (`limitAssetId: 0n` = ALGO, otherwise that ASA) over fixed daily/monthly windows; `0n` means "no limit". A close-out counts the account's *entire swept balance* against the limit, so closes can't bypass it.

```ts
import { createAdminChange, ADM_SET_POLICY, ACT_PAY, ACT_AXFER } from 'algo-safe'

// Treasury group: payments + asset transfers only, max 100 ALGO/day and
// 1000 ALGO/month, and at least 30 rounds between executions.
await govern(createAdminChange({
  changeType: ADM_SET_POLICY,
  targetGroupId: 2n,
  allowedActions: ACT_PAY | ACT_AXFER,
  limitAssetId: 0n,                       // 0 = track ALGO; set an ASA id to track that asset instead
  dailyLimit: (100).algo().microAlgo,
  monthlyLimit: (1000).algo().microAlgo,
  cooldownRounds: 30n,
}))
```

Changing `limitAssetId` resets the usage counters. `cooldownRounds` throttles successive transaction-group executions (the group's first-ever execution is exempt) and is capped at 10,000,000 rounds.

### Emergency pause

`ADM_SET_PAUSED` (reusing `activeFlag` as the desired paused state) freezes all **fund-moving** activity: while paused, transaction-group proposals cannot be created, appended to, or executed. Governance is deliberately never blocked by pause — admin-change proposals (including the unpause itself) can always be proposed, approved, and executed, so pausing can never brick the safe.

```ts
import { createAdminChange, ADM_SET_PAUSED } from 'algo-safe'

// Pause (e.g. suspected signer compromise):
await govern(createAdminChange({ changeType: ADM_SET_PAUSED, activeFlag: 1n }))

// Global state reflects it (see "Reading on-chain state"):
import { readSafeConfig } from 'algo-safe'
const config = await readSafeConfig(client)
// config.paused === 1n → paused

// Unpause — works even while paused:
await govern(createAdminChange({ changeType: ADM_SET_PAUSED, activeFlag: 0n }))
```

---

## Reading on-chain state

All safe state lives in plain box / global state, so it is read **off-chain, for free** — v3.0.0 removed the read-only ABI getters entirely (they existed only to re-serve box data and consumed ~700 bytes of the 8 192-byte program budget). Use the reader functions, which work against **every** deployed contract version:

```ts
import {
  readSafeConfig, readSignerGroup, readMember, readIsMember,
  readProposal, readTransactionGroup, readHasApproved,
  readRekeyedAddress, readAssetGuard,
} from 'algo-safe'

const config  = await readSafeConfig(client)          // { name, groupCount, nextGroupId, nextProposalId, paused, version, activePrivGroupCount }
const group   = await readSignerGroup(client, 1n)     // SignerGroup | undefined
const member  = await readMember(client, 1n, account) // Member | undefined
const isMem   = await readIsMember(client, 1n, account)
const prop    = await readProposal(client, 1n)        // Proposal | undefined
const approved= await readHasApproved(client, 1n, account)
const stored  = await readTransactionGroup(client, 1n, 1n) // [txType, data][] | undefined
```

A missing box resolves to `undefined` (the pre-v3 getters reverted instead). On pre-v3 safes the legacy `client.send.get*` getters still exist on-chain and in their versioned clients, but the readers above are the recommended path everywhere.

Higher-level helpers (no manual client wiring; they detect the version, page boxes, and shape the results for UIs):

```ts
import { fetchAlgoSafeSignerGroups, fetchAlgoSafeSignerGroupDetail } from 'algo-safe'

const groups = await fetchAlgoSafeSignerGroups(algod, { appId, address })
const detail = await fetchAlgoSafeSignerGroupDetail(algod, { appId, address }, '2', activeAddress)
// detail.group, detail.members, detail.adminGroupOptions
```

---

## Decoding stored payloads

`readTransactionGroup` returns the raw `(txType, data)` tuples. Decode the `data` blob per type:

```ts
import { TX_PAYMENT, TX_ASSET, TX_APP, TX_KEYREG, TX_ACFG, TX_REKEY, decodePaymentTxn, decodeAssetTxn, decodeAppTxn, decodeKeyRegTxn, decodeAssetConfigTxn, decodeRekeyTxn, readTransactionGroup } from 'algo-safe'

const stored = await readTransactionGroup(client, 1n, 1n)
for (const [txType, data] of stored ?? []) {
  if (txType === TX_PAYMENT) console.log(decodePaymentTxn(data))
  else if (txType === TX_ASSET) console.log(decodeAssetTxn(data))
  else if (txType === TX_APP) console.log(decodeAppTxn(data))
  else if (txType === TX_KEYREG) console.log(decodeKeyRegTxn(data))
  else if (txType === TX_ACFG) console.log(decodeAssetConfigTxn(data))
  else if (txType === TX_REKEY) console.log(decodeRekeyTxn(data))
}
```

---

## Constants & limits reference

Always import these from `algo-safe` — never redefine them locally; they must track the deployed contract exactly.

**Allowed-action bitmask** (`SignerGroup.allowedActions`):

| Constant | Value | Permits |
|---|---|---|
| `ACT_PAY` | 1 | payments |
| `ACT_AXFER` | 2 | asset transfers |
| `ACT_APPL` | 4 | application calls |
| `ACT_KEYREG` | 8 | key registration |
| `ACT_ACFG` | 16 | asset configuration |
| `ACT_REKEY` | 32 | rekeying the safe or a rekeyed sender |
| `ACT_ALL` | 63 | all of the above |

**Admin-privilege bitmask** (`SignerGroup.adminPrivileges`): `PRIV_GROUP` (1), `PRIV_POLICY` (2), `PRIV_ALL` (7).

**Transaction type discriminators:** `TX_PAYMENT` (1), `TX_ASSET` (2), `TX_APP` (3), `TX_KEYREG` (4), `TX_ACFG` (5), `TX_REKEY` (6).

**Admin change types:** `ADM_CREATE_GROUP` (1), `ADM_ADD_MEMBER` (2), `ADM_REMOVE_MEMBER` (3), `ADM_CHANGE_THRESHOLD` (4), `ADM_SET_POLICY` (5), `ADM_SET_PRIVILEGES` (6), `ADM_SET_ACTIVE` (7), `ADM_ADD_REKEYED_ADDR` (8), `ADM_REMOVE_REKEYED_ADDR` (9) — these two manage the rekeyed-address registry and reuse `memberAddr`/`memberLabel` — and `ADM_SET_PAUSED` (10), which reuses `activeFlag` as the desired paused state.

**App-call limits** (Algorand consensus parameters, enforced at execution): `MAX_APP_ARGS` (16), `MAX_APP_TOTAL_ARG_LEN` (2048), `MAX_APP_ACCOUNTS` (4), `MAX_APP_FOREIGN_APPS` (8), `MAX_APP_FOREIGN_ASSETS` (8), `MAX_APP_TOTAL_REFS` (8 — accounts + apps + assets combined).

**Misc:** `ZERO_ADDR` (the all-zero Algorand address), `EMPTY_BYTES`, `FAR_EXPIRY` (a far-future round for proposal expiry — **test/convenience only**; see "Approve, execute, cancel" for the MBR-reclamation tradeoff of using it on a real proposal).

---

## API reference

| Export | Purpose |
|---|---|
| `AlgoSafeFactory` | Typed factory for creating/deploying a safe (latest version). |
| `getClient(version?)` | Resolve the typed client constructor for a contract hash (or `'latest'`). |
| `getAlgoSafeContractVersion(algod, appId)` | Hash the deployed approval program → its `ContractHash` (or `'latest'`). |
| `LATEST_CONTRACT_HASH`, `DEFAULT_CLIENT_VERSION` | Current version hash / default selector. |
| `buildAlgoSafeAppClient(algod, { appId, address })` | Version-detect and return a ready typed client. |
| `toSafeTxnGroup(txns)` / `toSafeTxnTuple(txn)` | Convert builder output into the ABI payload shape. |
| `createPaymentSafeTxn` / `createAssetSafeTxn` / `createAppCallSafeTxn` / `createKeyRegSafeTxn` / `createAssetConfigSafeTxn` / `createRekeySafeTxn` | Build one typed safe transaction. |
| `createPaymentPayload` / `createAppCallPayload` / `createRekeyPayload` | Convenience payload constructors. |
| `algosdkTxnsToSafeTxnGroup(txns)` | Convert native `algosdk.Transaction[]` → payload. |
| `decodePaymentTxn` / `decodeAssetTxn` / `decodeAppTxn` / `decodeKeyRegTxn` / `decodeAssetConfigTxn` / `decodeRekeyTxn` | Decode a stored `data` blob back into a typed payload. |
| `createAdminChange(partial)` | Build an `AdminChange` with defaults filled in. |
| `readSafeConfig` / `readSignerGroup` / `readMember` / `readIsMember` / `readProposal` / `readTransactionGroup` / `readHasApproved` / `readRekeyedAddress` / `readAssetGuard` | Box/global-state readers — the replacement for the ABI getters removed in v3.0.0; work on every contract version. |
| `resolveValidatorAppId(algod, { appId? })` | Resolve + hash-verify the AlgoSafeTxnValidator app for the connected network. |
| `deployValidator({ algodClient, sender, signer })` | Deploy the validator library (bare create; immutable, stateless). |
| `verifyValidatorApp(algod, appId)` / `VALIDATOR_APPROVAL_SHA256_HEX` / `VALIDATOR_DEPLOYMENTS` | Bytecode-hash verification primitives and the per-network registry. |
| `fetchAlgoSafeSignerGroups` / `fetchAlgoSafeSignerGroupDetail` | Off-chain read helpers for UIs. |
| `fetchSafeVersionStatus(algod, appId)` | Deployed version hash + whether it is the latest. |
| `listRekeyedAddresses(algod, appId)` | Read the rekeyed-address registry (box enumeration). |
| `fetchSafeCloneConfig(algod, safe)` | Read active groups, members, and the registry for cloning. |
| `deployClonedSafe({...})` | Deploy a fresh latest-contract safe and seed it with a clone config. |
| `buildMigrationRekeyPayload(addresses, newSafeAddress)` | Rekey payload: every registered address, then the safe itself. |
| Types: `SafeTxn`, `SafeTxnTuple`, `PaymentPayload`, `AssetPayload`, `AppCallPayload`, `KeyRegPayload`, `AssetConfigPayload`, `RekeyPayload`, `AdminChange`, `Proposal`, `SignerGroup`, `Member`, `ContractHash`, `ContractVersion`, `AlgoSafeOnChainRef`, `AlgoSafeSignerGroupRecord`, … | |

---

## Developing this package

This folder is also the contracts source. Requires Node 22+, the [AlgoKit CLI](https://github.com/algorandfoundation/algokit-cli), Docker (for LocalNet) and the PuyaTs compiler (pulled in via npm).

```bash
pnpm install                  # install dependencies
pnpm build                    # compile TS → AVM + regenerate typed clients + sync versioned clients
pnpm build-package            # bundle the npm package (tsup + d.ts)
pnpm test                     # unit tests + coverage (no localnet needed)
pnpm test:e2e                 # e2e tests against localnet  (start it first: `algokit localnet start`)
pnpm lint                     # ESLint
```

> On Windows/Git Bash the `test:e2e` glob may not expand — run a spec directly:
> `pnpm exec vitest run smart_contracts/algo_safe/contract.e2e.spec.ts`.

**Key source files**

| File | Purpose |
|---|---|
| `smart_contracts/algo_safe/contract.algo.ts` | The contract — all safe logic. |
| `smart_contracts/algo_safe/contract.e2e.spec.ts` | End-to-end tests against LocalNet. |
| `src/safe-tx.ts` | Transaction-building + decoding helpers. |
| `src/constants.ts` | Action/privilege/tx-type/limit constants (source of truth for the frontend). |
| `src/on-chain.ts` | On-chain read helpers. |
| `src/version.ts`, `src/get-client.ts` | Version detection and client resolution. |

**Versioned clients.** Each `pnpm build` snapshots the generated client under `clients/<approval-program-sha256>/` and refreshes `src/versioned-clients.generated.ts` (never hand-edit it). `getAlgoSafeContractVersion` + `getClient` use this registry so old and new deployments are both callable from one package version.

Built with [Algorand TypeScript (PuyaTs)](https://github.com/algorandfoundation/puya-ts/), [AlgoKit](https://github.com/algorandfoundation/algokit-cli) and [AlgoKit Utils](https://github.com/algorandfoundation/algokit-utils-ts).
