import algosdk from 'algosdk'
import { EMPTY_BYTES, TX_ACFG, TX_APP, TX_ASSET, TX_KEYREG, TX_PAYMENT, TX_REKEY } from './constants'

// ---------------------------------------------------------------------------
// Per-transaction-type payloads
// ---------------------------------------------------------------------------

// `sender` (payment / asset / rekey): the account the inner transaction is
// sent from. The zero address means the safe's application account itself;
// any other value must be an account rekeyed to the safe's application
// address (the AVM rejects inner transactions from any other sender).

export type PaymentPayload = {
  sender: string
  receiver: string
  amount: bigint
  hasClose: bigint
  closeRemainderTo: string
  note: string
}

export type AssetPayload = {
  sender: string
  xferAsset: bigint
  assetReceiver: string
  assetAmount: bigint
  hasClose: bigint
  assetCloseTo: string
  note: string
}

export type AppCallPayload = {
  appId: bigint
  onCompletion: bigint // OnApplicationComplete code: 0 NoOp, 1 OptIn, 2 CloseOut, 3 ClearState, 5 Delete (4/Update unsupported)
  appArgs: Uint8Array[] // up to 16, total length <= 2048 bytes
  accounts: string[] // up to 4 foreign accounts
  foreignApps: bigint[] // up to 8 foreign apps
  foreignAssets: bigint[] // up to 8 foreign assets
  note: string
}

export type KeyRegPayload = {
  online: bigint
  voteKey: Uint8Array
  selectionKey: Uint8Array
  stateProofKey: Uint8Array
  voteFirst: bigint
  voteLast: bigint
  voteKeyDilution: bigint
}

export type AssetConfigPayload = {
  configAsset: bigint // 0 = create, otherwise reconfigure/destroy this asset id
  total: bigint
  decimals: bigint
  defaultFrozen: bigint
  unitName: string
  assetName: string
  url: string
  metadataHash: Uint8Array // 0 or 32 bytes
  manager: string
  reserve: string
  freeze: string
  clawback: string
  note: string
}

// Rekey `sender` (zero address = the safe's application account) to `rekeyTo`.
// Executed as a 0-amount self-payment carrying RekeyTo; requires the group's
// ACT_REKEY action bit. Rekeying the safe itself hands full control of the
// safe address to `rekeyTo` (e.g. a newly deployed safe contract's application
// address during a migration).
export type RekeyPayload = {
  sender: string
  rekeyTo: string
  note: string
}

// ---------------------------------------------------------------------------
// Tagged envelope: every transaction is stored on-chain as `(txType, data)`,
// where `data` is the ARC4 tuple encoding of exactly one of the structs below.
// The contract decodes `data` according to `txType`. Splitting the payload this
// way means a stored transaction only occupies the bytes its own type needs,
// rather than reserving room for every field of every transaction type.
//
// The ARC4 tuple type strings MUST stay byte-for-byte in sync with the matching
// structs in `contract.algo.ts` (field order included).
// ---------------------------------------------------------------------------

const PAYMENT_CODEC = algosdk.ABIType.from('(address,address,uint64,uint64,address,string)')
const ASSET_CODEC = algosdk.ABIType.from('(address,uint64,address,uint64,uint64,address,string)')
const APP_CODEC = algosdk.ABIType.from('(uint64,uint64,byte[][],address[],uint64[],uint64[],string)')
const KEYREG_CODEC = algosdk.ABIType.from('(uint64,byte[],byte[],byte[],uint64,uint64,uint64)')
const ACFG_CODEC = algosdk.ABIType.from(
  '(uint64,uint64,uint64,uint64,string,string,string,byte[],address,address,address,address,string)',
)
const REKEY_CODEC = algosdk.ABIType.from('(address,address,string)')

export type SafeTxn = {
  txType: bigint
  data: Uint8Array
}

export type SafeTxnTuple = [bigint, Uint8Array]

export const ZERO_ADDR = algosdk.encodeAddress(new Uint8Array(32))

