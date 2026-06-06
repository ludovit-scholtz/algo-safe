import { useNetwork, useWallet, WalletId, type Wallet } from '@txnlab/use-wallet-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SafeCard } from '../components/SafeCard'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { FormField, inputCls } from '../components/ui/FormField'
import { Icon } from '../components/ui/Icon'
import { useSafes } from '../hooks'

const browserWalletKeys = new Set([WalletId.PERA, WalletId.DEFLY, WalletId.WALLETCONNECT, 'walletconnect:biatec'])

const chainOptions = [
  { id: 'mainnet', label: 'Algorand MainNet', hint: 'Production network for live treasury operations.' },
  { id: 'testnet', label: 'Algorand TestNet', hint: 'Public test network for wallet pairing and dry runs.' },
  { id: 'localnet', label: 'AlgoKit LocalNet', hint: 'Local development chain with KMD-backed wallets.' },
] as const

function getWalletKeysForChain(chainId: string) {
  return chainId === 'localnet' ? new Set<string>([WalletId.KMD]) : browserWalletKeys
}

function getWalletSectionTitle(chainId: string) {
  return chainId === 'localnet' ? 'Choose a LocalNet wallet' : 'Choose an Algorand wallet'
}

export function SafeSelectionPage() {
  const { activeAddress, isReady } = useWallet()

  if (!isReady) {
    return (
      <Card className="flex min-h-[320px] items-center justify-center gap-3 text-on-surface-variant">
        <Icon name="sync" className="animate-spin text-xl" />
        <span>Checking wallet session...</span>
      </Card>
    )
  }

  if (!activeAddress) {
    return <UnauthenticatedSafeSelection />
  }

  return <AuthenticatedSafeSelection />
}

function AuthenticatedSafeSelection() {
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
          Algo Safe is a policy-driven smart account system. Secure your assets with multi-signature workflows, automated rebalancing
          agents, and granular governance protocols designed for Algorand's resilient blockchain.
        </p>

        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm text-primary">
          <Icon name="verified_user" className="text-base" />
          <span>Wallet connected. Your treasury safes are ready.</span>
        </div>

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
            <Icon name="chevron_right" className="self-center text-xl text-on-surface-variant transition-colors group-hover:text-primary" />
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
              <Button variant="ghost" onClick={() => alert('Import is not available in the demo')}>
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
            safes?.map((s) => <SafeCard key={s.safeId} safe={s} />)
          )}
          {!isLoading && (!safes || safes.length === 0) && (
            <Card className="py-8 text-center text-sm text-on-surface-variant">No safes yet — create one above.</Card>
          )}
        </div>

        {/* Active Protocol Preview */}
        <div className="relative overflow-hidden rounded-md border border-outline-variant bg-surface-container-high p-5">
          {/* Decorative glow */}
          <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary/5 blur-3xl" />

          <h4 className="mb-4 font-mono text-xs font-medium uppercase tracking-widest text-primary">Active Protocol Preview</h4>
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
          <a href="#" className="flex items-center gap-1 font-mono text-xs text-on-surface-variant transition-colors hover:text-primary">
            <Icon name="description" className="text-base" />
            Documentation
          </a>
          <a href="#" className="flex items-center gap-1 font-mono text-xs text-on-surface-variant transition-colors hover:text-primary">
            <Icon name="security" className="text-base" />
            Security Audit
          </a>
        </div>
      </div>
    </div>
  )
}

