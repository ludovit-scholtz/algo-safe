// src/pages/AgentDashboardPage.tsx
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWallet } from '@txnlab/use-wallet-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Fireworks, type FireworksHandlers } from '@fireworks-js/react'
import { AddressDisplay } from '../components/AddressDisplay'
import { SafeHoldingsTable } from '../components/SafeHoldingsTable'
import { SignerGroupCard } from '../components/SignerGroupCard'
import { Card } from '../components/ui/Card'
import { Icon } from '../components/ui/Icon'
import { StatCard } from '../components/ui/StatCard'
import { StatusBadge } from '../components/ui/StatusBadge'
import { useProposals, useSafe, useSignerGroups } from '../hooks'
import { useOnChainSafeHoldings } from '../hooks/useOnChainSafeHoldings'
import { useSafeId } from '../lib/SafeContext'

export function AgentDashboardPage() {
  const safeId = useSafeId()
  const location = useLocation()
  const navigate = useNavigate()
  const { algodClient } = useWallet()
  const { data: safe } = useSafe(safeId)
  const { data: holdings, isLoading: holdingsLoading, error: holdingsError } = useOnChainSafeHoldings(safeId)
  const { data: signerGroups, isLoading: signerGroupsLoading, isFetching: signerGroupsFetching, error: signerGroupsError } = useSignerGroups()
  const { data: proposals } = useProposals()
  const fireworksRef = useRef<FireworksHandlers | null>(null)
  const [showCelebration, setShowCelebration] = useState(false)
  const executionSuccess = (location.state as { executionSuccess?: { txId: string; confirmedRound: number; proposalId: string } } | null)?.executionSuccess
  const { data: currentRound } = useQuery({
    queryKey: ['algod-round'],
    queryFn: async () => {
      const status = await algodClient.status().do()
      return Number(status.lastRound ?? 0)
    },
    refetchInterval: 5000,
  })

  useEffect(() => {
    if (!executionSuccess || showCelebration) return

    setShowCelebration(true)

    const animationFrame = window.requestAnimationFrame(() => {
      fireworksRef.current?.launch(18)
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [executionSuccess, showCelebration])

  const pending = proposals?.filter((p) => p.status === 'pending' || p.status === 'ready').length ?? 0
  const nativeHolding = holdings?.find((holding) => holding.isNative)
  const optedInAssets = holdings?.filter((holding) => !holding.isNative) ?? []

  return (
    <div className="space-y-6">
      {executionSuccess && (
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

      {executionSuccess && (
        <div className="rounded-md border border-primary/30 bg-primary/10 px-5 py-4">
          <div className="flex items-start gap-3 pr-4">
            <Icon name="celebration" className="mt-0.5 text-primary text-[22px]" />
            <div>
              <p className="text-sm font-semibold text-on-surface">Execution confirmed and balances refreshed</p>
              <p className="text-sm text-on-surface-variant">
                Proposal #{executionSuccess.proposalId} was confirmed in round {executionSuccess.confirmedRound}. Tx ID: {executionSuccess.txId}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Page Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold text-on-surface">Agent Dashboard</h1>
          <p className="mt-1 text-sm text-on-surface-variant">Monitor and interact with specialized treasury execution agents.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-on-surface-variant">
            <span className="font-mono text-xs uppercase tracking-wide">Safe Address</span>
            <AddressDisplay address={safe?.address} textClassName="text-sm text-on-surface" buttonClassName="h-5 w-5" />
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-xs uppercase tracking-wide text-on-surface-variant">Native Balance</p>
          <p className="mt-0.5 text-lg font-bold text-on-surface">{nativeHolding?.balanceDisplay ?? '—'} ALGO</p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          label="Native Balance"
          value={nativeHolding ? `${nativeHolding.balanceDisplay} ALGO` : '—'}
          sub="Current smart-account ALGO balance"
        />
        <StatCard label="Opted-In Assets" value={optedInAssets.length} sub="ASA holdings loaded directly from algod" />
        <StatCard label="Action Required" value={pending} sub={pending > 0 ? 'Proposals need attention' : 'All clear'} />
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-wide text-on-surface-variant">Treasury Holdings</h2>
          <button className="font-mono text-xs text-primary hover:underline" onClick={() => navigate(`/safe/${safeId}/assets`)}>
            Open Assets Page
          </button>
        </div>
        <SafeHoldingsTable
          holdings={holdings}
          isLoading={holdingsLoading}
          error={holdingsError instanceof Error ? holdingsError.message : null}
          emptyMessage="No on-chain balances were found for this smart-account address."
        />
      </section>

      {/* Agents Grid */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-wide text-on-surface-variant">Registered Signer Groups</h2>
          <div className="flex items-center gap-2 font-mono text-xs text-on-surface-variant">
            {(signerGroupsLoading || signerGroupsFetching) && <Icon name="progress_activity" className="animate-spin text-sm" />}
            <span>Round #{currentRound?.toLocaleString() ?? '—'}</span>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {signerGroups?.map((group) => (
            <SignerGroupCard key={group.id} group={group} />
          ))}
          {(signerGroupsLoading || signerGroupsFetching) && <div className="col-span-full flex h-32 items-center justify-center rounded-md border border-outline-variant bg-surface-container-low">
            <div className="flex items-center gap-3 text-sm text-on-surface-variant">
              <Icon name="progress_activity" className="animate-spin text-lg" />
              <span>Loading signer groups from the blockchain…</span>
            </div>
          </div>}
          {!signerGroupsLoading && !signerGroupsFetching && signerGroupsError instanceof Error && (
            <Card className="col-span-full px-6 py-8 text-center text-sm text-error">
              {signerGroupsError.message}
            </Card>
          )}
          {!signerGroupsLoading && !signerGroupsFetching && !(signerGroupsError instanceof Error) && !signerGroups?.length && (
            <Card className="col-span-full px-6 py-8 text-center text-sm text-on-surface-variant">
              No signer groups were found for this safe.
            </Card>
          )}
        </div>
      </section>

      {/* Activity Log */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-wide text-on-surface-variant">Activity Log</h2>
          <button className="font-mono text-xs text-primary hover:underline" onClick={() => navigate(`/safe/${safeId}/proposals`)}>
            View All Transactions
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
                        {p.amount.toLocaleString()} {p.asset}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-right">
                  <StatusBadge status={p.status} />
                  <div>
                    <p className="font-mono text-xs text-on-surface">{p.date}</p>
                    <p className="font-mono text-xs text-on-surface-variant">
                      {p.approvals}/{p.threshold} signatures
                    </p>
                  </div>
                </div>
              </li>
            ))}
            {!proposals?.length && <li className="px-6 py-8 text-center text-sm text-on-surface-variant">No activity yet.</li>}
          </ul>
        </Card>
      </section>
    </div>
  )
}
