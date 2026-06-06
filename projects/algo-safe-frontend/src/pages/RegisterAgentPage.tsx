// src/pages/RegisterAgentPage.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSafeId } from '../lib/SafeContext'
import { useRegisterAgent } from '../hooks'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { FormField, inputCls } from '../components/ui/FormField'
import { Icon } from '../components/ui/Icon'
import type { AssetSymbol } from '../services/types'

const PURPOSES = [
  'Algorithmic Trading',
  'Treasury Rebalancing',
  'Yield Farming',
  'Payments',
]

const ASSETS: AssetSymbol[] = ['EURD', 'ALGO', 'USDC']

// Enhanced PolicyLogicBlock matching the reference design (icon + CONDITION/ACTION/SIGNERS rows)
function PolicyPreviewBlock({
  condition,
  action,
  signers,
}: {
  condition: string
  action: string
  signers: string
}) {
  const rows = [
    { icon: 'event_available', label: 'Condition', value: condition },
    { icon: 'bolt', label: 'Action', value: action },
    { icon: 'verified_user', label: 'Signers', value: signers },
  ]
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <div
          key={r.label}
          className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container-lowest p-3 transition-colors hover:border-primary/40 hover:bg-surface-container-low"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-primary/20 text-primary">
            <Icon name={r.icon} className="text-lg" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-mono text-xs uppercase tracking-wide text-on-surface-variant">
              {r.label}
            </p>
            <p className="mt-0.5 text-sm text-on-surface">{r.value}</p>
          </div>
          {i < rows.length - 1 && (
            <Icon name="add" className="shrink-0 text-on-surface-variant" />
          )}
        </div>
      ))}
    </div>
  )
}

