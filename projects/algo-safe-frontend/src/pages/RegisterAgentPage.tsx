// src/pages/RegisterAgentPage.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSnackbar } from 'notistack'
import { useRegisterAgent } from '../hooks'
import { Button, Icon, FormField, inputCls } from '../components/ui'

const PURPOSE_OPTIONS = [
  { value: 'treasury', label: 'Treasury Rebalancing' },
  { value: 'payments', label: 'Automated Payroll' },
  { value: 'trading', label: 'Algorithmic Trading' },
  { value: 'custom', label: 'Custom Smart Contract Execution' },
]

const GROUP_OPTIONS = [
  { value: 'Tier 3 - Automated Execution (1/1)', label: 'Tier 3 - Automated Execution (1/1 threshold)' },
  { value: 'Tier 2 - Operational Reserves (2/3)', label: 'Tier 2 - Operational Reserves (2/3 threshold)' },
]

export const RegisterAgentPage = () => {
  const navigate = useNavigate()
  const { enqueueSnackbar } = useSnackbar()
  const registerAgent = useRegisterAgent()

  const [address, setAddress] = useState('')
  const [alias, setAlias] = useState('')
  const [purpose, setPurpose] = useState('')
  const [signerGroupOption, setSignerGroupOption] = useState<'existing' | 'new'>('existing')
  const [groupTier, setGroupTier] = useState(GROUP_OPTIONS[0].value)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    registerAgent.mutate(
      {
        alias,
        address,
        purpose,
        groupTier,
        dailyLimit: 5000,
        primaryAsset: 'EURD',
      },
      {
        onSuccess: () => {
          enqueueSnackbar('Agent registered', { variant: 'success' })
          navigate('/agents')
        },
        onError: () => {
          enqueueSnackbar('Failed to register agent', { variant: 'error' })
        },
      }
    )
  }

  return (
    <div className="max-w-[1440px] mx-auto">
      {/* Page Header */}
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-ink-900 tracking-tight mb-1">Register AI Agent</h2>
        <p className="text-sm text-ink-500 max-w-2xl">
          Provision a new automated agent entity within your institutional safe. Define operational boundaries,
          cryptographic identity, and signing thresholds.
        </p>
      </div>

      {/* Main Two-Column Grid */}
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* LEFT COLUMN — Registration Form */}
          <div className="lg:col-span-8 flex flex-col gap-6">

            {/* Section 1: Cryptographic Identity */}
            <section className="rounded-xl border border-surface-border bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-5 pb-3 border-b border-surface-border">
                <Icon name="fingerprint" className="text-brand-600 text-[22px]" />
                <h3 className="text-base font-semibold text-ink-900">Cryptographic Identity</h3>
              </div>

              <div className="flex flex-col gap-5">
                {/* Agent Address */}
                <FormField
                  label="Algorand Public Address *"
                  hint="The 58-character public key generated for this specific automated process."
                >
                  <div className="relative mt-1">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-ink-400">
                      <Icon name="link" className="text-[18px]" />
                    </span>
                    <input
                      type="text"
                      className={`${inputCls} pl-9 font-mono`}
                      placeholder="e.g., V4XYZ...5TGA"
                      value={address}
                      onChange={e => setAddress(e.target.value)}
                      required
                    />
                  </div>
                </FormField>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Agent Alias */}
                  <FormField label="Agent Alias / Label *">
                    <input
                      type="text"
                      className={`${inputCls} mt-1`}
                      placeholder="e.g., Arbitrage Bot Alpha"
                      value={alias}
                      onChange={e => setAlias(e.target.value)}
                      required
                    />
                  </FormField>

                  {/* Operational Purpose */}
                  <FormField label="Operational Purpose *">
                    <select
                      className={`${inputCls} mt-1 appearance-none`}
                      value={purpose}
                      onChange={e => setPurpose(e.target.value)}
                      required
                    >
                      <option value="" disabled>Select execution scope...</option>
                      {PURPOSE_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </FormField>
                </div>
              </div>
            </section>

            {/* Section 2: Authorization Policy */}
            <section className="rounded-xl border border-surface-border bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-5 pb-3 border-b border-surface-border">
                <Icon name="policy" className="text-brand-600 text-[22px]" />
                <h3 className="text-base font-semibold text-ink-900">Authorization Policy</h3>
              </div>

              <p className="text-sm text-ink-500 mb-4">
                Assign this agent to a signer group to dictate its transaction capabilities and threshold requirements.
              </p>

              {/* Radio Selector */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
                {/* Option: Attach to Existing Group */}
                <label
                  className={`relative flex cursor-pointer rounded-lg border p-4 transition-colors ${
                    signerGroupOption === 'existing'
                      ? 'border-brand-500 bg-brand-50'
                      : 'border-surface-border bg-white hover:bg-surface-muted'
                  }`}
                >
                  <input
                    type="radio"
                    name="signerGroupOption"
                    value="existing"
                    checked={signerGroupOption === 'existing'}
                    onChange={() => setSignerGroupOption('existing')}
                    className="sr-only"
                  />
                  <div className="flex w-full items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Icon
                        name="group"
                        className={`text-[22px] ${signerGroupOption === 'existing' ? 'text-brand-600' : 'text-ink-400'}`}
                      />
                      <div>
                        <p className="text-sm font-semibold text-ink-900">Attach to Existing Group</p>
                        <p className="text-xs text-ink-500 mt-0.5">Inherit established multi-sig policies.</p>
                      </div>
                    </div>
                    <div
                      className={`h-5 w-5 rounded-full border-2 flex-shrink-0 transition-all ${
                        signerGroupOption === 'existing'
                          ? 'border-brand-600 bg-brand-600 ring-2 ring-brand-200'
                          : 'border-ink-300'
                      }`}
                    />
                  </div>
                </label>

                {/* Option: Create Isolated Sub-Group */}
                <label
                  className={`relative flex cursor-pointer rounded-lg border p-4 transition-colors ${
                    signerGroupOption === 'new'
                      ? 'border-brand-500 bg-brand-50'
                      : 'border-surface-border bg-white hover:bg-surface-muted'
                  }`}
                >
                  <input
                    type="radio"
                    name="signerGroupOption"
                    value="new"
                    checked={signerGroupOption === 'new'}
                    onChange={() => setSignerGroupOption('new')}
                    className="sr-only"
                  />
                  <div className="flex w-full items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Icon
                        name="group_add"
                        className={`text-[22px] ${signerGroupOption === 'new' ? 'text-brand-600' : 'text-ink-400'}`}
                      />
                      <div>
                        <p className="text-sm font-semibold text-ink-900">Create Isolated Sub-Group</p>
                        <p className="text-xs text-ink-500 mt-0.5">Define custom limits for this agent.</p>
                      </div>
                    </div>
                    <div
                      className={`h-5 w-5 rounded-full border-2 flex-shrink-0 transition-all ${
                        signerGroupOption === 'new'
                          ? 'border-brand-600 bg-brand-600 ring-2 ring-brand-200'
                          : 'border-ink-300'
                      }`}
                    />
                  </div>
                </label>
              </div>

              {/* Target Group Select (shown when "existing" is chosen) */}
              {signerGroupOption === 'existing' && (
                <div className="p-4 bg-surface-muted rounded-lg border border-surface-border">
                  <label className="block text-xs font-semibold text-ink-700 mb-2">Select Target Group</label>
                  <select
                    className={`${inputCls} bg-white`}
                    value={groupTier}
                    onChange={e => setGroupTier(e.target.value)}
                  >
                    {GROUP_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <div className="mt-3 flex items-center gap-2 bg-brand-50 px-2 py-1.5 rounded border border-brand-100 w-max">
                    <Icon name="info" className="text-[16px] text-brand-600" />
                    <span className="font-mono text-xs text-brand-700">Policy applied: Max 5,000 EURD / 24h</span>
                  </div>
                </div>
              )}
            </section>

            {/* Action Bar */}
            <div className="flex items-center justify-end gap-3 pt-1">
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate('/agents')}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={registerAgent.isPending}
              >
                <Icon name="check_circle" className="text-[18px]" />
                {registerAgent.isPending ? 'Initializing…' : 'Initialize Agent Contract'}
              </Button>
            </div>
          </div>

          {/* RIGHT COLUMN — Context Info Panels */}
          <div className="lg:col-span-4 flex flex-col gap-6">

            {/* Architecture Context */}
            <div className="rounded-xl border border-surface-border bg-white p-5 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-brand-600" />
              <h3 className="text-base font-semibold text-ink-900 mb-4">Architecture Context</h3>
              <div className="flex flex-col gap-3">
                {/* Standard Account — greyed out */}
                <div className="flex gap-3 p-3 rounded-lg border border-surface-border opacity-60 grayscale">
                  <div className="w-10 h-10 rounded-full bg-surface-muted flex items-center justify-center flex-shrink-0">
                    <Icon name="person" className="text-ink-500 text-[20px]" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-ink-900">Standard Account</h4>
                    <p className="text-xs text-ink-500 mt-0.5 leading-tight">
                      Human-operated. Requires interactive cryptographic signing via mobile or hardware wallet.
                    </p>
                  </div>
                </div>

                {/* Agent Account — highlighted */}
                <div className="flex gap-3 p-3 rounded-lg border border-brand-500 bg-surface-muted relative">
                  <div className="absolute -right-1.5 -top-1.5 w-3.5 h-3.5 rounded-full bg-ok border-2 border-white" />
                  <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                    <Icon name="memory" className="text-brand-600 text-[20px]" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-ink-900">Agent Account</h4>
                    <p className="text-xs text-ink-500 mt-0.5 leading-tight">
                      Autonomous process. Signs programmatically based strictly on Smart Contract logic and pre-defined boundaries.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* x402 Protocol Compliance */}
            <div className="rounded-xl border border-surface-border bg-white overflow-hidden flex flex-col">
              {/* Decorative header gradient */}
              <div
                className="h-28 w-full border-b border-surface-border relative flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)' }}
              >
                <Icon name="hub" className="text-[72px] text-brand-200 opacity-40" />
              </div>

              <div className="p-5 flex-1">
                <div className="flex items-center gap-1.5 mb-2">
                  <Icon name="lock_clock" className="text-brand-600 text-[20px]" />
                  <h3 className="text-base font-semibold text-ink-900">x402 Protocol Compliance</h3>
                </div>
                <p className="text-xs text-ink-500 mb-4 leading-relaxed">
                  AlgoSafe utilizes the x402 standard to ensure machine-to-machine transactions maintain
                  institutional security guarantees.
                </p>
                <ul className="space-y-2">
                  {[
                    'Cryptographic headers authenticate every automated request payload.',
                    'Deterministic finality ensures agents cannot execute partial or non-atomic flows.',
                    'Native EURD compatibility for compliant cross-border treasury movements.',
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Icon name="check_circle" className="text-ok text-[16px] mt-0.5 flex-shrink-0" />
                      <span className="text-xs text-ink-500 leading-tight">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-surface-muted px-5 py-2.5 border-t border-surface-border text-center">
                <a
                  href="#"
                  className="text-xs font-semibold text-brand-600 hover:underline flex items-center justify-center gap-1"
                >
                  Read Technical Documentation
                  <Icon name="open_in_new" className="text-[14px]" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
