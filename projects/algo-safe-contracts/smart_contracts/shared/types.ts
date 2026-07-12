import { Account, bytes, uint64, Uint64 } from '@algorandfoundation/algorand-typescript'

/**
 * Shared payload types and constants for the AlgoSafe contract family.
 *
 * Imported by BOTH `algo_safe/contract.algo.ts` (stores payloads, stages inner
 * transactions) and `algo_safe_validator/contract.algo.ts` (validates payloads
 * via C2C call). Keeping one definition guarantees the validator decodes the
 * exact byte layout the safe stores — never fork these declarations.
 */

// TX_* — type tag stored as SafeTxn.txType (first field of each envelope entry).
export const TX_PAYMENT: uint64 = Uint64(1)
export const TX_ASSET: uint64 = Uint64(2)
export const TX_APP: uint64 = Uint64(3)
export const TX_KEYREG: uint64 = Uint64(4)
export const TX_ACFG: uint64 = Uint64(5)
// TX_REKEY uses a 0-amount self-payment inner transaction.
export const TX_REKEY: uint64 = Uint64(6)

// ACT_* — allowedActions bitmask on SignerGroup.
export const ACT_PAY: uint64 = Uint64(1)
export const ACT_AXFER: uint64 = Uint64(2)
export const ACT_APPL: uint64 = Uint64(4)
export const ACT_KEYREG: uint64 = Uint64(8)
export const ACT_ACFG: uint64 = Uint64(16)
// ACT_REKEY requires both this bit and PRIV_GROUP.
export const ACT_REKEY: uint64 = Uint64(32)
export const ACT_ALL: uint64 = Uint64(63)

// PRIV_* — adminPrivileges bitmask on SignerGroup (safe-wide, not self-scoped).
export const PRIV_GROUP: uint64 = Uint64(1)
export const PRIV_POLICY: uint64 = Uint64(2)
export const PRIV_ALL: uint64 = Uint64(7)

// GT_* — groupType discriminator stored in SignerGroup.groupType.
export const GT_STANDARD: uint64 = Uint64(0)
export const GT_CUSTODIAN: uint64 = Uint64(1)

// SafeTxn payload structs — the `data` half of the (txType, data) envelope.

export type PaymentTxn = {
  sender: Account // zero address = use the safe's own app account
  receiver: Account
  amount: uint64
  hasClose: uint64 // nonzero → also set CloseRemainderTo
  closeRemainderTo: Account
  note: string
}

export type AssetTxn = {
  sender: Account // zero address = safe's own app account
  xferAsset: uint64
  assetReceiver: Account
  assetAmount: uint64
  hasAssetClose: uint64
  assetCloseTo: Account
  note: string
}

export type AppTxn = {
  appId: uint64
  onCompletion: uint64
  appArgs: bytes[]
  accounts: Account[]
  foreignApps: uint64[]
  foreignAssets: uint64[]
  note: string
}

export type KeyRegTxn = {
  online: uint64 // 0 = go offline; nonzero = register participation keys
  voteKey: bytes
  selectionKey: bytes
  stateProofKey: bytes
  voteFirst: uint64
  voteLast: uint64
  voteKeyDilution: uint64
}

export type AssetConfigTxn = {
  configAsset: uint64 // 0 = create new asset; >0 = reconfigure / destroy
  total: uint64
  decimals: uint64
  defaultFrozen: uint64
  unitName: string
  assetName: string
  url: string
  metadataHash: bytes // must be exactly 0 or 32 bytes
  manager: Account
  reserve: Account
  freeze: Account
  clawback: Account
  note: string
}

export type RekeyTxn = {
  sender: Account // zero address = rekey the safe itself; otherwise a registered rekeyed address
  rekeyTo: Account
  note: string
}
