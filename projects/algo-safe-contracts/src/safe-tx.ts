import algosdk from 'algosdk'
import type { PaymentPayload } from '../smart_contracts/artifacts/algo_safe/AlgoSafeClient'
import { EMPTY_BYTES, TX_APP, TX_ASSET, TX_KEYREG, TX_PAYMENT } from './constants'

export type AssetPayload = {
  xferAsset: bigint
  assetReceiver: string
  assetAmount: bigint
  hasClose: bigint
  assetCloseTo: string
  note: string
}

export type AppCallPayload = {
  appId: bigint
  numArgs: bigint
  arg0: Uint8Array
  arg1: Uint8Array
  arg2: Uint8Array
  arg3: Uint8Array
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

export type SafeTxn = {
  txType: bigint
  receiver: string
  amount: bigint
  hasClose: bigint
  closeRemainderTo: string
  xferAsset: bigint
  assetReceiver: string
  assetAmount: bigint
  hasAssetClose: bigint
  assetCloseTo: string
  appId: bigint
  numArgs: bigint
  arg0: Uint8Array
  arg1: Uint8Array
  arg2: Uint8Array
  arg3: Uint8Array
  online: bigint
  voteKey: Uint8Array
  selectionKey: Uint8Array
  stateProofKey: Uint8Array
  voteFirst: bigint
  voteLast: bigint
  voteKeyDilution: bigint
  note: string
}

export type SafeTxnTuple = [
  bigint,
  string,
  bigint,
  bigint,
  string,
  bigint,
  string,
  bigint,
  bigint,
  string,
  bigint,
  bigint,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  bigint,
  Uint8Array,
  Uint8Array,
  Uint8Array,
  bigint,
  bigint,
  bigint,
  string,
]

export const ZERO_ADDR = algosdk.encodeAddress(new Uint8Array(32))

export function toSafeTxnTuple(tx: SafeTxn): SafeTxnTuple {
  return [
    BigInt(tx.txType),
    tx.receiver,
    BigInt(tx.amount),
    BigInt(tx.hasClose),
    tx.closeRemainderTo,
    BigInt(tx.xferAsset),
    tx.assetReceiver,
    BigInt(tx.assetAmount),
    BigInt(tx.hasAssetClose),
    tx.assetCloseTo,
    BigInt(tx.appId),
    BigInt(tx.numArgs),
    tx.arg0,
    tx.arg1,
    tx.arg2,
    tx.arg3,
    BigInt(tx.online),
    tx.voteKey,
    tx.selectionKey,
    tx.stateProofKey,
    BigInt(tx.voteFirst),
    BigInt(tx.voteLast),
    BigInt(tx.voteKeyDilution),
    tx.note,
  ]
}

export function toSafeTxnGroup(txns: SafeTxn[]): SafeTxnTuple[] {
  return txns.map(toSafeTxnTuple)
}

export function createEmptySafeTxn(): SafeTxn {
  return {
    txType: TX_PAYMENT,
    receiver: ZERO_ADDR,
    amount: 0n,
    hasClose: 0n,
    closeRemainderTo: ZERO_ADDR,
    xferAsset: 0n,
    assetReceiver: ZERO_ADDR,
    assetAmount: 0n,
    hasAssetClose: 0n,
    assetCloseTo: ZERO_ADDR,
    appId: 0n,
    numArgs: 0n,
    arg0: EMPTY_BYTES,
    arg1: EMPTY_BYTES,
    arg2: EMPTY_BYTES,
    arg3: EMPTY_BYTES,
    online: 0n,
    voteKey: EMPTY_BYTES,
    selectionKey: EMPTY_BYTES,
    stateProofKey: EMPTY_BYTES,
    voteFirst: 0n,
    voteLast: 0n,
    voteKeyDilution: 0n,
    note: '',
  }
}

export function createPaymentSafeTxn(payload: PaymentPayload): SafeTxn {
  return {
    ...createEmptySafeTxn(),
    txType: TX_PAYMENT,
    receiver: payload.receiver,
    amount: payload.amount,
    hasClose: payload.hasClose,
    closeRemainderTo: payload.closeRemainderTo,
    note: payload.note,
  }
}

export function createAssetSafeTxn(payload: AssetPayload): SafeTxn {
  return {
    ...createEmptySafeTxn(),
    txType: TX_ASSET,
    xferAsset: payload.xferAsset,
    assetReceiver: payload.assetReceiver,
    assetAmount: payload.assetAmount,
    hasAssetClose: payload.hasClose,
    assetCloseTo: payload.assetCloseTo,
    note: payload.note,
  }
}

export function createAppCallSafeTxn(payload: AppCallPayload): SafeTxn {
  return {
    ...createEmptySafeTxn(),
    txType: TX_APP,
    appId: payload.appId,
    numArgs: payload.numArgs,
    arg0: payload.arg0,
    arg1: payload.arg1,
    arg2: payload.arg2,
    arg3: payload.arg3,
  }
}

export function createKeyRegSafeTxn(payload: KeyRegPayload): SafeTxn {
  return {
    ...createEmptySafeTxn(),
    txType: TX_KEYREG,
    online: payload.online,
    voteKey: payload.voteKey,
    selectionKey: payload.selectionKey,
    stateProofKey: payload.stateProofKey,
    voteFirst: payload.voteFirst,
    voteLast: payload.voteLast,
    voteKeyDilution: payload.voteKeyDilution,
  }
}


export function createPaymentPayload(receiver: string, amount: bigint, note = ''): PaymentPayload {
  return { receiver, amount, hasClose: 0n, closeRemainderTo: ZERO_ADDR, note }
}

export function createAppCallPayload(appId: bigint, args: Uint8Array[] = []): AppCallPayload {
  return {
    appId,
    numArgs: BigInt(args.length),
    arg0: args[0] ?? EMPTY_BYTES,
    arg1: args[1] ?? EMPTY_BYTES,
    arg2: args[2] ?? EMPTY_BYTES,
    arg3: args[3] ?? EMPTY_BYTES,
  }
}
