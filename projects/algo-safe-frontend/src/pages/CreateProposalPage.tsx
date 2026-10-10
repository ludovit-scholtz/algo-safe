import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@txnlab/use-wallet-react'
import { ACT_AXFER, ACT_PAY, ACT_REKEY, createAssetSafeTxn, createPaymentSafeTxn, createRekeySafeTxn, toSafeTxnGroup } from 'algo-safe'
import algosdk from 'algosdk'
import { useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { AddressDisplay } from '../components/AddressDisplay'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { FormField, inputCls } from '../components/ui/FormField'
import { Icon } from '../components/ui/Icon'
import { useSafe } from '../hooks'
import { useOnChainSafeHoldings } from '../hooks/useOnChainSafeHoldings'
import { getKnownAssets } from '../lib/assetMetadata'
import { formatUnits, getZeroAddress } from '../lib/onChainSafe'
import { useSafeId } from '../lib/SafeContext'
import { fetchSelfExecuteCapability, proposeLiveTransactionGroup } from '../services/algoSafeProposals'
import type { NetworkId } from '../services/types'

type ProposalKind = 'payment' | 'asset-transfer' | 'opt-in' | 'rekey'

type CreatedProposal = {
  proposalId: string
  txId: string
}

function parseBaseUnits(value: string, decimals: number) {
  const trimmed = value.trim()
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) return null

  const [wholePart, fractionPart = ''] = trimmed.split('.')
  if (fractionPart.length > decimals) return null

  const normalized = `${wholePart}${fractionPart.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '')
  return BigInt(normalized || '0')
}

export function CreateProposalPage() {
  const { t } = useTranslation('proposals')
  const safeId = useSafeId()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: safe } = useSafe(safeId)
  const { data: holdings } = useOnChainSafeHoldings(safeId)
  const { activeAddress, algodClient, transactionSigner, isReady } = useWallet()
  const [proposalKind, setProposalKind] = useState<ProposalKind>('payment')
  const [groupId, setGroupId] = useState('1')
  const [expiryRounds, setExpiryRounds] = useState('2000')
  const [receiver, setReceiver] = useState('')
  const [amount, setAmount] = useState('')
  const [assetId, setAssetId] = useState('')
  const [note, setNote] = useState('')
  const [submitMode, setSubmitMode] = useState<'prepare' | 'execute' | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [createdProposal, setCreatedProposal] = useState<CreatedProposal | null>(null)
  const isSubmitting = submitMode !== null

  const requiredAction = proposalKind === 'payment' ? ACT_PAY : proposalKind === 'rekey' ? ACT_REKEY : ACT_AXFER
  const parsedGroupIdInput = /^\d+$/.test(groupId) && BigInt(groupId) > 0n ? BigInt(groupId) : null
  const { data: selfExecuteCapability } = useQuery({
    queryKey: ['self-execute-capability', safeId, groupId, activeAddress, proposalKind],
    queryFn: () => fetchSelfExecuteCapability({ algodClient, safe: safe!, activeAddress }, parsedGroupIdInput!, requiredAction),
    enabled: Boolean(safe && activeAddress && parsedGroupIdInput !== null),
    staleTime: 30_000,
  })
  const canSelfExecute = selfExecuteCapability?.canSelfExecute ?? false

  const assetOptions = useMemo(() => (holdings ?? []).filter((holding) => !holding.isNative), [holdings])
  const selectedAsset = assetOptions.find((holding) => String(holding.assetId) === assetId)
  const knownAssets = useMemo(
    () => getKnownAssets(safe?.network as NetworkId | undefined).map((asset) => ({ id: asset.assetId.toString(), label: asset.symbol })),
    [safe?.network],
  )
  const selectedKnownAsset = knownAssets.find((asset) => asset.id === assetId)
  const effectiveReceiver = proposalKind === 'opt-in' ? (safe?.address ?? '') : receiver
  const showsAssetIdInput = proposalKind === 'asset-transfer' || proposalKind === 'opt-in'

  async function submitProposal(executeNow: boolean) {
    setErrorMessage(null)
    setCreatedProposal(null)

    if (!safe) {
      setErrorMessage(t('create.errors.safeNotLoaded'))
      return
    }

    if (!isReady || !activeAddress || !transactionSigner) {
      setErrorMessage(t('create.errors.connectWallet'))
      return
    }

    if (!algosdk.isValidAddress(effectiveReceiver.trim())) {
      setErrorMessage(t('create.errors.invalidReceiver'))
      return
    }

    const parsedGroupId = BigInt(groupId)
    const parsedExpiryRounds = Number(expiryRounds)
    if (parsedGroupId <= 0n || !Number.isInteger(parsedExpiryRounds) || parsedExpiryRounds <= 0) {
      setErrorMessage(t('create.errors.nonPositive'))
      return
    }

    try {
      setSubmitMode(executeNow ? 'execute' : 'prepare')

      // Versioned-client union types `payload` as the intersection of every
      // contract version's shape; our builders emit the latest envelope, so
      // cast to the param type. See algoSafeProposals for the read-side branch.
      let payload: never[]
      if (proposalKind === 'rekey') {
        payload = toSafeTxnGroup([
          createRekeySafeTxn({
            sender: getZeroAddress(),
            rekeyTo: receiver.trim(),
            note: note.trim(),
          }),
        ]) as unknown as never[]
      } else if (proposalKind === 'payment') {
        const rawAmount = parseBaseUnits(amount, 6)
        if (rawAmount === null || rawAmount < 0n) {
          throw new Error(t('create.errors.invalidAlgoAmount'))
        }

        payload = toSafeTxnGroup([
          createPaymentSafeTxn({
            sender: getZeroAddress(),
            receiver: receiver.trim(),
            amount: rawAmount,
            hasClose: 0n,
            closeRemainderTo: getZeroAddress(),
            note: note.trim(),
          }),
        ]) as unknown as never[]
      } else {
        const resolvedAssetId = assetId.trim()
        if (!resolvedAssetId || !/^\d+$/.test(resolvedAssetId)) {
          throw new Error(proposalKind === 'opt-in' ? t('create.errors.optInAssetId') : t('create.errors.selectOptedInAsset'))
        }

        const resolvedAssetDecimals = proposalKind === 'opt-in' ? 0 : (selectedAsset?.decimals ?? 0)
        const rawAmount = proposalKind === 'opt-in' ? 0n : parseBaseUnits(amount, resolvedAssetDecimals)
        if (rawAmount === null || rawAmount < 0n) {
          throw new Error(proposalKind === 'opt-in' ? t('create.errors.optInZeroAmount') : t('create.errors.invalidAssetAmount'))
        }

        payload = toSafeTxnGroup([
          createAssetSafeTxn({
            sender: getZeroAddress(),
            xferAsset: BigInt(resolvedAssetId),
            assetReceiver: effectiveReceiver.trim(),
            assetAmount: rawAmount,
            hasClose: 0n,
            assetCloseTo: getZeroAddress(),
            note: note.trim(),
          }),
        ]) as unknown as never[]
      }

      const { proposalId, txId } = await proposeLiveTransactionGroup(
        { algodClient, safe, activeAddress, transactionSigner },
        { groupId: parsedGroupId, payload, expiryRounds: BigInt(parsedExpiryRounds), executeNow },
      )

      setCreatedProposal({ proposalId, txId })
      await queryClient.invalidateQueries({ queryKey: ['proposals', safeId] })
      await queryClient.invalidateQueries({ queryKey: ['proposal', safeId, proposalId] })
      navigate(`/safe/${safeId}/proposals/${proposalId}`, { state: { txId } })
    } catch (error) {
      setErrorMessage(error instanceof Error && error.message.trim() ? error.message : t('create.errors.saveFailed'))
    } finally {
      setSubmitMode(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-on-surface">{t('create.title')}</h1>
          <p className="mt-1 text-sm text-on-surface-variant">{t('create.subtitle')}</p>
        </div>
        <Link to={`/safe/${safeId}/proposals`}>
          <Button variant="secondary">
            <Icon name="arrow_back" className="text-base" />
            {t('create.back')}
          </Button>
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <Card>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault()
              void submitProposal(false)
            }}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label={t('create.proposalType')} hint={t('create.proposalTypeHint')}>
                <select className={inputCls} value={proposalKind} onChange={(event) => setProposalKind(event.target.value as ProposalKind)}>
                  <option value="payment">{t('create.kinds.payment')}</option>
                  <option value="asset-transfer">{t('create.kinds.assetTransfer')}</option>
                  <option value="opt-in">{t('create.kinds.optIn')}</option>
                  <option value="rekey">{t('create.kinds.rekey')}</option>
                </select>
              </FormField>
              <FormField label={t('create.groupId')} hint={t('create.groupIdHint')}>
                <input
                  className={inputCls}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={groupId}
                  onChange={(event) => setGroupId(event.target.value.replace(/[^0-9]/g, ''))}
                />
              </FormField>
            </div>

            {proposalKind === 'rekey' && (
              <div className="rounded-sm border border-error/40 bg-error-container/30 px-3 py-2 text-sm text-on-error-container">
                <Trans t={t} i18nKey="create.rekeyWarning" components={{ strong: <strong /> }} />
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              {proposalKind === 'rekey' ? (
                <FormField label={t('create.rekeyTarget')} hint={t('create.rekeyTargetHint')}>
                  <input
                    className={inputCls}
                    value={receiver}
                    onChange={(event) => setReceiver(event.target.value)}
                    placeholder={t('create.rekeyTargetPlaceholder')}
                  />
                </FormField>
              ) : proposalKind !== 'opt-in' ? (
                <FormField label={t('create.receiver')} hint={t('create.receiverHint')}>
                  <input
                    className={inputCls}
                    value={receiver}
                    onChange={(event) => setReceiver(event.target.value)}
                    placeholder={t('create.receiverPlaceholder')}
                  />
                </FormField>
              ) : (
                <FormField label={t('create.receiver')} hint={t('create.receiverOptInHint')}>
                  <div className={`${inputCls} flex min-h-11 items-center justify-between gap-3 text-on-surface-variant`}>
                    <AddressDisplay address={safe?.address} textClassName="text-sm text-on-surface-variant" fallback="—" />
                  </div>
                </FormField>
              )}

              {proposalKind === 'rekey' ? (
                <FormField label={t('create.amount')} hint={t('create.rekeyAmountHint')}>
                  <input className={`${inputCls} text-on-surface-variant`} value="0" disabled readOnly />
                </FormField>
              ) : proposalKind !== 'opt-in' ? (
                <FormField
                  label={proposalKind === 'payment' ? t('create.amountAlgo') : t('create.amount')}
                  hint={
                    proposalKind === 'payment'
                      ? t('create.amountAlgoHint')
                      : selectedAsset
                        ? t('create.amountAssetHint', { symbol: selectedAsset.symbol, decimals: selectedAsset.decimals })
                        : t('create.amountSelectAssetFirst')
                  }
                >
                  <input
                    className={inputCls}
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder={t('create.amountPlaceholder')}
                  />
                </FormField>
              ) : (
                <FormField label={t('create.amount')} hint={t('create.optInAmountHint')}>
                  <input className={`${inputCls} text-on-surface-variant`} value="0" disabled readOnly />
                </FormField>
              )}
            </div>

            {showsAssetIdInput && (
              <div className="space-y-3">
                {proposalKind === 'asset-transfer' ? (
                  <FormField label={t('create.optedInAsset')} hint={t('create.optedInAssetHint')}>
                    <select className={inputCls} value={assetId} onChange={(event) => setAssetId(event.target.value)}>
                      <option value="">{t('create.selectAsset')}</option>
                      {assetOptions.map((holding) => (
                        <option key={holding.key} value={holding.assetId}>
                          {t('create.assetOption', { symbol: holding.symbol, assetId: holding.assetId, balance: holding.balanceDisplay })}
                        </option>
                      ))}
                    </select>
                  </FormField>
                ) : (
                  <>
                    <FormField
                      label={t('create.assetId')}
                      hint={knownAssets.length ? t('create.assetIdHintKnown') : t('create.assetIdHintManual')}
                    >
                      <input
                        list="known-asset-ids"
                        className={inputCls}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={assetId}
                        onChange={(event) => setAssetId(event.target.value.replace(/[^0-9]/g, ''))}
                        placeholder={t('create.assetIdPlaceholder')}
                      />
                    </FormField>
                    {knownAssets.length > 0 && (
                      <>
                        <datalist id="known-asset-ids">
                          {knownAssets.map((asset) => (
                            <option key={`${asset.label}-${asset.id}`} value={asset.id}>
                              {asset.label}
                            </option>
                          ))}
                        </datalist>
                        <div className="flex flex-wrap gap-2">
                          {knownAssets.map((asset) => (
                            <button
                              key={`${asset.label}-${asset.id}`}
                              type="button"
                              onClick={() => setAssetId(asset.id)}
                              className={`rounded-sm border px-3 py-1.5 text-xs transition ${assetId === asset.id ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant bg-surface-container-low text-on-surface-variant hover:border-primary/50 hover:text-on-surface'}`}
                            >
                              {asset.label} · {asset.id}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <FormField label={t('create.expiry')} hint={t('create.expiryHint')}>
                <input
                  className={inputCls}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={expiryRounds}
                  onChange={(event) => setExpiryRounds(event.target.value.replace(/[^0-9]/g, ''))}
                />
              </FormField>
              <FormField label={t('create.note')} hint={t('create.noteHint')}>
                <input
                  className={inputCls}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t('create.notePlaceholder')}
                />
              </FormField>
            </div>

            {errorMessage && (
              <div className="rounded-sm border border-error/40 bg-error-container/40 px-3 py-2 text-sm text-on-error-container">
                {errorMessage}
              </div>
            )}
            {createdProposal && (
              <div className="rounded-sm border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-on-surface">
                {t('create.created', {
                  proposalId: createdProposal.proposalId || t('create.createdUnknown'),
                  txId: createdProposal.txId || t('create.createdPending'),
                })}
              </div>
            )}

            {canSelfExecute && <p className="text-xs text-on-surface-variant">{t('create.selfExecuteHint')}</p>}
            <div className="flex items-center justify-end gap-3">
              <Link to={`/safe/${safeId}/proposals`}>
                <Button type="button" variant="ghost">
                  {t('create.cancel')}
                </Button>
              </Link>
              <Button type="submit" variant={canSelfExecute ? 'secondary' : 'primary'} disabled={isSubmitting || !safe}>
                {submitMode === 'prepare' ? (
                  <Icon name="sync" className="animate-spin text-base" />
                ) : (
                  <Icon name="save" className="text-base" />
                )}
                {submitMode === 'prepare' ? t('create.saving') : canSelfExecute ? t('create.prepare') : t('create.save')}
              </Button>
              {canSelfExecute && (
                <Button type="button" disabled={isSubmitting || !safe} onClick={() => void submitProposal(true)}>
                  {submitMode === 'execute' ? (
                    <Icon name="sync" className="animate-spin text-base" />
                  ) : (
                    <Icon name="bolt" className="text-base" />
                  )}
                  {submitMode === 'execute' ? t('create.executing') : t('create.executeNow')}
                </Button>
              )}
            </div>
          </form>
        </Card>

        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-on-surface-variant">{t('create.selectedSafe')}</h2>
            <div className="space-y-2 text-sm text-on-surface-variant">
              <p className="font-semibold text-on-surface">{safe?.name ?? t('create.loadingSafe')}</p>
              <AddressDisplay address={safe?.address} textClassName="text-sm text-on-surface-variant" fallback="—" />
              <p>{t('create.appId', { appId: safe?.appId ?? '—' })}</p>
            </div>
          </Card>
          <Card>
            <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-on-surface-variant">{t('create.balances')}</h2>
            <div className="max-h-52 space-y-2 overflow-y-auto pr-1 text-sm text-on-surface-variant">
              <p>
                {t('create.nativeAlgo')}{' '}
                <span className="font-mono text-on-surface">{holdings?.find((holding) => holding.isNative)?.balanceDisplay ?? '—'}</span>
              </p>
              {proposalKind === 'opt-in' && (
                <div className="flex flex-wrap items-center gap-2">
                  <span>{t('create.optInTarget')}</span>
                  <AddressDisplay address={safe?.address} textClassName="text-sm text-on-surface" fallback="—" />
                </div>
              )}
              {selectedAsset && (
                <p>
                  {t('create.selectedBalance')}{' '}
                  <span className="font-mono text-on-surface">{formatUnits(selectedAsset.rawAmount, selectedAsset.decimals)}</span>
                </p>
              )}
              {proposalKind === 'opt-in' && selectedKnownAsset && (
                <p>
                  {t('create.knownAsset')}{' '}
                  <span className="font-mono text-on-surface">
                    {selectedKnownAsset.label} · {selectedKnownAsset.id}
                  </span>
                </p>
              )}
              {!selectedAsset && proposalKind === 'asset-transfer' && <p>{t('create.selectAssetForBalance')}</p>}
              {proposalKind === 'opt-in' && !assetId && <p>{t('create.chooseKnownAsset')}</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
