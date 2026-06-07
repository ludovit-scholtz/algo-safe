// src/pages/AgentDashboardPage.tsx
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Fireworks, type FireworksHandlers } from '@fireworks-js/react'
import { AgentStatusCard } from '../components/AgentStatusCard'
import { SafeHoldingsTable } from '../components/SafeHoldingsTable'
import { Card } from '../components/ui/Card'
import { Icon } from '../components/ui/Icon'
import { StatCard } from '../components/ui/StatCard'
import { StatusBadge } from '../components/ui/StatusBadge'
import { useAgents, useProposals } from '../hooks'
import { useOnChainSafeHoldings } from '../hooks/useOnChainSafeHoldings'
import { useSafeId } from '../lib/SafeContext'
import { store } from '../lib/store'

export function AgentDashboardPage() {
  const safeId = useSafeId()
  const location = useLocation()
  const navigate = useNavigate()
  const { data: holdings, isLoading: holdingsLoading, error: holdingsError } = useOnChainSafeHoldings(safeId)
  const { data: agents } = useAgents()
  const { data: proposals } = useProposals()
  const [block, setBlock] = useState(42100001)
  const fireworksRef = useRef<FireworksHandlers | null>(null)
  const [showCelebration, setShowCelebration] = useState(false)
  const executionSuccess = (location.state as { executionSuccess?: { txId: string; confirmedRound: number; proposalId: string } } | null)?.executionSuccess

  useEffect(() => {
    const t = setInterval(() => setBlock((b) => b + 1), 3000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!executionSuccess || showCelebration) return

    setShowCelebration(true)

    const animationFrame = window.requestAnimationFrame(() => {
      fireworksRef.current?.launch(18)
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [executionSuccess, showCelebration])

  const activeAgents = agents?.filter((a) => a.status === 'active') ?? []
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
          <h2 className="font-mono text-xs uppercase tracking-wide text-on-surface-variant">Registered Agents</h2>
          <span className="font-mono text-xs text-on-surface-variant">Block #{block.toLocaleString()}</span>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents?.map((a) => (
            <AgentStatusCard key={a.id} agent={a} dailyUsed={store.policies[a.id]?.dailyUsed ?? 0} />
          ))}
          {!agents?.length && <div className="col-span-full animate-pulse rounded-md bg-surface-container h-32" />}
        </div>
      </section>

      {/* Demo Environment Panel — mirrors the x402 interactive demo from the reference */}
      <section>
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-on-surface-variant">Demo Environment</h2>
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container-high px-6 py-4">
            <div className="flex items-center gap-3">
              <Icon name="cloud_done" className="text-secondary" />
              <span className="text-base font-medium text-on-surface">Weather Service x402 Request</span>
            </div>
            <span className="rounded bg-secondary-container/20 px-3 py-1 font-mono text-xs text-secondary">Demo Environment</span>
          </div>
          <div className="px-6 py-5">
            <p className="text-sm text-on-surface-variant">
              This service provides high-fidelity atmospheric data for risk-assessment agents. Each request costs{' '}
              <span className="font-semibold text-on-surface">0.50 EURD</span>. Agent spending limits are enforced automatically by the Safe
              Policy.
            </p>
            <div className="mt-4 flex items-center gap-2 rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-2">
              <Icon name="update" className="text-sm text-on-surface-variant" />
              <span className="font-mono text-xs text-on-surface-variant">Last Heartbeat: 2s ago · Block #{block.toLocaleString()}</span>
            </div>
          </div>
        </Card>
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
