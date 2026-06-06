import { useNavigate } from 'react-router-dom'
import { useSafes } from '../hooks'
import { SafeCard } from '../components/SafeCard'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Icon } from '../components/ui/Icon'

export function SafeSelectionPage() {
  const nav = useNavigate()
  const { data: safes, isLoading } = useSafes()

  return (
    <div className="grid gap-8 lg:grid-cols-12">
      {/* ── Hero / Action Column ── */}
      <div className="flex flex-col justify-center lg:col-span-7">
        <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-on-surface">
          Institutional Treasury
          <br />
          <span className="text-primary">Built for the Agent Economy.</span>
        </h1>
        <p className="mb-8 max-w-xl text-base text-on-surface-variant">
          Algo Safe is a policy-driven smart account system. Secure your assets with
          multi-signature workflows, automated rebalancing agents, and granular governance
          protocols designed for Algorand's resilient blockchain.
        </p>

        <div className="flex max-w-lg flex-col gap-4">
          {/* Create New Safe card */}
          <button
            onClick={() => nav('/initialize')}
            className="group flex cursor-pointer items-start gap-4 rounded-md border border-outline-variant bg-surface-container p-5 text-left transition-all hover:-translate-y-0.5 hover:border-primary"
          >
            <div className="rounded-lg bg-primary-container/20 p-2">
              <Icon name="add_moderator" className="text-3xl text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="mb-1 text-lg font-bold text-on-surface">Create New Safe</h3>
              <p className="text-sm text-on-surface-variant">
                Deploy a fresh institutional treasury with custom signers and automated policies.
              </p>
            </div>
            <Icon
              name="chevron_right"
              className="self-center text-xl text-on-surface-variant transition-colors group-hover:text-primary"
            />
          </button>

          {/* Import Existing Account card */}
          <div className="flex items-start gap-4 rounded-md border border-dashed border-outline-variant bg-surface-container p-5 transition-all hover:-translate-y-0.5">
            <div className="rounded-lg bg-surface-container-high p-2">
              <Icon name="account_balance" className="text-3xl text-on-surface-variant" />
            </div>
            <div className="flex-1">
              <h3 className="mb-1 text-lg font-bold text-on-surface">Import Existing Account</h3>
              <p className="mb-3 text-sm text-on-surface-variant">
                Already have a multi-sig or smart account? Sync it with the Algo Safe dashboard.
              </p>
              <Button
                variant="ghost"
                onClick={() => alert('Import is not available in the demo')}
              >
                Import Account
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Safe List + Protocol Preview Column ── */}
      <div className="flex flex-col gap-5 lg:col-span-5">
        {/* Section header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-on-surface">Existing Safes</h2>
          {safes && (
            <span className="font-mono text-xs font-medium text-primary">
              {safes.length} {safes.length === 1 ? 'ACCOUNT' : 'ACCOUNTS'}
            </span>
          )}
        </div>

        {/* Safe cards */}
        <div className="space-y-3">
          {isLoading ? (
            <>
              <div className="h-24 animate-pulse rounded-md bg-surface-container" />
              <div className="h-24 animate-pulse rounded-md bg-surface-container" />
            </>
          ) : (
            safes?.map(s => <SafeCard key={s.safeId} safe={s} />)
          )}
          {!isLoading && (!safes || safes.length === 0) && (
            <Card className="py-8 text-center text-sm text-on-surface-variant">
              No safes yet — create one above.
            </Card>
          )}
        </div>

        {/* Active Protocol Preview */}
        <div className="relative overflow-hidden rounded-md border border-outline-variant bg-surface-container-high p-5">
          {/* Decorative glow */}
          <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary/5 blur-3xl" />

          <h4 className="mb-4 font-mono text-xs font-medium uppercase tracking-widest text-primary">
            Active Protocol Preview
          </h4>
          <div className="space-y-2">
            <div className="rounded border-l-4 border-primary bg-surface-container-lowest px-3 py-2">
              <p className="font-mono text-xs text-on-surface">
                IF <span className="text-primary">TX_AMOUNT &gt; 50,000</span>
              </p>
              <p className="font-mono text-xs text-on-surface-variant">
                THEN <span className="text-primary">REQUIRE_HARDWARE_MFA</span>
              </p>
            </div>
            <div className="rounded border-l-4 border-primary bg-surface-container-lowest px-3 py-2 opacity-60">
              <p className="font-mono text-xs text-on-surface">
                IF <span className="text-primary">BLOCK_HEIGHT_DELAY</span>
              </p>
              <p className="font-mono text-xs text-on-surface-variant">
                THEN <span className="text-primary">AUTO_APPROVE_REBALANCING</span>
              </p>
            </div>
          </div>
        </div>

        {/* Footer links */}
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
            <Icon name="security" className="text-base" />
            Security Audit
          </a>
        </div>
      </div>
    </div>
  )
}