export function toSafeTxnTuple(tx: SafeTxn): SafeTxnTuple {
  return [BigInt(tx.txType), tx.data]
}

export function toSafeTxnGroup(txns: SafeTxn[]): SafeTxnTuple[] {
  return txns.map(toSafeTxnTuple)
}

// ---------------------------------------------------------------------------
// Builders — encode a typed payload into a tagged envelope
// ---------------------------------------------------------------------------

export function createPaymentSafeTxn(payload: PaymentPayload): SafeTxn {
  const data = PAYMENT_CODEC.encode([
    payload.sender,
    payload.receiver,
    payload.amount,
    payload.hasClose,
    payload.closeRemainderTo,
    payload.note,
  ])
  return { txType: TX_PAYMENT, data }
}

export function createAssetSafeTxn(payload: AssetPayload): SafeTxn {
  const data = ASSET_CODEC.encode([
    payload.sender,
    payload.xferAsset,
    payload.assetReceiver,
    payload.assetAmount,
    payload.hasClose,
    payload.assetCloseTo,
    payload.note,
  ])
  return { txType: TX_ASSET, data }
}

export function createRekeySafeTxn(payload: RekeyPayload): SafeTxn {
  const data = REKEY_CODEC.encode([payload.sender, payload.rekeyTo, payload.note])
  return { txType: TX_REKEY, data }
}

export function createAppCallSafeTxn(payload: AppCallPayload): SafeTxn {
  const data = APP_CODEC.encode([
    payload.appId,
    payload.onCompletion,
    payload.appArgs,
    payload.accounts,
    payload.foreignApps,
    payload.foreignAssets,
    payload.note,
  ])
  return { txType: TX_APP, data }
}

export function createKeyRegSafeTxn(payload: KeyRegPayload): SafeTxn {
  const data = KEYREG_CODEC.encode([
    payload.online,
    payload.voteKey,
    payload.selectionKey,
    payload.stateProofKey,
    payload.voteFirst,
    payload.voteLast,
    payload.voteKeyDilution,
  ])
  return { txType: TX_KEYREG, data }
}

export function createAssetConfigSafeTxn(payload: AssetConfigPayload): SafeTxn {
  const data = ACFG_CODEC.encode([
    payload.configAsset,
    payload.total,
    payload.decimals,
    payload.defaultFrozen,
    payload.unitName,
    payload.assetName,
    payload.url,
    payload.metadataHash,
    payload.manager,
    payload.reserve,
    payload.freeze,
    payload.clawback,
    payload.note,
  ])
  return { txType: TX_ACFG, data }
}

// ---------------------------------------------------------------------------
// Decoders — read a stored envelope's `data` back into a typed payload. Useful
// for inspecting `getTransactionGroup` results off-chain.
// ---------------------------------------------------------------------------

export function decodePaymentTxn(data: Uint8Array): PaymentPayload {
  const [sender, receiver, amount, hasClose, closeRemainderTo, note] = PAYMENT_CODEC.decode(data) as [
    string,
    string,
    bigint,
    bigint,
    string,
    string,
  ]
  return { sender, receiver, amount, hasClose, closeRemainderTo, note }
}

export function decodeAssetTxn(data: Uint8Array): AssetPayload {
  const [sender, xferAsset, assetReceiver, assetAmount, hasClose, assetCloseTo, note] = ASSET_CODEC.decode(data) as [
    string,
    bigint,
    string,
    bigint,
    bigint,
    string,
    string,
  ]
  return { sender, xferAsset, assetReceiver, assetAmount, hasClose, assetCloseTo, note }
}

export function decodeRekeyTxn(data: Uint8Array): RekeyPayload {
  const [sender, rekeyTo, note] = REKEY_CODEC.decode(data) as [string, string, string]
  return { sender, rekeyTo, note }
}

