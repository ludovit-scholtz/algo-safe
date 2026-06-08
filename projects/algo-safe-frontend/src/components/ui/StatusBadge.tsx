import type { ProposalStatus } from '../../services/types'
const map: Record<string, string> = {
  executed: 'text-primary bg-on-primary-container/30',
  pending: 'text-secondary bg-secondary-container/30',
  ready: 'text-primary bg-primary/10',
  draft: 'text-on-surface-variant bg-surface-container-high',
  blocked: 'text-error bg-error-container/40',
  rejected: 'text-error bg-error-container/40',
  expired: 'text-on-surface-variant bg-surface-container-high',
  cancelled: 'text-on-surface-variant bg-surface-container-high',
  active: 'text-primary bg-on-primary-container/30',
  pending_review: 'text-warn bg-warn/15',
  paused: 'text-on-surface-variant bg-surface-container-high',
}
export const StatusBadge = ({ status, children }: { status: ProposalStatus | string; children?: React.ReactNode }) => (
  <span
    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide font-mono ${map[status] ?? 'text-on-surface-variant bg-surface-container-high'}`}
  >
    {children ?? status}
  </span>
)
