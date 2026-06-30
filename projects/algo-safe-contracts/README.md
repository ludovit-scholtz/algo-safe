# algo-safe

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
- [Connecting to a deployed safe (version detection)](#connecting-to-a-deployed-safe-version-detection)
- [Building transaction payloads](#building-transaction-payloads)
  - [Payment](#payment)
  - [Asset transfer / opt-in](#asset-transfer--opt-in)
  - [Application call](#application-call)
  - [Key registration](#key-registration)
  - [Asset configuration (create / reconfigure / destroy)](#asset-configuration-create--reconfigure--destroy)
  - [Convert native algosdk transactions](#convert-native-algosdk-transactions)
- [The proposal lifecycle](#the-proposal-lifecycle)
- [Large groups: multiple payload chunks](#large-groups-multiple-payload-chunks)
- [Governance (admin changes)](#governance-admin-changes)
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
| **Proposal** | A typed, governed action. Two kinds: a **transaction group** (`PT_TRANSACTION_GROUP`) — one or more pay/axfer/appl/keyreg/acfg transactions executed atomically as inner transactions — or an **admin change** (`PT_ADMIN`). |
| **Approval threshold** | A proposal becomes executable once `threshold` distinct group members have approved. The proposer auto-approves on creation. |

**Proposal status:** `STATUS_ACTIVE(1)` → `STATUS_READY(2)` → `STATUS_EXECUTED(3)` or `STATUS_CANCELLED(4)`.

**Payload encoding.** Each transaction in a group is stored on-chain as a compact tagged envelope `(txType, data)`, where `data` is the ARC4 encoding of exactly that transaction type's fields. You never build this by hand — use the `create*SafeTxn` helpers and `toSafeTxnGroup`.

---

## Quick start

Deploy a safe, fund it, bootstrap the genesis admin group, then propose and execute a payment.

```ts
import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoSafeFactory, toSafeTxnGroup, createPaymentSafeTxn, FAR_EXPIRY, ZERO_ADDR } from 'algo-safe'

const algorand = AlgorandClient.fromEnvironment() // or .fromClients({ algod })
const deployer = await algorand.account.fromEnvironment('DEPLOYER')

// 1. Create the application.
const factory = algorand.client.getTypedAppFactory(AlgoSafeFactory, { defaultSender: deployer.addr })
const { appClient } = await factory.send.create.createApplication({ args: { name: 'Treasury Safe' } })

// 2. Fund the app account so it can pay box MBR and inner-transaction fees.
await algorand.send.payment({ sender: deployer.addr, receiver: appClient.appAddress, amount: (5).algo() })

// 3. Bootstrap: creates group #1 as a 1-of-1 admin group whose sole member is the creator.
await appClient.send.bootstrap({ args: { groupName: 'Admins' } })

// 4. Propose a payment from group #1. The proposer auto-approves; a 1-of-1 group is immediately READY.
const { return: proposalId } = await appClient.send.proposeTransactionGroup({
  args: {
    groupId: 1n,
    payload: toSafeTxnGroup([
      createPaymentSafeTxn({
        receiver: 'RECIPIENT_ADDRESS...',
        amount: (1).algo().microAlgo,
        hasClose: 0n,
        closeRemainderTo: ZERO_ADDR,
        note: 'first payout',
      }),
    ]),
    expiryRound: FAR_EXPIRY,
  },
  staticFee: (0.2).algo(),
})

// 5. Execute. `coverAppCallInnerTransactionFees` pays the inner transactions' fees from the outer call.
await appClient.send.executeProposal({
  args: { proposalId: proposalId! },
  coverAppCallInnerTransactionFees: true,
  maxFee: (0.02).algo(),
})
```

> **Funding matters.** The app account pays the minimum-balance requirement for every box it stores (groups, members, proposals, approvals, payloads) and is the sender of all inner transactions. Keep it funded.

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
  args: { groupId, payload: toSafeTxnGroup([ /* …safe txns… */ ]), expiryRound: FAR_EXPIRY },
  staticFee: (0.2).algo(),
})
```

The proposing group's `allowedActions` must permit every transaction type in the payload, and spend limits (if configured) are enforced at execution time.

### Payment

```ts
import { createPaymentSafeTxn, createPaymentPayload, ZERO_ADDR } from 'algo-safe'

const pay = createPaymentSafeTxn({
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
  xferAsset: assetId,
  assetReceiver: client.appAddress.toString(),
  assetAmount: 0n,
  hasClose: 0n,
  assetCloseTo: ZERO_ADDR,
  note: '',
})

// Send 100 units:
const send = createAssetSafeTxn({
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

### Convert native algosdk transactions

Already have `algosdk.Transaction` objects (e.g. built by another SDK or a dApp)? Convert a whole atomic group into a safe payload in one call. Payment, asset transfer, app call, key registration and asset config are supported. The sender of the source transactions is irrelevant — the safe re-issues each as an inner transaction.

```ts
import { algosdkTxnsToSafeTxnGroup } from 'algo-safe'

const payload = algosdkTxnsToSafeTxnGroup([payTxn, appCallTxn]) // SafeTxnTuple[]

await client.send.proposeTransactionGroup({
  args: { groupId: 1n, payload, expiryRound: FAR_EXPIRY },
  staticFee: (0.2).algo(),
})
```

---

## The proposal lifecycle

```ts
// Create (proposer auto-approves).
const { return: proposalId } = await client.send.proposeTransactionGroup({ args: { /* … */ } , staticFee: (0.2).algo() })

// Other members approve until the threshold is met.
await client.send.approveProposal({ args: { proposalId: proposalId! }, sender: memberB })

// Anyone can read progress.
const p = await client.send.getProposal({ args: { proposalId: proposalId! } })
// p.return.status === 2n  → READY

// Execute once READY.
await client.send.executeProposal({
  args: { proposalId: proposalId! },
  coverAppCallInnerTransactionFees: true,
  maxFee: (0.02).algo(),
})

// Or cancel while pending (proposer or any group member).
await client.send.cancelProposal({ args: { proposalId: proposalId! } })
```

Proposals carry an `expiryRound`; create with a comfortably future round (`FAR_EXPIRY` is provided for tests/convenience) and they cannot be approved or executed once expired.

---

## Large groups: multiple payload chunks

A single ABI argument is limited to ~2 KB, so very large transaction groups are split across **payload slots 1–6**. Create with slot 1, then append the rest *before* the proposal is executed:

```ts
const { return: pid } = await client.send.proposeTransactionGroup({
  args: { groupId: 1n, payload: toSafeTxnGroup(firstChunk), expiryRound: FAR_EXPIRY },
  staticFee: (0.2).algo(),
})

await client.send.appendTransactionGroupPayload({
  args: { proposalId: pid!, payloadIndex: 2n, payload: toSafeTxnGroup(secondChunk) },
  staticFee: (0.1).algo(),
})
```

All slots execute atomically, in slot then array order, when the proposal is executed. The first chunk is capped at 16 transactions (`MAX_GROUP_TXNS`); spreading across slots 1–6 allows larger groups, bounded by the AVM inner-transaction and opcode-budget limits.

---

## Governance (admin changes)

Group/policy changes are themselves governed proposals. Build the change with `createAdminChange` (it fills sensible defaults), propose it from an admin-capable group, and execute it once approved.

```ts
import { createAdminChange, ADM_CREATE_GROUP, ADM_ADD_MEMBER, ADM_CHANGE_THRESHOLD, ACT_PAY, PRIV_GROUP, FAR_EXPIRY } from 'algo-safe'

async function govern(change) {
  const { return: pid } = await client.send.proposeAdminChange({
    args: { groupId: 1n, change, expiryRound: FAR_EXPIRY },
    staticFee: (0.2).algo(),
  })
  await client.send.executeProposal({ args: { proposalId: pid! }, coverAppCallInnerTransactionFees: true, maxFee: (0.02).algo() })
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

Admin change types: `ADM_CREATE_GROUP`, `ADM_ADD_MEMBER`, `ADM_REMOVE_MEMBER`, `ADM_CHANGE_THRESHOLD`, `ADM_SET_POLICY` (actions + spend limits), `ADM_SET_PRIVILEGES`, `ADM_SET_ACTIVE`. `ADM_SET_POLICY` requires `PRIV_POLICY`; all others require `PRIV_GROUP`.

---

## Reading on-chain state

Read-only ABI getters on the client:

```ts
const config = await client.send.getConfig({ args: {} })
// [name, groupCount, nextGroupId, nextProposalId, paused, version]

const group   = await client.send.getSignerGroup({ args: { groupId: 1n } })
const member  = await client.send.getMember({ args: { groupId: 1n, account } })
const isMem   = await client.send.isMember({ args: { groupId: 1n, account } })
const prop    = await client.send.getProposal({ args: { proposalId: 1n } })
const approved= await client.send.hasApproved({ args: { proposalId: 1n, account } })
const stored  = await client.send.getTransactionGroup({ args: { proposalId: 1n, payloadIndex: 1n } })
```

Higher-level helpers (no manual client wiring; they detect the version, page boxes, and shape the results for UIs):

```ts
import { fetchAlgoSafeSignerGroups, fetchAlgoSafeSignerGroupDetail } from 'algo-safe'

const groups = await fetchAlgoSafeSignerGroups(algod, { appId, address })
const detail = await fetchAlgoSafeSignerGroupDetail(algod, { appId, address }, '2', activeAddress)
// detail.group, detail.members, detail.adminGroupOptions
```

---

## Decoding stored payloads

`getTransactionGroup` returns the raw `(txType, data)` tuples. Decode the `data` blob per type:

```ts
import { TX_PAYMENT, TX_ASSET, TX_APP, TX_KEYREG, TX_ACFG, decodePaymentTxn, decodeAssetTxn, decodeAppTxn, decodeKeyRegTxn, decodeAssetConfigTxn } from 'algo-safe'

const stored = await client.send.getTransactionGroup({ args: { proposalId: 1n, payloadIndex: 1n } })
for (const [txType, data] of stored.return!) {
  if (txType === TX_PAYMENT) console.log(decodePaymentTxn(data))
  else if (txType === TX_ASSET) console.log(decodeAssetTxn(data))
  else if (txType === TX_APP) console.log(decodeAppTxn(data))
  else if (txType === TX_KEYREG) console.log(decodeKeyRegTxn(data))
  else if (txType === TX_ACFG) console.log(decodeAssetConfigTxn(data))
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
| `ACT_ALL` | 31 | all of the above |

**Admin-privilege bitmask** (`SignerGroup.adminPrivileges`): `PRIV_GROUP` (1), `PRIV_POLICY` (2), `PRIV_ALL` (7).

**Transaction type discriminators:** `TX_PAYMENT` (1), `TX_ASSET` (2), `TX_APP` (3), `TX_KEYREG` (4), `TX_ACFG` (5).

**Admin change types:** `ADM_CREATE_GROUP` (1), `ADM_ADD_MEMBER` (2), `ADM_REMOVE_MEMBER` (3), `ADM_CHANGE_THRESHOLD` (4), `ADM_SET_POLICY` (5), `ADM_SET_PRIVILEGES` (6), `ADM_SET_ACTIVE` (7).

**App-call limits** (Algorand consensus parameters, enforced at execution): `MAX_APP_ARGS` (16), `MAX_APP_TOTAL_ARG_LEN` (2048), `MAX_APP_ACCOUNTS` (4), `MAX_APP_FOREIGN_APPS` (8), `MAX_APP_FOREIGN_ASSETS` (8), `MAX_APP_TOTAL_REFS` (8 — accounts + apps + assets combined).

**Misc:** `ZERO_ADDR` (the all-zero Algorand address), `EMPTY_BYTES`, `FAR_EXPIRY` (a far-future round for proposal expiry).

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
| `createPaymentSafeTxn` / `createAssetSafeTxn` / `createAppCallSafeTxn` / `createKeyRegSafeTxn` / `createAssetConfigSafeTxn` | Build one typed safe transaction. |
| `createPaymentPayload` / `createAppCallPayload` | Convenience payload constructors. |
| `algosdkTxnsToSafeTxnGroup(txns)` | Convert native `algosdk.Transaction[]` → payload. |
| `decodePaymentTxn` / `decodeAssetTxn` / `decodeAppTxn` / `decodeKeyRegTxn` / `decodeAssetConfigTxn` | Decode a stored `data` blob back into a typed payload. |
| `createAdminChange(partial)` | Build an `AdminChange` with defaults filled in. |
| `fetchAlgoSafeSignerGroups` / `fetchAlgoSafeSignerGroupDetail` | Off-chain read helpers for UIs. |
| Types: `SafeTxn`, `SafeTxnTuple`, `PaymentPayload`, `AssetPayload`, `AppCallPayload`, `KeyRegPayload`, `AssetConfigPayload`, `AdminChange`, `Proposal`, `SignerGroup`, `Member`, `ContractHash`, `ContractVersion`, `AlgoSafeOnChainRef`, `AlgoSafeSignerGroupRecord`, … | |

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
