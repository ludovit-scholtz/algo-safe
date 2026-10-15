import { MAX_PROPOSAL_LIFETIME_ROUNDS } from 'algo-safe'
import type algosdk from 'algosdk'
import { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import i18n from '../i18n/instance'
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
  const fromSender = i18n.t('walletconnect:preview.fromSender', { sender })
  switch (txn.type) {
    case 'pay':
      return {
        type: 'pay' as const,
        summary: i18n.t('walletconnect:preview.sendAlgo', {
          amount: String(Number(txn.payment?.amount ?? 0n) / 1_000_000),
          receiver: txn.payment?.receiver?.toString() ?? '—',
        }),
        detail: fromSender,
      }
    case 'axfer':
      return {
        type: 'axfer' as const,
        summary: i18n.t('walletconnect:preview.transferAsa', {
          amount: String(txn.assetTransfer?.amount ?? 0n),
          asset: String(txn.assetTransfer?.assetIndex ?? '—'),
          receiver: txn.assetTransfer?.receiver?.toString() ?? '—',
        }),
        detail: fromSender,
      }
    case 'appl':
      return {
        type: 'appl' as const,
        summary: i18n.t('walletconnect:preview.callApp', { app: String(txn.applicationCall?.appIndex ?? '—') }),
        detail: fromSender,
        appCall: txn.applicationCall
          ? {
              appId: txn.applicationCall.appIndex ?? 0n,
              sender,
              appArgs: [...txn.applicationCall.appArgs],
              accounts: txn.applicationCall.accounts.map((account) => account.toString()),
              foreignApps: [...txn.applicationCall.foreignApps],
              foreignAssets: [...txn.applicationCall.foreignAssets],
            }
          : undefined,
      }
    case 'keyreg':
      return { type: 'keyreg' as const, summary: i18n.t('walletconnect:preview.keyreg'), detail: fromSender }
    case 'acfg':
      return {
        type: 'acfg' as const,
        summary: i18n.t('walletconnect:preview.configureAsset', {
          asset: txn.assetConfig?.assetIndex ? String(txn.assetConfig.assetIndex) : i18n.t('walletconnect:preview.newAsset'),
        }),
        detail: fromSender,
      }
    default:
      return { type: 'appl' as const, summary: i18n.t('walletconnect:preview.txType', { type: String(txn.type) }), detail: fromSender }
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
  const { t } = useTranslation('walletconnect')
  const [result, setResult] = useState<ConvertResult | 'loading' | { ok: false; reason: string; reasonEn: string }>('loading')
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
      const unsupported = { expected: ALGORAND_WC_METHOD, received: request.method }
      setResult({
        ok: false,
        reason: i18n.t('walletconnect:panel.unsupportedMethod', unsupported),
        reasonEn: i18n.t('walletconnect:panel.unsupportedMethod', { ...unsupported, lng: 'en' }),
      })
      return
    }

    try {
      const entries = normalizeSessionRequestParams(request.params)
      void convertSessionRequestToSafePayload(algodClient, safe, entries).then((converted) => {
        if (!cancelled) setResult(converted)
      })
    } catch (normalizeError) {
      const reason = normalizeError instanceof Error ? normalizeError.message : i18n.t('walletconnect:panel.unrecognizedShape')
      setResult({
        ok: false,
        reason,
        reasonEn: i18n.t('walletconnect:convert.unrecognizedShape', { lng: 'en' }),
      })
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
      const reason = result !== 'loading' && !result.ok ? result.reasonEn : t('panel.rejectedByOperator', { lng: 'en' })
      await onReject(request.topic, request.id, reason)
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : t('panel.rejectFailed'))
    } finally {
      setBusy(null)
    }
  }

  /** Validated expiry rounds, or null (after surfacing a localized error) when out of range. */
  function parseExpiryRounds(): bigint | null {
    const trimmed = expiryRounds.trim()
    const rounds = /^\d+$/.test(trimmed) ? BigInt(trimmed) : 0n
    if (rounds <= 0n || rounds > MAX_PROPOSAL_LIFETIME_ROUNDS) {
      setError(t('panel.expiryInvalid', { max: MAX_PROPOSAL_LIFETIME_ROUNDS.toString() }))
      return null
    }
    return rounds
  }

  async function handleSubmitToChain() {
    if (result === 'loading' || !result.ok || !activeAddress || !transactionSigner) return
    const rounds = parseExpiryRounds()
    if (rounds === null) return
    setBusy('submit')
    setError(null)
    try {
      const { proposalId, txId } = await proposeLiveTransactionGroup(
        { algodClient, safe, activeAddress, transactionSigner },
        { groupId: BigInt(groupId), payload: result.payload, expiryRounds: rounds },
      )
      setOutcome(t('panel.proposalCreated', { proposalId, txId }))
      await onReject(request.topic, request.id, t('panel.convertedReject', { proposalId, lng: 'en' }))
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t('panel.submitFailed'))
    } finally {
      setBusy(null)
    }
  }

  async function handleSignAndReturn() {
    if (result === 'loading' || !result.ok || !activeAddress || !transactionSigner) return
    const rounds = parseExpiryRounds()
    if (rounds === null) return
    setBusy('sign-return')
    setError(null)
    try {
      const { signedTxns, txId } = await prepareTransactionGroupSignature(
        { algodClient, safe, activeAddress, transactionSigner },
        { groupId: BigInt(groupId), payload: result.payload, expiryRounds: rounds },
      )
      const encoded = signedTxns.map((bytes) => Buffer.from(bytes).toString('base64'))
      await onRespond(request.topic, request.id, encoded)
      setOutcome(t('panel.signedReturned', { txId }))
    } catch (signError) {
      setError(signError instanceof Error ? signError.message : t('panel.signFailed'))
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
          <Icon name="sync" className="animate-spin text-base" /> {t('panel.evaluating')}
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
            <h3 className="font-semibold text-on-error-container">{t('panel.cantBecome')}</h3>
            <p className="text-sm text-on-error-container">{result.reason}</p>
            {error && <p className="text-xs text-error">{error}</p>}
            <Button variant="danger" disabled={busy !== null} onClick={() => void handleReject()}>
              {busy === 'reject' ? <Icon name="sync" className="animate-spin text-base" /> : <Icon name="block" className="text-base" />}
              {t('panel.rejectRequest')}
            </Button>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <div className="space-y-4">
        <h3 className="font-semibold text-on-surface">{t('panel.incoming')}</h3>
        <TransactionPreview lines={preview} algodClient={algodClient} network={safe.network} />

        <div className="grid gap-4 md:grid-cols-2">
          <FormField label={t('panel.groupIdLabel')} hint={t('panel.groupIdHint')}>
            <input
              className={inputCls}
              inputMode="numeric"
              pattern="[0-9]*"
              value={groupId}
              onChange={(event) => setGroupId(event.target.value.replace(/[^0-9]/g, ''))}
            />
          </FormField>
          <FormField label={t('panel.expiryLabel')} hint={t('panel.expiryHint')}>
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
            {t('panel.submitToChain')}
          </Button>
          <Button variant="secondary" disabled={busy !== null || !activeAddress} onClick={() => void handleSignAndReturn()}>
            {busy === 'sign-return' ? <Icon name="sync" className="animate-spin text-base" /> : <Icon name="reply" className="text-base" />}
            {t('panel.signReturn')}
          </Button>
          <Button variant="ghost" disabled={busy !== null} onClick={() => void handleReject()}>
            {t('panel.reject')}
          </Button>
        </div>
        <p className="text-xs text-on-surface-variant">
          <Trans t={t} i18nKey="panel.signReturnNote" components={{ em: <em /> }} />
        </p>
      </div>
    </Card>
  )
}
