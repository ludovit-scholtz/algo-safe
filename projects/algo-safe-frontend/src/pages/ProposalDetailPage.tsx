// src/pages/ProposalDetailPage.tsx
import { useParams, useNavigate } from 'react-router-dom'
import { useSnackbar } from 'notistack'
import { useProposal, useApproveProposal, useRejectProposal, useExecuteProposal } from '../hooks'
import { Button, Card, Icon, Skeleton, StatusBadge } from '../components/ui'
import { fmtEur, fmtNum } from '../lib/format'

// Chip for transaction type: pay/axfer/appl/keyreg
const TX_TYPE_STYLES: Record<string, string> = {
  pay:    'bg-blue-50 text-blue-700 border-blue-100',
  axfer:  'bg-brand-50 text-brand-600 border-brand-100',
  appl:   'bg-amber-50 text-warn border-amber-100',
  keyreg: 'bg-surface-muted text-ink-500 border-surface-border',
}
const TxChip = ({ type }: { type: string }) => (
  <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide border ${TX_TYPE_STYLES[type] ?? TX_TYPE_STYLES.keyreg}`}>
    {type}
  </span>
)

export const ProposalDetailPage = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { enqueueSnackbar } = useSnackbar()

  const { data: proposal, isLoading } = useProposal(id)
  const approveProposal = useApproveProposal()
  const rejectProposal = useRejectProposal()
  const executeProposal = useExecuteProposal()

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
          <div className="w-14 h-14 rounded-full bg-surface-muted flex items-center justify-center mb-4">
            <Icon name="search_off" className="text-ink-400 text-[28px]" />
          </div>
          <h3 className="text-lg font-semibold text-ink-900 mb-1">Proposal not found</h3>
          <p className="text-sm text-ink-500 mb-6">
            No proposal with ID <span className="font-mono text-ink-700">#{id}</span> exists.
          </p>
          <Button variant="secondary" onClick={() => navigate('/')}>
            <Icon name="arrow_back" className="text-[16px]" />
            Back to Dashboard
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
          <div className="flex items-center gap-2 mb-1 text-sm text-ink-400">
            <button
              onClick={() => navigate('/')}
              className="hover:text-brand-600 transition-colors flex items-center gap-1 font-medium"
            >
              <Icon name="arrow_back" className="text-[14px]" />
              Dashboard
            </button>
            <Icon name="chevron_right" className="text-[14px]" />
            <span className="font-mono">#{proposal.id}</span>
          </div>
          <div className="flex items-center flex-wrap gap-3">
            <h2 className="text-3xl font-bold text-ink-900 tracking-tight">{proposal.title}</h2>
            <StatusBadge status={proposal.status} />
          </div>
          <p className="text-sm text-ink-400 mt-1">{proposal.date}</p>
        </div>
      </div>

      {/* ── Blocked banner ──────────────────────────────────────────────── */}
      {proposal.status === 'blocked' && proposal.blockedReason && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-5 py-4 flex items-start gap-3">
          <Icon name="block" className="text-danger text-[22px] flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-danger mb-0.5">Blocked</p>
            <p className="text-sm text-red-700 leading-relaxed">{proposal.blockedReason}</p>
          </div>
        </div>
      )}

      {/* ── Two-column layout ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* ── LEFT: Details ─────────────────────────────────────────────── */}
        <div className="lg:col-span-8 flex flex-col gap-6">

          {/* Human summary */}
          <Card>
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-surface-border">
              <Icon name="description" className="text-brand-600 text-[20px]" />
              <h3 className="text-base font-semibold text-ink-900">Summary</h3>
            </div>
            <p className="text-sm text-ink-700 leading-relaxed">{proposal.description}</p>
          </Card>

          {/* Transaction group preview */}
          <Card>
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-surface-border">
              <Icon name="receipt_long" className="text-brand-600 text-[20px]" />
              <h3 className="text-base font-semibold text-ink-900">Transaction Group Preview</h3>
              <span className="ml-auto text-xs text-ink-400 font-medium">{proposal.txPreview.length} transaction{proposal.txPreview.length !== 1 ? 's' : ''}</span>
            </div>

            {proposal.txPreview.length === 0 ? (
              <p className="text-sm text-ink-400 italic">No transactions in preview.</p>
            ) : (
              <div className="flex flex-col divide-y divide-surface-border">
                {proposal.txPreview.map((tx, i) => (
                  <div key={i} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="flex-shrink-0 pt-0.5">
                      <TxChip type={tx.type} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink-900">{tx.summary}</p>
                      <p className="text-xs text-ink-500 mt-0.5 font-mono leading-relaxed">{tx.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Policy checks */}
          {proposal.policyChecks.length > 0 && (
            <Card>
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-surface-border">
                <Icon name="policy" className="text-brand-600 text-[20px]" />
                <h3 className="text-base font-semibold text-ink-900">Policy Checks</h3>
              </div>

              <div className="flex flex-col gap-2">
                {proposal.policyChecks.map((check, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-3 rounded-lg px-4 py-3 border ${
                      check.passed
                        ? 'bg-green-50 border-green-100'
                        : 'bg-red-50 border-red-200'
                    }`}
                  >
                    <Icon
                      name={check.passed ? 'check_circle' : 'cancel'}
                      className={`text-[20px] flex-shrink-0 ${check.passed ? 'text-ok' : 'text-danger'}`}
                    />
                    <span className={`text-sm font-medium ${check.passed ? 'text-green-800' : 'text-danger'}`}>
                      {check.label}
                    </span>
                    <span className="ml-auto text-xs font-semibold">
                      {check.passed ? (
                        <span className="text-ok">PASS</span>
                      ) : (
                        <span className="text-danger">FAIL</span>
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
                  <span className="text-sm font-semibold text-ink-900">Approvals</span>
                  <span className="text-sm font-bold text-ink-900">
                    {proposal.approvals}
                    <span className="text-ink-400 font-medium"> / {proposal.threshold}</span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-surface-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      progressPct >= 100 ? 'bg-ok' : proposal.status === 'blocked' ? 'bg-danger' : 'bg-brand-600'
                    }`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                {canExecute && proposal.status !== 'executed' && (
                  <p className="text-xs text-ok font-medium mt-1.5 flex items-center gap-1">
                    <Icon name="check_circle" className="text-[12px]" />
                    Threshold reached — ready to execute
                  </p>
                )}
              </div>

              {/* Asset / amount */}
              {proposal.amount != null && proposal.asset && (
                <div className="rounded-lg bg-surface-muted border border-surface-border px-4 py-3 mb-5">
                  <div className="text-xs text-ink-500 mb-0.5">Transaction Amount</div>
                  <div className="text-xl font-bold text-ink-900">
                    {proposal.asset === 'EURD' || proposal.asset === 'EUR'
                      ? fmtEur(proposal.amount)
                      : `${fmtNum(proposal.amount)} ${proposal.asset}`}
                  </div>
                  <div className="text-xs text-ink-400 mt-0.5">Asset: {proposal.asset}</div>
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
                    className="w-full justify-center border-ok text-ok hover:bg-green-50"
                    disabled={executeProposal.isPending}
                    onClick={handleExecute}
                  >
                    <Icon name="rocket_launch" className="text-[16px]" />
                    {executeProposal.isPending ? 'Executing…' : 'Execute On-Chain'}
                  </Button>
                )}
              </div>

              {isTerminal && (
                <p className="text-xs text-ink-400 text-center mt-3">
                  This proposal is {proposal.status} — no further actions available.
                </p>
              )}
            </Card>

            {/* Status info card */}
            <div className="rounded-xl border border-surface-border bg-white px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <Icon name="info" className="text-ink-400 text-[16px]" />
                <span className="text-xs font-semibold text-ink-700 uppercase tracking-wide">Status</span>
              </div>
              <div className="flex flex-wrap gap-y-2">
                <div className="w-full flex justify-between text-xs">
                  <span className="text-ink-500">Proposal ID</span>
                  <span className="font-mono text-ink-700">#{proposal.id}</span>
                </div>
                <div className="w-full flex justify-between text-xs">
                  <span className="text-ink-500">Status</span>
                  <StatusBadge status={proposal.status} />
                </div>
                <div className="w-full flex justify-between text-xs">
                  <span className="text-ink-500">Threshold</span>
                  <span className="text-ink-700">{proposal.threshold} signatures</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
