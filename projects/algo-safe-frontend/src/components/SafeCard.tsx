import { useNavigate } from 'react-router-dom'
import type { SafeSummary } from '../services/types'
import { Card } from './ui/Card'
import { Icon } from './ui/Icon'
import { StatusBadge } from './ui/StatusBadge'

export function SafeCard({ safe }: { safe: SafeSummary }) {
  const nav = useNavigate()
  return (
    <Card className="cursor-pointer transition hover:border-primary" >
      <button className="w-full text-left" onClick={() => nav(`/safe/${safe.safeId}`)}>
        <div className="flex items-center justify-between">
          <span className="text-lg font-semibold text-on-surface">{safe.name}</span>
          <StatusBadge status={safe.status} />
        </div>
        <div className="mt-1 font-mono text-xs text-on-surface-variant">{safe.address} · App {safe.appId}</div>
        <div className="mt-4 text-2xl font-bold text-on-surface">€{safe.totalValueEur.toLocaleString()}</div>
        <div className="mt-2 flex items-center justify-between text-xs text-on-surface-variant">
          <span>{safe.tier}</span>
          <span className="inline-flex items-center gap-1"><Icon name="smart_toy" className="text-sm" />{safe.agentCount} agents</span>
        </div>
      </button>
    </Card>
  )
}
