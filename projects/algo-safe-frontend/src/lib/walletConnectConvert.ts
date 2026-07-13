// Converts an incoming WalletConnect `algo_signTxn` request into an algo-safe
// transaction-group payload, or produces a human-readable reason it can't be
// represented as a Safe proposal at all (see docs/WALLETCONNECT_WALLET_SETUP.md).
import { algosdkTxnsToSafeTxnGroup, buildAlgoSafeAppClient, readRekeyedAddress, type SafeTxnTuple } from 'algo-safe'
import algosdk from 'algosdk'
import type { Safe } from '../services/types'

export type WalletConnectTxnEntry = {
  txn: string
  message?: string
  signers?: string[]
  authAddr?: string
}

export type ConvertResult = { ok: true; payload: SafeTxnTuple[]; txns: algosdk.Transaction[] } | { ok: false; reason: string }

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
    throw new Error('Unrecognized algo_signTxn request shape — expected an array of {txn, signers?} entries.')
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
export async function convertSessionRequestToSafePayload(
  algodClient: algosdk.Algodv2,
  safe: Safe,
  entries: WalletConnectTxnEntry[],
): Promise<ConvertResult> {
  if (entries.length === 0) {
    return { ok: false, reason: 'The request did not contain any transactions.' }
  }

  const unsignedByOthers = entries.some((entry) => Array.isArray(entry.signers) && entry.signers.length === 0)
  if (unsignedByOthers) {
    return {
      ok: false,
      reason:
        'This request bundles a transaction that must be authorized by another party (its "signers" list is empty) — for example a ' +
        'LogicSig-controlled account or a different multisig member. The Safe can only co-sign transactions sent from its own address ' +
        'or from addresses rekeyed to it, so this batch cannot be turned into a Safe proposal. Reject it and ask the dapp to route that ' +
        'part of the request through the original signer directly.',
    }
  }

  let txns: algosdk.Transaction[]
  try {
    txns = entries.map((entry) => algosdk.decodeUnsignedTransaction(Buffer.from(entry.txn, 'base64')))
  } catch {
    return {
      ok: false,
      reason:
        'One of the transactions in this request could not be decoded — it may already be signed (e.g. a LogicSig blob) rather than a plain unsigned transaction.',
    }
  }

  for (const txn of txns) {
    const sender = txn.sender.toString()

    const spendable = await isSpendableBySafe(algodClient, safe, sender)
    if (!spendable) {
      return {
        ok: false,
        reason: `Transaction sender ${sender} is neither the Safe's own address nor an address currently rekeyed to it. The Safe has no authority to move funds from this account, so this request can't become a Safe proposal.`,
      }
    }
  }

  try {
    const payload = algosdkTxnsToSafeTxnGroup(txns)
    return { ok: true, payload, txns }
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error
          ? `The Safe can't represent this transaction: ${error.message}`
          : 'The Safe cannot represent one of the transactions in this request.',
    }
  }
}
