// src/pages/DashboardPage.tsx
import { useNavigate, Link } from 'react-router-dom'
import { useSafe, useEurdBalance, useProposals } from '../hooks'
import { useServices } from '../services'
import { StatCard, StatusBadge, DemoDataChip, Skeleton, Button, Icon } from '../components/ui'
import { fmtEur, fmtNum, shortAddr } from '../lib/format'
import type { Proposal } from '../services/types'

export const DashboardPage = () => {
  const navigate = useNavigate()
  const { data: safe, isLoading: safeLoading } = useSafe()
  const { data: eurdBal, isLoading: eurdLoading } = useEurdBalance()
  const { data: proposals, isLoading: propsLoading } = useProposals()
  const { quantozLive } = useServices()

  const ALGO_SEED = 185240.5

  return (
    <div className="flex flex-col gap-8 max-w-[1440px] mx-auto">

      {/* Page Header & Treasury Meta */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-3xl font-bold text-ink-900 tracking-tight mb-1">Treasury Overview</h2>
          <div className="flex flex-wrap items-center gap-4 text-sm text-ink-500">
            <span className="flex items-center gap-1 text-ink-700 font-medium">
              <Icon name="domain" className="text-[16px]" />
              {safeLoading ? <Skeleton className="h-4 w-32" /> : (safe?.name ?? 'Alpha Fund Multisig')}
            </span>
            <span className="flex items-center gap-1">
              <Icon name="tag" className="text-[16px]" />
              App ID:{' '}
              <span className="font-mono text-ink-900">
                {safeLoading ? <Skeleton className="inline-block h-4 w-20" /> : (safe?.appId ?? '—')}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <Icon name="account_balance_wallet" className="text-[16px]" />
              Address:{' '}
              <span className="font-mono text-ink-900">
                {safeLoading ? <Skeleton className="inline-block h-4 w-20" /> : shortAddr(safe?.address ?? '')}
              </span>
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => navigate('/agents/register')}
          >
            <Icon name="smart_toy" className="text-[18px]" />
            Register Agent
          </Button>
          <Button
            variant="primary"
            onClick={() => navigate('/fund')}
          >
            <Icon name="account_balance" className="text-[18px]" />
            Fund with EURD
          </Button>
        </div>
      </div>

      {/* Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* EURD Balance Card */}
        <div className="rounded-xl border border-surface-border bg-white p-6 flex flex-col justify-between">
          <div className="flex justify-between items-start mb-6">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center">
                <Icon name="euro" className="text-[20px]" />
              </div>
              <span className="text-xs font-semibold uppercase tracking-widest text-ink-500">EURD Balance</span>
            </div>
            <div className="flex items-center gap-2">
              {!quantozLive && <DemoDataChip />}
              <span className="bg-surface-muted text-ink-500 px-2 py-1 rounded text-xs font-medium">
                Asset ID: {safe?.appId ?? '12345'}
              </span>
            </div>
          </div>
          <div>
            {eurdLoading ? (
              <Skeleton className="h-12 w-48" />
            ) : (
              <div className="text-5xl font-bold text-ink-900 tracking-tight">
                {eurdBal != null ? fmtEur(eurdBal.amount) : '€—'}
              </div>
            )}
            <div className="text-sm text-ink-500 mt-2 flex items-center gap-1">
              <Icon name="trending_up" className="text-[16px] text-ok" />
              +5.2% from last month
            </div>
          </div>
        </div>

        {/* ALGO Balance Card */}
        <div className="rounded-xl border border-surface-border bg-white p-6 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute right-0 top-0 w-32 h-32 bg-surface-muted rounded-bl-full opacity-60 -z-0" />
          <div className="flex justify-between items-start mb-6 relative z-10">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-surface-muted text-ink-700 flex items-center justify-center border border-surface-border">
                <Icon name="currency_exchange" className="text-[20px]" />
              </div>
              <span className="text-xs font-semibold uppercase tracking-widest text-ink-500">ALGO Balance</span>
            </div>
            <span className="bg-surface-muted text-ink-500 px-2 py-1 rounded text-xs font-medium">Native</span>
          </div>
          <div className="relative z-10">
            <div className="text-5xl font-bold text-ink-900 tracking-tight">
              {fmtNum(Math.floor(ALGO_SEED))}
              <span className="text-xl font-semibold text-ink-400">.50</span>
            </div>
            <div className="text-sm text-ink-500 mt-2">≈ €32,417.08 (Oracle Rate)</div>
          </div>
        </div>
      </div>

      {/* Recent Proposals */}
      <div className="rounded-xl border border-surface-border bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-border flex justify-between items-center bg-surface-muted">
          <h3 className="text-base font-semibold text-ink-900">Recent Transaction Proposals</h3>
          <Link
            to="/proposals"
            className="text-sm font-semibold text-brand-600 hover:text-brand-700 transition-colors flex items-center gap-1"
          >
            View All
            <Icon name="arrow_forward" className="text-[18px]" />
          </Link>
        </div>

        <div className="overflow-x-auto">
          {propsLoading ? (
            <div className="p-6 flex flex-col gap-3">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-muted border-b border-surface-border text-xs uppercase tracking-widest text-ink-500">
                  <th className="py-3 px-6 font-semibold w-24">ID</th>
                  <th className="py-3 px-6 font-semibold">Description</th>
                  <th className="py-3 px-6 font-semibold w-44">Status</th>
                  <th className="py-3 px-6 font-semibold text-right">Amount</th>
                  <th className="py-3 px-6 font-semibold text-right w-48">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border text-sm">
                {(proposals ?? []).map((p: Proposal) => (
                  <tr
                    key={p.id}
                    onClick={() => navigate(`/proposals/${p.id}`)}
                    className="hover:bg-surface-muted transition-colors group cursor-pointer"
                  >
                    <td className="py-4 px-6 font-mono text-ink-400 text-xs">#{p.id}</td>
                    <td className="py-4 px-6 text-ink-900 font-medium group-hover:text-brand-600 transition-colors">
                      {p.title}
                    </td>
                    <td className="py-4 px-6">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="py-4 px-6 text-right font-mono text-sm text-ink-900">
                      {p.amount != null && (p.asset === 'EURD' || p.asset === 'EUR')
                        ? fmtEur(p.amount)
                        : p.amount != null && p.asset
                        ? `${fmtNum(p.amount)} ${p.asset}`
                        : '—'}
                    </td>
                    <td className="py-4 px-6 text-right text-ink-400">{p.date}</td>
                  </tr>
                ))}
                {(proposals ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-sm text-ink-500">
                      No proposals yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
