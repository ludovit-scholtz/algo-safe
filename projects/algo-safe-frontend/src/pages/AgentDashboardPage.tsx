// src/pages/AgentDashboardPage.tsx
import { useEffect, useState } from 'react'
import { useSafeId } from '../lib/SafeContext'
import { useAgents, useTreasury, useProposals } from '../hooks'
import { StatCard } from '../components/ui/StatCard'
import { AgentStatusCard } from '../components/AgentStatusCard'
import { Card } from '../components/ui/Card'
import { Icon } from '../components/ui/Icon'
import { StatusBadge } from '../components/ui/StatusBadge'
import { store } from '../lib/store'

export function AgentDashboardPage() {
  const safeId = useSafeId()
  const { data: treasury } = useTreasury(safeId)
  const { data: agents } = useAgents()
  const { data: proposals } = useProposals()
  const [block, setBlock] = useState(42100001)

  useEffect(() => {
    const t = setInterval(() => setBlock(b => b + 1), 3000)
    return () => clearInterval(t)
  }, [])

  const activeAgents = agents?.filter(a => a.status === 'active') ?? []
  const pending = proposals?.filter(p => p.status === 'pending' || p.status === 'blocked').length ?? 0

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold text-on-surface">Agent Dashboard</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Monitor and interact with specialized treasury execution agents.
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-xs uppercase tracking-wide text-on-surface-variant">
            Total Treasury Balance
          </p>
          <p className="mt-0.5 text-lg font-bold text-on-surface">
            €{treasury?.totalValueEur.toLocaleString() ?? '—'}
          </p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          label="Total Value"
          value={`€${treasury?.totalValueEur.toLocaleString() ?? '—'}`}
          sub="Combined treasury holdings"
        />
        <StatCard
          label="Active Agents"
          value={activeAgents.length}
          sub={`${agents?.length ?? 0} total registered`}
        />
        <StatCard
          label="Action Required"
          value={pending}
          sub={pending > 0 ? 'Proposals need attention' : 'All clear'}
        />
      </div>

      {/* Agents Grid */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-wide text-on-surface-variant">
            Registered Agents
          </h2>
          <span className="font-mono text-xs text-on-surface-variant">
            Block #{block.toLocaleString()}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents?.map(a => (
            <AgentStatusCard
              key={a.id}
              agent={a}
              dailyUsed={store.policies[a.id]?.dailyUsed ?? 0}
            />
          ))}
          {!agents?.length && (
            <div className="col-span-full animate-pulse rounded-md bg-surface-container h-32" />
          )}
        </div>
      </section>

      {/* Demo Environment Panel — mirrors the x402 interactive demo from the reference */}
      <section>
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-on-surface-variant">
          Demo Environment
        </h2>
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-outline-variant bg-surface-container-high px-6 py-4">
            <div className="flex items-center gap-3">
              <Icon name="cloud_done" className="text-secondary" />
              <span className="text-base font-medium text-on-surface">
                Weather Service x402 Request
              </span>
            </div>
            <span className="rounded bg-secondary-container/20 px-3 py-1 font-mono text-xs text-secondary">
              Demo Environment
            </span>
          </div>
          <div className="px-6 py-5">
            <p className="text-sm text-on-surface-variant">
              This service provides high-fidelity atmospheric data for risk-assessment agents. Each
              request costs{' '}
              <span className="font-semibold text-on-surface">0.50 EURD</span>. Agent spending
              limits are enforced automatically by the Safe Policy.
            </p>
            <div className="mt-4 flex items-center gap-2 rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-2">
              <Icon name="update" className="text-sm text-on-surface-variant" />
              <span className="font-mono text-xs text-on-surface-variant">
                Last Heartbeat: 2s ago · Block #{block.toLocaleString()}
              </span>
            </div>
          </div>
        </Card>
      </section>

      {/* Activity Log */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-mono text-xs uppercase tracking-wide text-on-surface-variant">
            Activity Log
          </h2>
          <button className="font-mono text-xs text-primary hover:underline">
            View All Transactions
          </button>
        </div>
        <Card className="p-0">
          <ul className="divide-y divide-outline-variant">
            {proposals?.map(p => (
              <li
                key={p.id}
                className="flex items-center justify-between px-6 py-4 hover:bg-surface-container-high transition-colors group"
              >
                <div className="flex items-center gap-4">
                  <Icon
                    name={
                      p.status === 'executed'
                        ? 'check_circle'
                        : p.status === 'blocked'
                        ? 'block'
                        : 'pending'
                    }
                    className={`text-lg ${
                      p.status === 'executed'
                        ? 'text-primary'
                        : p.status === 'blocked'
                        ? 'text-error'
                        : 'text-on-surface-variant'
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
            {!proposals?.length && (
              <li className="px-6 py-8 text-center text-sm text-on-surface-variant">
                No activity yet.
              </li>
            )}
          </ul>
        </Card>
      </section>
    </div>
  )
}
