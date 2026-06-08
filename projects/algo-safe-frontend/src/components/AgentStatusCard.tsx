import type { Agent } from '../services/types'
import { AddressDisplay } from './AddressDisplay'
import { Card } from './ui/Card'

const pulse: Record<Agent['status'], string> = {
  active: 'bg-primary',
  paused: 'bg-on-surface-variant',
  pending_review: 'bg-warn',
}
export function AgentStatusCard({ agent, dailyUsed = 0 }: { agent: Agent; dailyUsed?: number }) {
  const pct = Math.min(100, Math.round((dailyUsed / agent.dailyLimit) * 100))
  return (
    <Card>
      <div className="flex items-center justify-between">
        <span className="font-semibold text-on-surface">{agent.alias}</span>
        <span className="relative flex h-3 w-3">
          <span
            className={`absolute inline-flex h-full w-full rounded-full opacity-60 ${pulse[agent.status]} ${agent.status === 'active' ? 'animate-ping' : ''}`}
          />
          <span className={`relative inline-flex h-3 w-3 rounded-full ${pulse[agent.status]}`} />
        </span>
      </div>
      <AddressDisplay address={agent.address} className="mt-1" textClassName="text-xs text-on-surface-variant" buttonClassName="h-5 w-5" />
      <div className="mt-4">
        <div className="flex justify-between font-mono text-xs uppercase text-on-surface-variant">
          <span>Daily Spend</span>
          <span>{pct}%</span>
        </div>
        <div className="mt-1 h-2 w-full rounded-full bg-surface-container-lowest">
          <div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 text-xs text-on-surface-variant">
          {dailyUsed.toLocaleString()} / {agent.dailyLimit.toLocaleString()} {agent.primaryAsset} · {agent.groupTier}
        </div>
      </div>
    </Card>
  )
}
