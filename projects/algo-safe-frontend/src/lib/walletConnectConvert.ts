// Converts an incoming WalletConnect `algo_signTxn` request into an algo-safe
// transaction-group payload, or produces a human-readable reason it can't be
// represented as a Safe proposal at all (see docs/WALLETCONNECT_WALLET_SETUP.md).
import { algosdkTxnsToSafeTxnGroup, buildAlgoSafeAppClient, readRekeyedAddress, type SafeTxnTuple } from 'algo-safe'
import algosdk from 'algosdk'
import i18n from '../i18n/instance'
import type { Safe } from '../services/types'

export type WalletConnectTxnEntry = {
  txn: string
  message?: string
  signers?: string[]
  authAddr?: string
}

export type ConvertResult =
  { ok: true; payload: SafeTxnTuple[]; txns: algosdk.Transaction[] } | { ok: false; reason: string; reasonEn: string }

function isWalletConnectTxnEntry(value: unknown): value is WalletConnectTxnEntry {
  return typeof value === 'object' && value !== null && typeof (value as { txn?: unknown }).txn === 'string'
}

/**
 * Some wallets nest a single atomic group as `params[0]` (array of entries);
 * others send the flat array of entries directly as `params`. Normalize both.
 */
export function normalizeSessionRequestParams(params: unknown): WalletConnectTxnEntry[] {
  const candidate = Array.isArray(params) && Array.isArray(params[0]) ? params[0] : params
  if (!Array.isArray(candidate) || !candidate.every(isWalletConnectTxnEntry)) {
    throw new Error(i18n.t('walletconnect:convert.unrecognizedShape'))
  }
  return candidate
}

async function isSpendableBySafe(algodClient: algosdk.Algodv2, safe: Safe, sender: string): Promise<boolean> {
  if (sender === safe.address) return true
  const client = await buildAlgoSafeAppClient(algodClient, safe)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rekeyed = await readRekeyedAddress(client as any, sender).catch(() => undefined)
  return rekeyed !== undefined
}

/**
 * Attempts to convert a decoded WalletConnect request into a Safe transaction
 * group payload. Returns a discriminated failure with a human-readable reason
 * instead of throwing, so callers can show it directly in the UI.
 */
/** Localized reason for the operator UI plus an English one for the remote dapp (protocol boundary). */
const fail = (key: string, opts?: Record<string, unknown>): ConvertResult => ({
  ok: false,
  reason: i18n.t(key, opts),
  reasonEn: i18n.t(key, { ...opts, lng: 'en' }),
})

export async function convertSessionRequestToSafePayload(
  algodClient: algosdk.Algodv2,
  safe: Safe,
  entries: WalletConnectTxnEntry[],
): Promise<ConvertResult> {
  if (entries.length === 0) {
    return fail('walletconnect:convert.noTransactions')
  }

  const unsignedByOthers = entries.some((entry) => Array.isArray(entry.signers) && entry.signers.length === 0)
  if (unsignedByOthers) {
    return fail('walletconnect:convert.unsignedByOthers')
  }

  let txns: algosdk.Transaction[]
  try {
    txns = entries.map((entry) => algosdk.decodeUnsignedTransaction(Buffer.from(entry.txn, 'base64')))
  } catch {
    return fail('walletconnect:convert.decodeFailed')
  }

  for (const txn of txns) {
    const sender = txn.sender.toString()

    const spendable = await isSpendableBySafe(algodClient, safe, sender)
    if (!spendable) {
      return fail('walletconnect:convert.notSpendable', { sender })
    }
  }

  try {
    const payload = algosdkTxnsToSafeTxnGroup(txns)
    return { ok: true, payload, txns }
  } catch (error) {
    return error instanceof Error
      ? fail('walletconnect:convert.cannotRepresent', { message: error.message })
      : fail('walletconnect:convert.cannotRepresentGeneric')
  }
}