export function RegisterAgentPage() {
  const safeId = useSafeId()
  const nav = useNavigate()
  const reg = useRegisterAgent()

  const [alias, setAlias] = useState('')
  const [address, setAddress] = useState('')
  const [purpose, setPurpose] = useState('')
  const [dailyLimit, setDailyLimit] = useState(1000)
  const [primaryAsset, setPrimaryAsset] = useState<AssetSymbol>('EURD')
  const [error, setError] = useState<string | null>(null)

  const valid = alias.trim() !== '' && address.trim() !== '' && purpose !== ''

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    setError(null)
    try {
      await reg.mutateAsync({
        alias: alias.trim(),
        address: address.trim(),
        purpose,
        groupTier: 'Tier 3 - Automated Execution (1/1)',
        dailyLimit,
        primaryAsset,
      })
      nav(`/safe/${safeId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register agent. Please try again.')
    }
  }

  const conditionText = `Daily cumulative volume < ${dailyLimit.toLocaleString()} ${primaryAsset}`
  const actionText = 'Auto-approve and execute Algorand Smart Contract calls'
  const signersText =
    purpose !== ''
      ? `1-of-1 (Tier 3 automated) · ${purpose}`
      : 'Governance override required for exceeding limits'

  return (
    <div className="space-y-6">
      {/* Breadcrumb + Header */}
      <div className="flex items-end justify-between">
        <div>
          <nav className="mb-2 flex items-center gap-1 font-mono text-xs text-on-surface-variant">
            <span>Treasury</span>
            <Icon name="chevron_right" className="text-sm" />
            <span>Agents</span>
            <Icon name="chevron_right" className="text-sm" />
            <span className="text-primary">Register New Agent</span>
          </nav>
          <h1 className="text-3xl font-bold text-on-surface">Register AI Agent</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Provision a secure autonomous operator for the institutional treasury.
          </p>
        </div>
        {/* Treasury balance context */}
        <div className="hidden lg:flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container px-5 py-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icon name="account_balance_wallet" className="text-xl" />
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-wide text-on-surface-variant">
              Treasury Balance
            </p>
            <p className="text-lg font-bold text-on-surface">
              1,240,500.00{' '}
              <span className="text-sm font-medium text-primary">EURD</span>
            </p>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 rounded-md border border-error-container bg-error-container/30 px-4 py-3 text-sm text-on-error-container">
          <Icon name="error" className="shrink-0 text-error" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left column — Form */}
          <div className="lg:col-span-7 space-y-6">
            {/* Agent Identity & Parameters card */}
            <Card className="p-0 overflow-hidden">
              <div className="border-b border-outline-variant bg-surface-container-high px-6 py-4">
                <h3 className="text-base font-semibold text-on-surface">
                  Agent Identity &amp; Parameters
                </h3>
              </div>
              <div className="space-y-6 px-6 py-6">
                {/* Agent Name */}
                <FormField label="Agent Name" hint="Required">
                  <input
                    className={inputCls}
                    type="text"
                    placeholder="e.g. Yield Optimizer Agent v4"
                    value={alias}
                    onChange={e => setAlias(e.target.value)}
                    required
                    aria-required="true"
                  />
                </FormField>

                {/* Agent Algorand Address */}
                <FormField label="Agent Algorand Address" hint="Must be a valid Algorand address">
                  <div className="relative">
                    <input
                      className={`${inputCls} font-mono pr-10`}
                      type="text"
                      placeholder="A7RX..."
                      value={address}
                      onChange={e => setAddress(e.target.value)}
                      required
                      aria-required="true"
                    />
                    <Icon
                      name="qr_code_scanner"
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
                    />
                  </div>
                </FormField>

                {/* Purpose */}
                <FormField label="Purpose" hint="Required">
                  <select
                    required
                    className={inputCls}
                    value={purpose}
                    onChange={e => setPurpose(e.target.value)}
                    aria-required="true"
                  >
                    <option value="" disabled>
                      Select purpose…
                    </option>
                    {PURPOSES.map(p => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </FormField>

                {/* Daily Spending Limit + Primary Asset */}
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Daily Spending Limit">
                    <input
                      type="number"
                      min={0}
                      className={inputCls}
                      value={dailyLimit}
                      onChange={e =>
                        setDailyLimit(Math.max(0, Number(e.target.value) || 0))
                      }
                    />
                  </FormField>
                  <FormField label="Primary Asset">
                    <select
                      className={inputCls}
                      value={primaryAsset}
                      onChange={e => setPrimaryAsset(e.target.value as AssetSymbol)}
                    >
                      {ASSETS.map(a => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </FormField>
                </div>
              </div>
            </Card>

            {/* Policy Preview inline (below form on mobile, shown here on all widths) */}
            <div className="lg:hidden">
              <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-on-surface-variant">
                Agent Policy Preview
              </h2>
              <PolicyPreviewBlock
                condition={conditionText}
                action={actionText}
                signers={signersText}
              />
            </div>

            {/* Action row */}
            <div className="flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => nav(`/safe/${safeId}`)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!valid || reg.isPending}
              >
                <Icon name="send" className="text-lg" />
                {reg.isPending ? 'Submitting…' : 'Register Agent Proposal'}
              </Button>
            </div>

            {/* Gas note */}
            <p className="text-center font-mono text-xs text-on-surface-variant">
              Gas fee: <span className="text-on-surface">0.001 ALGO</span>
            </p>
          </div>

          {/* Right column — Policy preview + Proposal workflow */}
          <div className="lg:col-span-5 space-y-6">
            {/* Policy Preview (desktop) */}
            <div className="hidden lg:block">
              <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-on-surface-variant">
                Agent Policy Preview
              </h2>
              <PolicyPreviewBlock
                condition={conditionText}
                action={actionText}
                signers={signersText}
              />
            </div>

            {/* Proposal Workflow card */}
            <Card>
              <div className="mb-5 flex items-center gap-3">
                <Icon name="gavel" className="text-primary" />
                <h4 className="text-base font-semibold text-on-surface">
                  Proposal Workflow
                </h4>
              </div>
              <ul className="relative space-y-5">
                {/* connector line */}
                <div className="absolute left-[15px] top-6 bottom-6 w-0.5 bg-outline-variant" />
                {[
                  {
                    n: 1,
                    title: 'Initiation',
                    desc: 'Submitting this form creates a "Register Agent" proposal on the blockchain.',
                    active: true,
                  },
                  {
                    n: 2,
                    title: 'Review Phase',
                    desc: 'Treasury signers (2/3 majority) must review and sign the transaction.',
                    active: false,
                  },
                  {
                    n: 3,
                    title: 'Activation',
                    desc: 'The agent gains operational rights once the proposal reaches finality.',
                    active: false,
                  },
                ].map(step => (
                  <li key={step.n} className="relative z-10 flex gap-3">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        step.active
                          ? 'bg-primary text-on-primary'
                          : 'border border-outline-variant bg-surface-container-high text-on-surface-variant'
                      }`}
                    >
                      {step.n}
                    </div>
                    <div>
                      <p
                        className={`text-sm font-semibold ${
                          step.active ? 'text-on-surface' : 'text-on-surface-variant'
                        }`}
                      >
                        {step.title}
                      </p>
                      <p className="mt-0.5 text-xs text-on-surface-variant">{step.desc}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>

            {/* Security note */}
            <div className="rounded-md border border-outline-variant bg-surface-container-lowest px-4 py-3">
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded border border-primary/30 bg-primary/20 px-2 py-0.5 font-mono text-xs text-primary">
                  ENCLAVE SECURE
                </span>
              </div>
              <p className="text-sm font-semibold text-on-surface">
                Secured by Algorand State Proofs
              </p>
              <p className="mt-1 text-xs text-on-surface-variant">
                x402 cryptographic headers authenticate every automated request payload with
                deterministic finality.
              </p>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
