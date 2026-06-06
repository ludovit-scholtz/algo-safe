// src/pages/ProposalDetailPage.tsx
import { useParams, useNavigate } from 'react-router-dom'
import { useSnackbar } from 'notistack'
import { useProposal, useApproveProposal, useRejectProposal, useExecuteProposal } from '../hooks'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Icon } from '../components/ui/Icon'
import { Skeleton } from '../components/ui/Skeleton'
import { StatusBadge } from '../components/ui/StatusBadge'
import { fmtEur, fmtNum } from '../lib/format'

// Chip for transaction type: pay/axfer/appl/keyreg
const TX_TYPE_STYLES: Record<string, string> = {
  pay:    'bg-secondary-container/20 text-secondary border-secondary-container',
  axfer:  'bg-on-primary-container/20 text-primary border-on-primary-container/30',
  appl:   'bg-warn/15 text-warn border-warn/20',
  keyreg: 'bg-surface-container-high text-on-surface-variant border-outline-variant',
}
const TxChip = ({ type }: { type: string }) => (
  <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide border ${TX_TYPE_STYLES[type] ?? TX_TYPE_STYLES.keyreg}`}>
    {type}
  </span>
)

export const ProposalDetailPage = () => {
  // New nested route: /safe/:safeId/proposals/:id
  const { safeId, id } = useParams<{ safeId: string; id: string }>()
  const navigate = useNavigate()
  const { enqueueSnackbar } = useSnackbar()

  const { data: proposal, isLoading } = useProposal(id)
  const approveProposal = useApproveProposal()
  const rejectProposal = useRejectProposal()
  const executeProposal = useExecuteProposal()

  const backPath = `/safe/${safeId}/proposals`

  // ── Loading state ─────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="max-w-[1440px] mx-auto">
        <div className="flex flex-col gap-4 mb-8">
          <Skeleton className="h-9 w-80" />
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 flex flex-col gap-4">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
          <div className="lg:col-span-4">
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      </div>
    )
  }

  // ── Not found ─────────────────────────────────────────────────────────────
  if (!proposal) {
    return (
      <div className="max-w-[1440px] mx-auto">
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-14 h-14 rounded-full bg-surface-container-high flex items-center justify-center mb-4">
            <Icon name="search_off" className="text-on-surface-variant text-[28px]" />
          </div>
          <h3 className="text-lg font-semibold text-on-surface mb-1">Proposal not found</h3>
          <p className="text-sm text-on-surface-variant mb-6">
            No proposal with ID <span className="font-mono text-on-surface">#{id}</span> exists.
          </p>
          <Button variant="secondary" onClick={() => navigate(backPath)}>
            <Icon name="arrow_back" className="text-[16px]" />
            Back to Proposals
          </Button>
        </div>
      </div>
    )
  }

  const isTerminal = proposal.status === 'executed' || proposal.status === 'rejected'
  const canExecute = proposal.approvals >= proposal.threshold && !isTerminal
  const approveLabel = proposal.status === 'blocked' ? 'Approve (admin override)' : 'Approve'
  const progressPct = Math.min(100, Math.round((proposal.approvals / proposal.threshold) * 100))

  const handleApprove = () => {
    approveProposal.mutate(proposal.id, {
      onSuccess: () => enqueueSnackbar('Proposal approved', { variant: 'success' }),
      onError: () => enqueueSnackbar('Failed to approve', { variant: 'error' }),
    })
  }

  const handleReject = () => {
    rejectProposal.mutate(proposal.id, {
      onSuccess: () => enqueueSnackbar('Proposal rejected', { variant: 'default' }),
      onError: () => enqueueSnackbar('Failed to reject', { variant: 'error' }),
    })
  }

  const handleExecute = () => {
    executeProposal.mutate(proposal.id, {
      onSuccess: () => enqueueSnackbar('Proposal executed on-chain', { variant: 'success' }),
      onError: () => enqueueSnackbar('Execution failed', { variant: 'error' }),
    })
  }

  return (
    <div className="max-w-[1440px] mx-auto flex flex-col gap-6">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1 text-sm text-on-surface-variant">
            <button
              onClick={() => navigate(backPath)}
              className="hover:text-primary transition-colors flex items-center gap-1 font-medium"
            >
              <Icon name="arrow_back" className="text-[14px]" />
              Proposals
            </button>
            <Icon name="chevron_right" className="text-[14px]" />
            <span className="font-mono">#{proposal.id}</span>
          </div>
          <div className="flex items-center flex-wrap gap-3">
            <h2 className="text-3xl font-bold text-on-surface tracking-tight">{proposal.title}</h2>
            <StatusBadge status={proposal.status} />
          </div>
          <p className="text-sm text-on-surface-variant mt-1">{proposal.date}</p>
        </div>
      </div>

      {/* ── Blocked banner ──────────────────────────────────────────────── */}
      {proposal.status === 'blocked' && proposal.blockedReason && (
        <div className="rounded-md bg-error-container/40 border border-error-container px-5 py-4 flex items-start gap-3">
          <Icon name="block" className="text-error text-[22px] flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-on-error-container mb-0.5">Blocked</p>
            <p className="text-sm text-on-error-container/80 leading-relaxed">{proposal.blockedReason}</p>
          </div>
        </div>
      )}

      {/* ── Two-column layout ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* ── LEFT: Details ─────────────────────────────────────────────── */}
        <div className="lg:col-span-8 flex flex-col gap-6">

          {/* Human summary */}
          <Card>
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-outline-variant">
              <Icon name="description" className="text-primary text-[20px]" />
              <h3 className="text-base font-semibold text-on-surface">Summary</h3>
            </div>
            <p className="text-sm text-on-surface-variant leading-relaxed">{proposal.description}</p>
          </Card>

          {/* Transaction group preview */}
          <Card>
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-outline-variant">
              <Icon name="receipt_long" className="text-primary text-[20px]" />
              <h3 className="text-base font-semibold text-on-surface">Transaction Group Preview</h3>
              <span className="ml-auto text-xs text-on-surface-variant font-medium">
                {proposal.txPreview.length} transaction{proposal.txPreview.length !== 1 ? 's' : ''}
              </span>
            </div>

            {proposal.txPreview.length === 0 ? (
              <p className="text-sm text-on-surface-variant italic">No transactions in preview.</p>
            ) : (
              <div className="space-y-2">
                {/* TxChip row + TransactionPreview for each line */}
                {proposal.txPreview.map((tx, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-md border border-outline-variant bg-surface-container-lowest p-3">
                    <div className="flex-shrink-0 pt-0.5">
                      <TxChip type={tx.type} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-on-surface">{tx.summary}</p>
                      <p className="font-mono text-xs text-on-surface-variant mt-0.5 leading-relaxed">{tx.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Policy checks */}
          {proposal.policyChecks.length > 0 && (
            <Card>
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-outline-variant">
                <Icon name="policy" className="text-primary text-[20px]" />
                <h3 className="text-base font-semibold text-on-surface">Policy Checks</h3>
              </div>

              <div className="flex flex-col gap-2">
                {proposal.policyChecks.map((check, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-3 rounded-md px-4 py-3 border ${
                      check.passed
                        ? 'bg-on-primary-container/20 border-on-primary-container/30'
                        : 'bg-error-container/30 border-error-container/50'
                    }`}
                  >
                    <Icon
                      name={check.passed ? 'check_circle' : 'cancel'}
                      className={`text-[20px] flex-shrink-0 ${check.passed ? 'text-primary' : 'text-error'}`}
                    />
                    <span className={`text-sm font-medium ${check.passed ? 'text-on-surface' : 'text-on-error-container'}`}>
                      {check.label}
                    </span>
                    <span className="ml-auto text-xs font-semibold font-mono">
                      {check.passed ? (
                        <span className="text-primary">PASS</span>
                      ) : (
                        <span className="text-error">FAIL</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* ── RIGHT: Action panel (sticky) ──────────────────────────────── */}
        <div className="lg:col-span-4">
          <div className="sticky top-6 flex flex-col gap-4">
            <Card>
              {/* Approval progress */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-on-surface">Approvals</span>
                  <span className="text-sm font-bold text-on-surface">
                    {proposal.approvals}
                    <span className="text-on-surface-variant font-medium"> / {proposal.threshold}</span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-surface-container-lowest overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      progressPct >= 100 ? 'bg-primary' : proposal.status === 'blocked' ? 'bg-error' : 'bg-primary'
                    }`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                {canExecute && proposal.status !== 'executed' && (
                  <p className="text-xs text-primary font-medium mt-1.5 flex items-center gap-1">
                    <Icon name="check_circle" className="text-[12px]" />
                    Threshold reached — ready to execute
                  </p>
                )}
              </div>

              {/* Asset / amount */}
              {proposal.amount != null && proposal.asset && (
                <div className="rounded-md bg-surface-container-high border border-outline-variant px-4 py-3 mb-5">
                  <div className="text-xs text-on-surface-variant mb-0.5">Transaction Amount</div>
                  <div className="text-xl font-bold text-on-surface">
                    {proposal.asset === 'EURD' || proposal.asset === 'EUR'
                      ? fmtEur(proposal.amount)
                      : `${fmtNum(proposal.amount)} ${proposal.asset}`}
                  </div>
                  <div className="text-xs text-on-surface-variant mt-0.5">Asset: {proposal.asset}</div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex flex-col gap-2">
                <Button
                  variant="primary"
                  className="w-full justify-center"
                  disabled={isTerminal || approveProposal.isPending}
                  onClick={handleApprove}
                >
                  <Icon name={proposal.status === 'blocked' ? 'admin_panel_settings' : 'thumb_up'} className="text-[16px]" />
                  {approveProposal.isPending ? 'Approving…' : approveLabel}
                </Button>

                <Button
                  variant="danger"
                  className="w-full justify-center"
                  disabled={isTerminal || rejectProposal.isPending}
                  onClick={handleReject}
                >
                  <Icon name="thumb_down" className="text-[16px]" />
                  {rejectProposal.isPending ? 'Rejecting…' : 'Reject'}
                </Button>

                {canExecute && (
                  <Button
                    variant="secondary"
                    className="w-full justify-center"
                    disabled={executeProposal.isPending}
                    onClick={handleExecute}
                  >
                    <Icon name="rocket_launch" className="text-[16px]" />
                    {executeProposal.isPending ? 'Executing…' : 'Execute On-Chain'}
                  </Button>
                )}
              </div>

              {isTerminal && (
                <p className="text-xs text-on-surface-variant text-center mt-3">
                  This proposal is {proposal.status} — no further actions available.
                </p>
              )}
            </Card>

            {/* Status info card */}
            <div className="rounded-md border border-outline-variant bg-surface-container px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <Icon name="info" className="text-on-surface-variant text-[16px]" />
                <span className="text-xs font-semibold text-on-surface uppercase tracking-wide">Status</span>
              </div>
              <div className="flex flex-wrap gap-y-2">
                <div className="w-full flex justify-between text-xs">
                  <span className="text-on-surface-variant">Proposal ID</span>
                  <span className="font-mono text-on-surface">#{proposal.id}</span>
                </div>
                <div className="w-full flex justify-between text-xs items-center">
                  <span className="text-on-surface-variant">Status</span>
                  <StatusBadge status={proposal.status} />
                </div>
                <div className="w-full flex justify-between text-xs">
                  <span className="text-on-surface-variant">Threshold</span>
                  <span className="text-on-surface">{proposal.threshold} signatures</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