export function decodeAppTxn(data: Uint8Array): AppCallPayload {
  const [appId, onCompletion, appArgs, accounts, foreignApps, foreignAssets, note] = APP_CODEC.decode(data) as [
    bigint,
    bigint,
    Array<Uint8Array | number[]>,
    string[],
    bigint[],
    bigint[],
    string,
  ]
  // algosdk decodes nested `byte[]` elements as plain number arrays; normalise
  // each application argument back to a Uint8Array.
  const normalisedArgs = appArgs.map((arg) => (arg instanceof Uint8Array ? arg : Uint8Array.from(arg)))
  return { appId, onCompletion, appArgs: normalisedArgs, accounts, foreignApps, foreignAssets, note }
}

function toBytes(value: Uint8Array | number[]): Uint8Array {
  return value instanceof Uint8Array ? value : Uint8Array.from(value)
}

export function decodeKeyRegTxn(data: Uint8Array): KeyRegPayload {
  const [online, voteKey, selectionKey, stateProofKey, voteFirst, voteLast, voteKeyDilution] = KEYREG_CODEC.decode(
    data,
  ) as [bigint, Uint8Array | number[], Uint8Array | number[], Uint8Array | number[], bigint, bigint, bigint]
  return {
    online,
    voteKey: toBytes(voteKey),
    selectionKey: toBytes(selectionKey),
    stateProofKey: toBytes(stateProofKey),
    voteFirst,
    voteLast,
    voteKeyDilution,
  }
}

export function decodeAssetConfigTxn(data: Uint8Array): AssetConfigPayload {
  const [configAsset, total, decimals, defaultFrozen, unitName, assetName, url, metadataHash, manager, reserve, freeze, clawback, note] =
    ACFG_CODEC.decode(data) as [
      bigint,
      bigint,
      bigint,
      bigint,
      string,
      string,
      string,
      Uint8Array,
      string,
      string,
      string,
      string,
      string,
    ]
  return {
    configAsset,
    total,
    decimals,
    defaultFrozen,
    unitName,
    assetName,
    url,
    metadataHash: toBytes(metadataHash as unknown as Uint8Array | number[]),
    manager,
    reserve,
    freeze,
    clawback,
    note,
  }
}

// ---------------------------------------------------------------------------
// Convenience constructors
// ---------------------------------------------------------------------------

export function createPaymentPayload(receiver: string, amount: bigint, note = ''): PaymentPayload {
  return { sender: ZERO_ADDR, receiver, amount, hasClose: 0n, closeRemainderTo: ZERO_ADDR, note }
}

/** Rekey the safe's application account itself to `rekeyTo`. */
export function createRekeyPayload(rekeyTo: string, note = ''): RekeyPayload {
  return { sender: ZERO_ADDR, rekeyTo, note }
}

export function createAppCallPayload(
  appId: bigint,
  appArgs: Uint8Array[] = [],
  opts: {
    onCompletion?: bigint
    accounts?: string[]
    foreignApps?: bigint[]
    foreignAssets?: bigint[]
    note?: string
  } = {},
): AppCallPayload {
  return {
    appId,
    onCompletion: opts.onCompletion ?? 0n,
    appArgs,
    accounts: opts.accounts ?? [],
    foreignApps: opts.foreignApps ?? [],
    foreignAssets: opts.foreignAssets ?? [],
    note: opts.note ?? '',
  }
}

// ---------------------------------------------------------------------------
// algosdk.Transaction → SafeTxn conversion
// ---------------------------------------------------------------------------

