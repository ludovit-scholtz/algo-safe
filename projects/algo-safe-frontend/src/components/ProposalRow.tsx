import { useNavigate } from 'react-router-dom'
import type { Proposal } from '../services/types'
import { StatusBadge } from './ui/StatusBadge'
import { Button } from './ui/Button'

export function ProposalRow({ p, safeId, onApprove, onExecute }: {
  p: Proposal; safeId: string; onApprove?: (id: string) => void; onExecute?: (id: string) => void
}) {
  const nav = useNavigate()
  const canApprove = p.status === 'pending' && !p.userHasApproved
  const canExecute = p.status === 'ready' || (p.status === 'pending' && p.approvals >= p.threshold)
  return (
    <div className="flex items-center justify-between border-b border-outline-variant py-4 last:border-0">
      <button className="text-left" onClick={() => nav(`/safe/${safeId}/proposals/${p.id}`)}>
        <div className="flex items-center gap-2"><span className="font-mono text-xs text-on-surface-variant">#{p.id}</span><span className="font-medium text-on-surface">{p.title}</span></div>
        <div className="mt-1 text-xs text-on-surface-variant">{p.date} · Consensus {p.approvals}/{p.threshold}</div>
      </button>
      <div className="flex items-center gap-3">
        <StatusBadge status={p.status} />
        {canApprove && onApprove && <Button variant="secondary" onClick={() => onApprove(p.id)}>Approve</Button>}
        {canExecute && onExecute && <Button onClick={() => onExecute(p.id)}>Execute</Button>}
      </div>
    </div>
  )
}
