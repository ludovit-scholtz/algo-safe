// src/pages/ProposalsPage.tsx
import { useSafeId } from '../lib/SafeContext'
import { useProposals, useApproveProposal, useExecuteProposal } from '../hooks'
import { ProposalRow } from '../components/ProposalRow'
import { Card } from '../components/ui/Card'
import { StatCard } from '../components/ui/StatCard'

export function ProposalsPage() {
  const safeId = useSafeId()
  const { data: proposals } = useProposals()
  const approve = useApproveProposal()
  const execute = useExecuteProposal()

  const ps = proposals ?? []
  const actionRequired = ps.filter((p) => p.status === 'ready')
  const awaiting = ps.filter((p) => p.status === 'pending' && !p.userHasApproved)
  const inProgress = ps.filter((p) => p.status === 'pending' && p.userHasApproved)
  const completed = ps.filter((p) => ['executed', 'cancelled', 'expired'].includes(p.status))
  const avg = ps.length ? Math.round((ps.reduce((s, p) => s + p.approvals / p.threshold, 0) / ps.length) * 100) : 0

  const section = (title: string, list: typeof ps) =>
    list.length > 0 && (
      <section>
        <h2 className="mb-2 font-mono text-xs uppercase tracking-wide text-on-surface-variant">{title}</h2>
        <Card>
          {list.map((p) => (
            <ProposalRow key={p.id} p={p} safeId={safeId} onApprove={approve.mutate} onExecute={(id) => execute.mutate({ id })} />
          ))}
        </Card>
      </section>
    )

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-on-surface">Proposals</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard label="Ready To Execute" value={actionRequired.length} />
        <StatCard label="Awaiting Your Approval" value={awaiting.length} />
        <StatCard label="Avg. Consensus" value={`${avg}%`} />
      </div>

      {/* Grouped sections */}
      {section('Ready To Execute', actionRequired)}
      {section('Awaiting Your Approval', awaiting)}
      {section('Awaiting Other Signers', inProgress)}
      {section('Completed', completed)}

      {/* Empty state */}
      {ps.length === 0 && (
        <div className="rounded-md border border-outline-variant bg-surface-container p-10 text-center text-sm text-on-surface-variant">
          No proposals found.
        </div>
      )}
    </div>
  )
}
