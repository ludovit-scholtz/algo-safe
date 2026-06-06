import type { ProposalStatus } from '../../services/types'
const map: Record<string, string> = {
  executed: 'text-ok bg-green-50', pending: 'text-brand-600 bg-brand-50', draft: 'text-ink-500 bg-surface-muted',
  blocked: 'text-danger bg-red-50', rejected: 'text-danger bg-red-50', expired: 'text-ink-400 bg-surface-muted',
  active: 'text-ok bg-green-50', pending_review: 'text-warn bg-amber-50', paused: 'text-ink-500 bg-surface-muted',
}
export const StatusBadge = ({ status, children }: { status: ProposalStatus | string; children?: React.ReactNode }) =>
  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${map[status] ?? 'text-ink-500 bg-surface-muted'}`}>{children ?? status}</span>
