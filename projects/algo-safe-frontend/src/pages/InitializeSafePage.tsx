import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateSafe } from '../hooks'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Stepper } from '../components/ui/Stepper'
import { FormField, inputCls } from '../components/ui/FormField'
import { Icon } from '../components/ui/Icon'

const STEPS = ['Connect Wallet', 'Contract Deployment', 'Initial Funding']

export function InitializeSafePage() {
  const nav = useNavigate()
  const createSafe = useCreateSafe()
  const [step, setStep] = useState(0)
  const [name, setName] = useState('New Treasury')
  const [threshold, setThreshold] = useState(2)
  const [signerCount, setSignerCount] = useState(3)
  const [deposit, setDeposit] = useState(100)

  async function finish() {
    const safe = await createSafe.mutateAsync({
      name,
      threshold,
      signerCount,
      initialDepositEurd: deposit,
    })
    nav(`/safe/${safe.safeId}`)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 font-mono text-xs uppercase tracking-widest text-on-surface-variant">
        <Icon name="shield" className="text-sm" />
        <span>Security Setup</span>
        <Icon name="chevron_right" className="text-sm" />
        <span className="text-primary">Initialization</span>
      </div>

      {/* Page title */}
      <div className="text-center">
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-on-surface">
          Initialize Smart Account
        </h1>
        <p className="mx-auto max-w-lg text-base text-on-surface-variant">
          Finalize your institutional treasury by deploying the smart contract on Algorand
          and funding it with its first operational balance.
        </p>
      </div>

      {/* Stepper */}
      <Stepper steps={STEPS} current={step} />

      {/* ── Step 0: Connect Wallet ── */}
      {step === 0 && (
        <Card className="space-y-6">
          {/* Step visualization cards */}
          <div className="relative grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Contract Deployment */}
            <div className="flex flex-col items-center rounded-md border border-outline-variant bg-surface-container-high p-4 text-center transition-colors hover:border-primary/50">
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-surface-bright">
                <Icon name="deployed_code" className="text-2xl text-primary" />
              </div>
              <span className="mb-1 font-mono text-xs text-primary">Step 01</span>
              <h3 className="mb-1 text-base font-semibold text-on-surface">Contract Deployment</h3>
              <p className="text-sm text-on-surface-variant">
                Instantiate the multi-sig logic on the Algorand blockchain.
              </p>
            </div>
            {/* Initial Funding */}
            <div className="flex flex-col items-center rounded-md border border-outline-variant bg-surface-container-high p-4 text-center transition-colors hover:border-primary/50">
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-surface-bright">
                <Icon name="account_balance_wallet" className="text-2xl text-primary" />
              </div>
              <span className="mb-1 font-mono text-xs text-primary">Step 02</span>
              <h3 className="mb-1 text-base font-semibold text-on-surface">Initial Funding</h3>
              <p className="text-sm text-on-surface-variant">
                Transfer EURD to the new safe address to activate features.
              </p>
            </div>
            {/* Connecting link icon — centered between the two cards */}
            <div className="absolute left-1/2 top-1/2 z-10 hidden -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-primary/40 bg-primary/20 p-1.5 backdrop-blur-sm md:flex">
              <Icon name="link" className="text-xl text-primary" />
            </div>
          </div>

          {/* Atomic group note */}
          <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-2">
            <Icon name="verified" className="animate-pulse text-sm text-primary" />
            <span className="font-mono text-xs text-primary">
              Atomic Transaction Group: Actions are executed together or not at all.
            </span>
          </div>

          {/* Wallet connection */}
          <p className="text-sm text-on-surface-variant">
            Connect the funding wallet that will deploy and own this safe.
          </p>
          <Button onClick={() => setStep(1)}>
            <Icon name="account_balance_wallet" className="text-lg" />
            Connect Wallet (demo)
          </Button>
        </Card>
      )}

      {/* ── Step 1: Contract Deployment ── */}
      {step === 1 && (
        <Card className="space-y-5">
          <div>
            <h2 className="mb-1 text-lg font-semibold text-on-surface">Contract Deployment</h2>
            <p className="text-sm text-on-surface-variant">
              Configure your safe's name and multi-signature parameters.
            </p>
          </div>

          <FormField label="Safe Name">
            <input
              className={inputCls}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Governance Treasury"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Threshold (required signers)" hint="Min signatures to approve a tx">
              <input
                type="number"
                min={1}
                className={inputCls}
                value={threshold}
                onChange={e => setThreshold(+e.target.value)}
              />
            </FormField>
            <FormField label="Total Signers" hint="Total members in the signer group">
              <input
                type="number"
                min={1}
                className={inputCls}
                value={signerCount}
                onChange={e => setSignerCount(+e.target.value)}
              />
            </FormField>
          </div>

          {/* Network / Gas info */}
          <div className="flex items-center gap-1 font-mono text-xs text-on-surface-variant">
            <Icon name="history_edu" className="text-sm" />
            <span>
              Estimated Gas: <span className="text-on-surface">~0.004 ALGO</span>
            </span>
            <span className="mx-2 text-outline-variant">·</span>
            <span className="font-semibold text-primary">Mainnet</span>
          </div>

          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button onClick={() => setStep(2)}>
              <Icon name="deployed_code" className="text-lg" />
              Deploy
            </Button>
          </div>
        </Card>
      )}

      {/* ── Step 2: Initial Funding ── */}
      {step === 2 && (
        <Card className="space-y-5">
          <div>
            <h2 className="mb-1 text-lg font-semibold text-on-surface">Initial Funding</h2>
            <p className="text-sm text-on-surface-variant">
              Transfer EURD to the new safe address to activate all features.
            </p>
          </div>

          {/* Wallet / safe address info */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-md border border-outline-variant bg-surface-container-low p-4">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-mono text-xs text-on-surface-variant">Funding Wallet</span>
                <span className="font-mono text-xs text-primary">Active</span>
              </div>
              <div className="mb-2 truncate font-mono text-sm text-on-surface">ADDR...4X9R</div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-on-surface-variant">EURD Balance</span>
                <span className="font-semibold text-on-surface">1,450.00 EURD</span>
              </div>
            </div>
            <div className="rounded-md border border-outline-variant bg-surface-container-low p-4">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-mono text-xs text-on-surface-variant">Target Safe Address</span>
                <Icon name="info" className="text-sm text-on-surface-variant" />
              </div>
              <div className="mb-2 truncate font-mono text-sm text-on-surface">SAFE...8KL2</div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-on-surface-variant">Initial Deposit</span>
                <span className="font-semibold text-primary">{deposit.toLocaleString()} EURD</span>
              </div>
            </div>
          </div>

          <FormField label="Initial Deposit (EURD)" hint="Minimum 100 EURD to activate the safe">
            <input
              type="number"
              min={0}
              className={inputCls}
              value={deposit}
              onChange={e => setDeposit(+e.target.value)}
            />
          </FormField>

          {/* Gas note */}
          <div className="flex items-center gap-1 font-mono text-xs text-on-surface-variant">
            <Icon name="history_edu" className="text-sm" />
            <span>
              Estimated Gas: <span className="text-on-surface">0.004 ALGO</span>
            </span>
            <span className="mx-2 text-outline-variant">·</span>
            <span className="font-semibold text-primary">Mainnet</span>
          </div>

          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button
              className="flex-1"
              onClick={finish}
              disabled={createSafe.isPending}
            >
              {createSafe.isPending ? (
                <>
                  <Icon name="sync" className="animate-spin text-lg" />
                  Initializing…
                </>
              ) : (
                <>
                  <Icon name="check_circle" className="text-lg" />
                  Initialize Smart Account
                </>
              )}
            </Button>
          </div>
        </Card>
      )}

      {/* Footer help links */}
      <div className="flex gap-5 pt-1">
        <a
          href="#"
          className="flex items-center gap-1 font-mono text-xs text-on-surface-variant transition-colors hover:text-primary"
        >
          <Icon name="description" className="text-base" />
          Documentation
        </a>
        <a
          href="#"
          className="flex items-center gap-1 font-mono text-xs text-on-surface-variant transition-colors hover:text-primary"
        >
          <Icon name="support_agent" className="text-base" />
          Institutional Support
        </a>
      </div>
    </div>
  )
}