function UnauthenticatedSafeSelection() {
  const { wallets } = useWallet()
  const { activeNetwork, setActiveNetwork } = useNetwork()
  const [connectingWalletKey, setConnectingWalletKey] = useState<string | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)
  const hasKmdWallet = wallets.some((wallet) => wallet.id === WalletId.KMD)
  const availableChainOptions = chainOptions.filter((option) => option.id !== 'localnet' || hasKmdWallet || activeNetwork === 'localnet')
  const selectedChain = availableChainOptions.some((option) => option.id === activeNetwork)
    ? activeNetwork
    : (availableChainOptions[0]?.id ?? 'testnet')
  const featuredWallets = wallets
    .filter((wallet) => getWalletKeysForChain(selectedChain).has(wallet.walletKey))
    .sort((left, right) => left.metadata.name.localeCompare(right.metadata.name))

  async function handleChainChange(chainId: string) {
    setConnectError(null)
    await setActiveNetwork(chainId)
  }

  async function connectWallet(wallet: Wallet) {
    setConnectingWalletKey(wallet.walletKey)
    setConnectError(null)

    try {
      await wallet.connect()
      wallet.setActive()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Please approve the wallet request and try again.'
      setConnectError(`Unable to connect ${wallet.metadata.name}. ${message}`)
    } finally {
      setConnectingWalletKey(null)
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-12">
      <div className="flex flex-col justify-center lg:col-span-7">
        <div className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-warn/25 bg-warn/10 px-4 py-2 text-sm text-warn">
          <Icon name="lock_person" className="text-base" />
          <span>Authentication required</span>
        </div>

        <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-on-surface">
          Connect your wallet
          <br />
          <span className="text-primary">to access treasury safes.</span>
        </h1>
        <p className="mb-8 max-w-xl text-base text-on-surface-variant">
          Pick the chain you want to work on, then connect a compatible wallet to view existing safes, create new treasuries, and manage
          policy-driven operations from the authenticated console.
        </p>

        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-outline-variant bg-surface-container p-5">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Icon name="shield_lock" className="text-2xl" />
            </div>
            <h3 className="mb-2 text-lg font-semibold text-on-surface">Secure signer handoff</h3>
            <p className="text-sm text-on-surface-variant">
              Keep transaction signing inside your wallet while Algo Safe uses the connected account for authenticated actions.
            </p>
          </div>
          <div className="rounded-md border border-outline-variant bg-surface-container p-5">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Icon name="hub" className="text-2xl" />
            </div>
            <h3 className="mb-2 text-lg font-semibold text-on-surface">Supported wallets</h3>
            <p className="text-sm text-on-surface-variant">
              MainNet and TestNet use browser and WalletConnect wallets, while LocalNet exposes the KMD development wallet.
            </p>
          </div>
        </div>
        <div className="relative overflow-hidden rounded-md border border-outline-variant bg-surface-container p-5 mt-6 mr-10">
          <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary/5 blur-3xl" />
          <h4 className="mb-4 font-mono text-xs font-medium uppercase tracking-widest text-primary">Why login first</h4>
          <div className="space-y-2 text-sm text-on-surface-variant">
            <p>Authenticate before loading safes so the dashboard can bind actions to your active Algorand account.</p>
            <p>Once connected, the existing treasury overview and safe management console become available immediately.</p>
            <p>WalletConnect and Biatec use the same session relay, and LocalNet skips that flow in favor of KMD.</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-5 lg:col-span-5">
        <div className="rounded-md border border-outline-variant bg-surface-container-high p-5">
          <div className="mb-4 flex items-center gap-2">
            <div className="rounded-full bg-primary/15 p-2 text-primary">
              <Icon name="account_balance_wallet" className="text-2xl" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">Choose chain and wallet</h2>
              <p className="text-sm text-on-surface-variant">Connect to unlock your authenticated dashboard.</p>
            </div>
          </div>

          <div className="mb-5 space-y-3">
            <FormField label="Chain" hint="WalletConnect requires a valid CAIP chain, so choose the target chain before pairing.">
              <select
                className={inputCls}
                value={selectedChain}
                onChange={(event) => void handleChainChange(event.target.value)}
                disabled={!!connectingWalletKey}
              >
                {availableChainOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="rounded-md border border-outline-variant bg-surface-container px-4 py-3 text-sm text-on-surface-variant">
              {availableChainOptions.find((option) => option.id === selectedChain)?.hint}
            </div>
          </div>

          <div className="mb-4">
            <h3 className="text-base font-semibold text-on-surface">{getWalletSectionTitle(selectedChain)}</h3>
            <p className="text-sm text-on-surface-variant">
              {selectedChain === 'localnet'
                ? 'Use the LocalNet KMD wallet for local development sessions.'
                : 'Use Pera, Defly, WalletConnect, or Biatec Wallet for this Algorand chain.'}
            </p>
          </div>

          <div className="space-y-3">
            {featuredWallets.map((wallet) => {
              const isConnecting = connectingWalletKey === wallet.walletKey
              const isPera = wallet.id === WalletId.PERA
              const isDefly = wallet.id === WalletId.DEFLY
              const isKmd = wallet.id === WalletId.KMD
              const isBiatec = wallet.walletKey === 'walletconnect:biatec'
              const isWalletConnect = wallet.id === WalletId.WALLETCONNECT && !isBiatec
              const description = isKmd
                ? 'Use the local KMD wallet managed by AlgoKit LocalNet for development flows.'
                : isPera
                  ? 'Scan a QR code or approve in-app with Pera.'
                  : isDefly
                    ? 'Approve the session in Defly to continue.'
                    : isBiatec
                      ? 'Open Biatec Wallet through WalletConnect and approve the session.'
                      : 'Connect any WalletConnect-compatible Algorand wallet using the shared QR flow.'
              const actionIcon = isKmd ? 'developer_mode' : isWalletConnect || isBiatec ? 'qr_code_2' : 'login'

              return (
                <button
                  key={wallet.walletKey}
                  onClick={() => connectWallet(wallet)}
                  disabled={isConnecting}
                  className="flex w-full items-center gap-4 rounded-md border border-outline-variant bg-surface-container px-4 py-4 text-left transition hover:-translate-y-0.5 hover:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-bright">
                    <img src={wallet.metadata.icon} alt={`${wallet.metadata.name} logo`} className="h-8 w-8 object-contain" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-semibold text-on-surface">{wallet.metadata.name}</div>
                    <div className="text-sm text-on-surface-variant">{description}</div>
                  </div>
                  <div className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-wide text-primary">
                    {isConnecting ? (
                      <Icon name="sync" className="animate-spin text-base" />
                    ) : (
                      <Icon name={actionIcon} className="text-base" />
                    )}
                    <span>{isConnecting ? 'Connecting' : 'Connect'}</span>
                  </div>
                </button>
              )
            })}

            {featuredWallets.length === 0 && (
              <Card className="py-8 text-center text-sm text-on-surface-variant">
                No compatible wallet providers are available for the selected chain.
              </Card>
            )}
          </div>

          {connectError && (
            <div className="mt-4 rounded-sm border border-error/40 bg-error-container/40 px-3 py-2 text-sm text-on-error-container">
              {connectError}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