function algosdkTxnToSafeTxn(txn: algosdk.Transaction): SafeTxn {
  const note = txn.note ? new TextDecoder().decode(txn.note) : ''
  // The stored sender is passed through as-is; at execution time the AVM only
  // accepts the safe's application account or an account rekeyed to it.
  const sender = txn.sender?.toString() ?? ZERO_ADDR

  if (txn.rekeyTo) {
    const isPureRekey =
      txn.type === algosdk.TransactionType.pay && (txn.payment?.amount ?? 0n) === 0n && !txn.payment?.closeRemainderTo
    if (!isPureRekey) {
      throw new Error('rekeyTo is only supported on a zero-amount payment with no close (stored as a rekey entry)')
    }
    return createRekeySafeTxn({ sender, rekeyTo: txn.rekeyTo.toString(), note })
  }

  if (txn.type === algosdk.TransactionType.pay) {
    const pay = txn.payment
    return createPaymentSafeTxn({
      sender,
      receiver: pay?.receiver?.toString() ?? ZERO_ADDR,
      amount: pay?.amount ?? 0n,
      hasClose: pay?.closeRemainderTo ? 1n : 0n,
      closeRemainderTo: pay?.closeRemainderTo?.toString() ?? ZERO_ADDR,
      note,
    })
  }

  if (txn.type === algosdk.TransactionType.axfer) {
    const axfer = txn.assetTransfer
    return createAssetSafeTxn({
      sender,
      xferAsset: axfer?.assetIndex ?? 0n,
      assetReceiver: axfer?.receiver?.toString() ?? ZERO_ADDR,
      assetAmount: axfer?.amount ?? 0n,
      hasClose: axfer?.closeRemainderTo ? 1n : 0n,
      assetCloseTo: axfer?.closeRemainderTo?.toString() ?? ZERO_ADDR,
      note,
    })
  }

  if (txn.type === algosdk.TransactionType.appl) {
    const appl = txn.applicationCall
    return createAppCallSafeTxn({
      appId: appl?.appIndex ?? 0n,
      onCompletion: BigInt(appl?.onComplete ?? 0),
      appArgs: appl ? appl.appArgs.map((arg) => arg) : [],
      accounts: appl ? appl.accounts.map((acct) => acct.toString()) : [],
      foreignApps: appl ? appl.foreignApps.map((id) => BigInt(id)) : [],
      foreignAssets: appl ? appl.foreignAssets.map((id) => BigInt(id)) : [],
      note,
    })
  }

  if (txn.type === algosdk.TransactionType.keyreg) {
    const kr = txn.keyreg
    // A standard "go offline" keyreg omits the participation keys while leaving
    // nonParticipation unset (nonParticipation: true is the separate, permanent
    // opt-out flag) — so online is derived from key presence, not from
    // nonParticipation alone (2026-07-07-v2 audit, L-02).
    const isOnline = kr?.voteKey && !kr.nonParticipation ? 1n : 0n
    return createKeyRegSafeTxn({
      online: isOnline,
      voteKey: kr?.voteKey ?? EMPTY_BYTES,
      selectionKey: kr?.selectionKey ?? EMPTY_BYTES,
      stateProofKey: kr?.stateProofKey ?? EMPTY_BYTES,
      voteFirst: kr?.voteFirst ?? 0n,
      voteLast: kr?.voteLast ?? 0n,
      voteKeyDilution: kr?.voteKeyDilution ?? 0n,
    })
  }

  if (txn.type === algosdk.TransactionType.acfg) {
    const acfg = txn.assetConfig
    return createAssetConfigSafeTxn({
      configAsset: acfg?.assetIndex ?? 0n,
      total: acfg?.total ?? 0n,
      decimals: BigInt(acfg?.decimals ?? 0),
      defaultFrozen: acfg?.defaultFrozen ? 1n : 0n,
      unitName: acfg?.unitName ?? '',
      assetName: acfg?.assetName ?? '',
      url: acfg?.assetURL ?? '',
      metadataHash: acfg?.assetMetadataHash ?? EMPTY_BYTES,
      manager: acfg?.manager?.toString() ?? ZERO_ADDR,
      reserve: acfg?.reserve?.toString() ?? ZERO_ADDR,
      freeze: acfg?.freeze?.toString() ?? ZERO_ADDR,
      clawback: acfg?.clawback?.toString() ?? ZERO_ADDR,
      note,
    })
  }

  throw new Error(`Unsupported transaction type: ${txn.type}`)
}

export function algosdkTxnsToSafeTxnGroup(txns: algosdk.Transaction[]): SafeTxnTuple[] {
  return toSafeTxnGroup(txns.map(algosdkTxnToSafeTxn))
}
