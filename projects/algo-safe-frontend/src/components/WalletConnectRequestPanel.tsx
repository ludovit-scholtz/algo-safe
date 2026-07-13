import type algosdk from 'algosdk'
import { useEffect, useMemo, useState } from 'react'
import { ALGORAND_WC_METHOD } from '../services/walletKitService'
import type { PendingWalletConnectRequest } from '../hooks/useWalletKit'
import { convertSessionRequestToSafePayload, normalizeSessionRequestParams, type ConvertResult } from '../lib/walletConnectConvert'
import { prepareTransactionGroupSignature, proposeLiveTransactionGroup } from '../services/algoSafeProposals'
import type { Safe } from '../services/types'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { FormField, inputCls } from './ui/FormField'
import { Icon } from './ui/Icon'
import { TransactionPreview } from './TransactionPreview'

function toLocalPreview(txn: algosdk.Transaction) {
  const sender = txn.sender.toString()
  switch (txn.type) {
    case 'pay':
      return {
        type: 'pay' as const,
        summary: `Send ${Number(txn.payment?.amount ?? 0n) / 1_000_000} ALGO to ${txn.payment?.receiver?.toString() ?? '—'}`,
        detail: `From ${sender}`,
      }
    case 'axfer':
      return {
        type: 'axfer' as const,
        summary: `Transfer ${txn.assetTransfer?.amount ?? 0n} of ASA ${txn.assetTransfer?.assetIndex ?? '—'} to ${txn.assetTransfer?.receiver?.toString() ?? '—'}`,
        detail: `From ${sender}`,
      }
    case 'appl':
      return { type: 'appl' as const, summary: `Call app ${txn.applicationCall?.appIndex ?? '—'}`, detail: `From ${sender}` }
    case 'keyreg':
      return { type: 'keyreg' as const, summary: 'Participation key registration', detail: `From ${sender}` }
    case 'acfg':
      return { type: 'acfg' as const, summary: `Configure asset ${txn.assetConfig?.assetIndex ?? 'new asset'}`, detail: `From ${sender}` }
    default:
      return { type: 'appl' as const, summary: `Transaction type ${txn.type}`, detail: `From ${sender}` }
  }
}

type Props = {
  request: PendingWalletConnectRequest
  safe: Safe
  algodClient: algosdk.Algodv2
  activeAddress?: string | null
  transactionSigner?: algosdk.TransactionSigner
  onReject: (topic: string, id: number, message: string) => Promise<void>
  onRespond: (topic: string, id: number, result: unknown) => Promise<void>
}

