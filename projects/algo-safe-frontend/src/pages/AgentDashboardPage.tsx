// src/pages/AgentDashboardPage.tsx
import { Fireworks, type FireworksHandlers } from '@fireworks-js/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@txnlab/use-wallet-react'
import { getAlgoSafeContractVersion } from 'algo-safe'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { AddressDisplay } from '../components/AddressDisplay'
import { SafeGovernanceControls } from '../components/SafeGovernanceControls'
import { SafeHoldingsTable } from '../components/SafeHoldingsTable'
import { SignerGroupCard } from '../components/SignerGroupCard'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Icon } from '../components/ui/Icon'
import { StatCard } from '../components/ui/StatCard'
import { StatusBadge } from '../components/ui/StatusBadge'
import { useProposals, useSafe, useSignerGroups } from '../hooks'
import { useOnChainSafeHoldings } from '../hooks/useOnChainSafeHoldings'
import { getKnownAssets } from '../lib/assetMetadata'
import { proposeAssetOptIn } from '../lib/optInProposal'
import { useSafeId } from '../lib/SafeContext'
import { currentLocale } from '../i18n/instance'

export function AgentDashboardPage() {
  const { t } = useTranslation('agents')
  const safeId = useSafeId()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { algodClient, activeAddress, transactionSigner, isReady } = useWallet()
  const { data: safe } = useSafe(safeId)
  const { data: holdings, isLoading: holdingsLoading, error: holdingsError } = useOnChainSafeHoldings(safeId)
  const {
    data: signerGroups,
    isLoading: signerGroupsLoading,
    isFetching: signerGroupsFetching,
    error: signerGroupsError,
  } = useSignerGroups()
  const { data: proposals } = useProposals()
  const fireworksRef = useRef<FireworksHandlers | null>(null)
  const [showCelebration, setShowCelebration] = useState(false)
  const [openingEurd, setOpeningEurd] = useState(false)
  const [eurdError, setEurdError] = useState<string | null>(null)
  const initializationSuccess = (location.state as { initializationSuccess?: { appId: string; name: string } } | null)
    ?.initializationSuccess
  const executionSuccess = (location.state as { executionSuccess?: { txId: string; confirmedRound: number; proposalId: string } } | null)
    ?.executionSuccess
  const { data: currentRound } = useQuery({
    queryKey: ['algod-round'],
    queryFn: async () => {
      const status = await algodClient.status().do()
      return Number(status.lastRound ?? 0)
    },
    refetchInterval: 5000,
  })
  const { data: contractVersion, isLoading: contractVersionLoading } = useQuery({
    queryKey: ['safe-contract-version', safe?.appId],
    enabled: !!safe?.appId,
    queryFn: () => getAlgoSafeContractVersion(algodClient, BigInt(safe!.appId)),
  })

  useEffect(() => {
    if (!(holdingsError instanceof Error)) return
  }, [holdingsError, safe?.appId, safeId])

  useEffect(() => {
    if (!(signerGroupsError instanceof Error)) return
  }, [safe?.appId, safeId, signerGroupsError])

  useEffect(() => {
    if (!eurdError) return
  }, [eurdError, safe?.appId, safeId])

  useEffect(() => {
    if ((!executionSuccess && !initializationSuccess) || showCelebration) return

    setShowCelebration(true)

    const animationFrame = window.requestAnimationFrame(() => {
      fireworksRef.current?.launch(18)
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [executionSuccess, initializationSuccess, showCelebration])

  const pending = proposals?.filter((p) => p.status === 'pending' || p.status === 'ready').length ?? 0
  const nativeHolding = holdings?.find((holding) => holding.isNative)
  const optedInAssets = holdings?.filter((holding) => !holding.isNative) ?? []

  // "Open EURD account": shown only on mainnet, only while the safe is not yet
  // opted in to EURD. One click creates the same opt-in proposal the Create
  // Proposal page would, then routes to that proposal's approval page.
  const eurdAsset = getKnownAssets(safe?.network).find((asset) => asset.symbol === 'EURD')
  const isOptedIntoEurd = !!eurdAsset && (holdings ?? []).some((holding) => holding.assetId === eurdAsset.assetId)
  const showOpenEurd = safe?.network === 'mainnet' && !!eurdAsset && !holdingsLoading && !isOptedIntoEurd

  async function handleOpenEurd() {
    if (!safe || !eurdAsset) return
    if (!isReady || !activeAddress || !transactionSigner) {
      setEurdError(t('dashboard.eurdConnect'))
      return
    }
    setEurdError(null)
    setOpeningEurd(true)
    try {
      const { proposalId, txId } = await proposeAssetOptIn({
        algodClient,
        activeAddress,
        transactionSigner,
        appId: safe.appId,
        safeAddress: safe.address,
        assetId: eurdAsset.assetId,
      })
      await queryClient.invalidateQueries({ queryKey: ['proposals', safeId] })
      navigate(`/safe/${safeId}/proposals/${proposalId}`, { state: { txId } })
    } catch (error) {
      setEurdError(error instanceof Error && error.message.trim() ? error.message : t('dashboard.eurdFailed'))
    } finally {
      setOpeningEurd(false)
    }
  }

  return (
    <div className="space-y-6">
      {(executionSuccess || initializationSuccess) && (
        <Fireworks
          ref={fireworksRef}
          autostart={false}
          options={{
            opacity: 0.6,
            sound: { enabled: false },
            rocketsPoint: { min: 15, max: 85 },
          }}
          className="pointer-events-none fixed inset-0 z-50"
        />
      )}

      {initializationSuccess && (
        <div className="rounded-md border border-primary/30 bg-primary/10 px-5 py-4">
          <div className="flex items-start gap-3 pr-4">
            <Icon name="celebration" className="mt-0.5 text-primary text-[22px]" />
            <div>
              <p className="text-sm font-semibold text-on-surface">{t('dashboard.initTitle')}</p>
              <p className="text-sm text-on-surface-variant">
                {t('dashboard.initBody', { name: initializationSuccess.name, appId: initializationSuccess.appId })}
              </p>
            </div>
          </div>
        </div>
      )}

      {executionSuccess && (
        <div className="rounded-md border border-primary/30 bg-primary/10 px-5 py-4">
          <div className="flex items-start gap-3 pr-4">
            <Icon name="celebration" className="mt-0.5 text-primary text-[22px]" />
            <div>
              <p className="text-sm font-semibold text-on-surface">{t('dashboard.execTitle')}</p>
              <p className="text-sm text-on-surface-variant">
                {t('dashboard.execBody', {
                  proposalId: executionSuccess.proposalId,
                  round: executionSuccess.confirmedRound,
                  txId: executionSuccess.txId,
                })}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Open EURD account — mainnet only, shown until the safe is opted in to EURD */}
      {showOpenEurd && (
        <div className="flex flex-col gap-3 rounded-md border border-secondary/40 bg-secondary/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Icon name="euro" className="mt-0.5 text-secondary text-[22px]" />
            <div>
              <p className="text-sm font-semibold text-on-surface">{t('dashboard.eurdTitle')}</p>
              <p className="text-sm text-on-surface-variant">{t('dashboard.eurdBody', { assetId: eurdAsset?.assetId })}</p>
              {eurdError && <p className="mt-1 text-sm text-error">{eurdError}</p>}
            </div>
          </div>
          <Button onClick={() => void handleOpenEurd()} disabled={openingEurd} className="shrink-0">
            {openingEurd ? <Icon name="sync" className="animate-spin text-base" /> : <Icon name="add_card" className="text-base" />}
            {openingEurd ? t('dashboard.creating') : t('dashboard.openEurd')}
          </Button>
        </div>
      )}

      {/* Page Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold text-on-surface">{t('dashboard.title')}</h1>
          <p className="mt-1 text-sm text-on-surface-variant">{t('dashboard.subtitle')}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-on-surface-variant">
            <span className="font-mono text-xs uppercase tracking-wide">{t('dashboard.safeAddress')}</span>
            <AddressDisplay address={safe?.address} textClassName="text-sm text-on-surface" buttonClassName="h-5 w-5" />
          </div>
          <div className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-md border border-outline-variant bg-surface-container-low px-3 py-2 text-sm">
            <span className="font-mono text-xs uppercase tracking-wide text-on-surface-variant">{t('dashboard.contractVersion')}</span>
            <span className="font-semibold text-on-surface">
              {contractVersionLoading ? t('dashboard.loading') : (contractVersion ?? t('dashboard.versionNotDetected'))}
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-xs uppercase tracking-wide text-on-surface-variant">{t('dashboard.nativeBalance')}</p>
          <p className="mt-0.5 text-lg font-bold text-on-surface">{nativeHolding?.balanceDisplay ?? '—'} ALGO</p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          label={t('dashboard.nativeBalance')}
          value={nativeHolding ? `${nativeHolding.balanceDisplay} ALGO` : '—'}
          sub={t('dashboard.nativeSub')}
        />
        <StatCard label={t('dashboard.optedIn')} value={optedInAssets.length} sub={t('dashboard.optedInSub')} />
        <StatCard
          label={t('dashboard.actionRequired')}
          value={pending}
          sub={pending > 0 ? t('dashboard.needAttention') : t('dashboard.allClear')}
        />
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-wide text-on-surface-variant">{t('dashboard.holdings')}</h2>
          <button className="font-mono text-xs text-primary hover:underline" onClick={() => navigate(`/safe/${safeId}/assets`)}>
            {t('dashboard.openAssets')}
          </button>
        </div>
        <SafeHoldingsTable
          holdings={holdings}
          isLoading={holdingsLoading}
          error={holdingsError instanceof Error ? holdingsError.message : null}
          emptyMessage={t('dashboard.noBalances')}
        />
      </section>

      {/* Safe-wide governance controls (pause / create group) */}
      <section>
        <SafeGovernanceControls />
      </section>

      {/* Agents Grid */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-wide text-on-surface-variant">{t('dashboard.groups')}</h2>
          <div className="flex items-center gap-2 font-mono text-xs text-on-surface-variant">
            {(signerGroupsLoading || signerGroupsFetching) && <Icon name="progress_activity" className="animate-spin text-sm" />}
            <span>{t('dashboard.round', { round: currentRound?.toLocaleString(currentLocale()) ?? '—' })}</span>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {signerGroups?.map((group) => (
            <SignerGroupCard key={group.id} group={group} />
          ))}
          {(signerGroupsLoading || signerGroupsFetching) && (
            <div className="col-span-full flex h-32 items-center justify-center rounded-md border border-outline-variant bg-surface-container-low">
              <div className="flex items-center gap-3 text-sm text-on-surface-variant">
                <Icon name="progress_activity" className="animate-spin text-lg" />
                <span>{t('dashboard.loadingGroups')}</span>
              </div>
            </div>
          )}
          {!signerGroupsLoading && !signerGroupsFetching && signerGroupsError instanceof Error && (
            <Card className="col-span-full px-6 py-8 text-center text-sm text-error">{signerGroupsError.message}</Card>
          )}
          {!signerGroupsLoading && !signerGroupsFetching && !(signerGroupsError instanceof Error) && !signerGroups?.length && (
            <Card className="col-span-full px-6 py-8 text-center text-sm text-on-surface-variant">{t('dashboard.noGroups')}</Card>
          )}
        </div>
      </section>

      {/* Activity Log */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-wide text-on-surface-variant">{t('dashboard.activity')}</h2>
          <button className="font-mono text-xs text-primary hover:underline" onClick={() => navigate(`/safe/${safeId}/proposals`)}>
            {t('dashboard.viewAll')}
          </button>
        </div>
        <Card className="p-0">
          <ul className="divide-y divide-outline-variant">
            {proposals?.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between px-6 py-4 hover:bg-surface-container-high transition-colors group"
              >
                <div className="flex items-center gap-4">
                  <Icon
                    name={p.status === 'executed' ? 'check_circle' : p.status === 'ready' ? 'rocket_launch' : 'pending'}
                    className={`text-lg ${
                      p.status === 'executed' ? 'text-primary' : p.status === 'ready' ? 'text-primary' : 'text-on-surface-variant'
                    }`}
                  />
                  <div>
                    <p className="text-sm font-medium text-on-surface">
                      #{p.id} {p.title}
                    </p>
                    {p.amount != null && (
                      <p className="font-mono text-xs text-on-surface-variant">
                        {p.amount.toLocaleString(currentLocale())} {p.asset}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-right">
                  <StatusBadge status={p.status} />
                  <div>
                    <p className="font-mono text-xs text-on-surface">{p.date}</p>
                    <p className="font-mono text-xs text-on-surface-variant">
                      {t('dashboard.signatures', { approvals: p.approvals, threshold: p.threshold })}
                    </p>
                  </div>
                </div>
              </li>
            ))}
            {!proposals?.length && <li className="px-6 py-8 text-center text-sm text-on-surface-variant">{t('dashboard.noActivity')}</li>}
          </ul>
        </Card>
      </section>
    </div>
  )
}