export function WalletConnectRequestPanel({ request, safe, algodClient, activeAddress, transactionSigner, onReject, onRespond }: Props) {
  const [result, setResult] = useState<ConvertResult | 'loading' | { ok: false; reason: string }>('loading')
  const [groupId, setGroupId] = useState('1')
  const [expiryRounds, setExpiryRounds] = useState('2000')
  const [busy, setBusy] = useState<'submit' | 'sign-return' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)

  const isSupportedMethod = request.method === ALGORAND_WC_METHOD

  useEffect(() => {
    let cancelled = false
    setResult('loading')

    if (!isSupportedMethod) {
      setResult({ ok: false, reason: `This wallet only handles ${ALGORAND_WC_METHOD} requests — received "${request.method}".` })
      return
    }

    try {
      const entries = normalizeSessionRequestParams(request.params)
      void convertSessionRequestToSafePayload(algodClient, safe, entries).then((converted) => {
        if (!cancelled) setResult(converted)
      })
    } catch (normalizeError) {
      setResult({ ok: false, reason: normalizeError instanceof Error ? normalizeError.message : 'Unrecognized request shape.' })
    }

    return () => {
      cancelled = true
    }
  }, [request, safe, algodClient, isSupportedMethod])

  const preview = useMemo(() => {
    if (result === 'loading' || !result.ok) return []
    return result.txns.map(toLocalPreview)
  }, [result])

  async function handleReject() {
    setBusy('reject')
    setError(null)
    try {
      const reason = result !== 'loading' && !result.ok ? result.reason : 'Rejected by the Safe operator.'
      await onReject(request.topic, request.id, reason)
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : 'Failed to reject the request.')
    } finally {
      setBusy(null)
    }
  }

  async function handleSubmitToChain() {
    if (result === 'loading' || !result.ok || !activeAddress || !transactionSigner) return
    setBusy('submit')
    setError(null)
    try {
      const { proposalId, txId } = await proposeLiveTransactionGroup(
        { algodClient, safe, activeAddress, transactionSigner },
        { groupId: BigInt(groupId), payload: result.payload, expiryRounds: BigInt(expiryRounds) },
      )
      setOutcome(
        `Proposal #${proposalId} created on-chain (tx ${txId}). Approve it from the Proposals page once the group reaches threshold.`,
      )
      await onReject(request.topic, request.id, `Converted into Safe proposal #${proposalId} — track and approve it from the Safe console.`)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to submit the proposal.')
    } finally {
      setBusy(null)
    }
  }

  async function handleSignAndReturn() {
    if (result === 'loading' || !result.ok || !activeAddress || !transactionSigner) return
    setBusy('sign-return')
    setError(null)
    try {
      const { signedTxns, txId } = await prepareTransactionGroupSignature(
        { algodClient, safe, activeAddress, transactionSigner },
        { groupId: BigInt(groupId), payload: result.payload, expiryRounds: BigInt(expiryRounds) },
      )
      const encoded = signedTxns.map((bytes) => Buffer.from(bytes).toString('base64'))
      await onRespond(request.topic, request.id, encoded)
      setOutcome(
        `Signed the proposal call (tx ${txId}) and returned it to the paired dapp — note this is the Safe proposal transaction, not the original requested transaction(s).`,
      )
    } catch (signError) {
      setError(signError instanceof Error ? signError.message : 'Failed to sign the proposal.')
    } finally {
      setBusy(null)
    }
  }

  if (outcome) {
    return (
      <Card>
        <p className="text-sm text-on-surface">{outcome}</p>
      </Card>
    )
  }

  if (result === 'loading') {
    return (
      <Card>
        <p className="flex items-center gap-2 text-sm text-on-surface-variant">
          <Icon name="sync" className="animate-spin text-base" /> Evaluating request…
        </p>
      </Card>
    )
  }

  if (!result.ok) {
    return (
      <Card className="border-error/40 bg-error-container/20">
        <div className="flex items-start gap-3">
          <Icon name="error" className="text-error" />
          <div className="space-y-3">
            <h3 className="font-semibold text-on-error-container">This request can&apos;t become a Safe proposal</h3>
            <p className="text-sm text-on-error-container">{result.reason}</p>
            {error && <p className="text-xs text-error">{error}</p>}
            <Button variant="danger" disabled={busy !== null} onClick={() => void handleReject()}>
              {busy === 'reject' ? <Icon name="sync" className="animate-spin text-base" /> : <Icon name="block" className="text-base" />}
              Reject Request
            </Button>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <div className="space-y-4">
        <h3 className="font-semibold text-on-surface">Incoming transaction request</h3>
        <TransactionPreview lines={preview} />

        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Signer Group ID" hint="The group that will hold this proposal.">
            <input
              className={inputCls}
              inputMode="numeric"
              pattern="[0-9]*"
              value={groupId}
              onChange={(event) => setGroupId(event.target.value.replace(/[^0-9]/g, ''))}
            />
          </FormField>
          <FormField label="Expiry (Rounds)" hint="Added to the current round to compute the proposal expiry round.">
            <input
              className={inputCls}
              inputMode="numeric"
              pattern="[0-9]*"
              value={expiryRounds}
              onChange={(event) => setExpiryRounds(event.target.value.replace(/[^0-9]/g, ''))}
            />
          </FormField>
        </div>

        {error && <p className="text-sm text-error">{error}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={busy !== null || !activeAddress} onClick={() => void handleSubmitToChain()}>
            {busy === 'submit' ? <Icon name="sync" className="animate-spin text-base" /> : <Icon name="save" className="text-base" />}
            Submit Proposal to Chain
          </Button>
          <Button variant="secondary" disabled={busy !== null || !activeAddress} onClick={() => void handleSignAndReturn()}>
            {busy === 'sign-return' ? <Icon name="sync" className="animate-spin text-base" /> : <Icon name="reply" className="text-base" />}
            Sign &amp; Return via WalletConnect
          </Button>
          <Button variant="ghost" disabled={busy !== null} onClick={() => void handleReject()}>
            Reject
          </Button>
        </div>
        <p className="text-xs text-on-surface-variant">
          &quot;Sign &amp; Return&quot; sends back the signed <em>proposal</em> transaction, not the dapp&apos;s original transaction(s) —
          only use it with dapps that accept that. Prefer submitting to chain and letting the dapp poll the Safe&apos;s proposal status.
        </p>
      </div>
    </Card>
  )
}
