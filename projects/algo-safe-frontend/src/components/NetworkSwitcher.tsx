import { useNetwork, useWallet, WalletId } from '@txnlab/use-wallet-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { chainOptions } from '../lib/networks'
import { Icon } from './ui/Icon'

const networkDotClass: Record<string, string> = {
  mainnet: 'bg-primary',
  voimain: 'bg-secondary',
  aramidmain: 'bg-secondary',
  testnet: 'bg-warn',
  localnet: 'bg-on-surface-variant',
}

export function NetworkSwitcher() {
  const { wallets } = useWallet()
  const { activeNetwork, setActiveNetwork } = useNetwork()
  const navigate = useNavigate()
  const location = useLocation()
  const [isSwitching, setIsSwitching] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const hasKmdWallet = wallets.some((wallet) => wallet.id === WalletId.KMD)
  const activeOption = chainOptions.find((option) => option.id === activeNetwork)

  useEffect(() => {
    if (!isOpen) return
    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  async function handleChange(chainId: string) {
    setIsOpen(false)
    if (chainId === activeNetwork) return

    setIsSwitching(true)
    try {
      // use-wallet-react swaps the algod client for the new network in place — the
      // connected wallet session (activeAddress/activeWallet) is untouched, so this
      // never triggers a logout.
      await setActiveNetwork(chainId)
      if (location.pathname.startsWith('/safe/')) {
        navigate('/', { replace: true })
      }
    } finally {
      setIsSwitching(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-3 py-1.5 text-sm font-medium text-on-surface transition-colors hover:border-outline disabled:cursor-not-allowed disabled:opacity-60"
        onClick={() => setIsOpen((open) => !open)}
        disabled={isSwitching}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {isSwitching ? (
          <Icon name="sync" className="animate-spin text-base text-on-surface-variant" />
        ) : (
          <span className={`h-2 w-2 rounded-full ${networkDotClass[activeNetwork] ?? 'bg-on-surface-variant'}`} />
        )}
        <span>{activeOption?.label ?? activeNetwork}</span>
        <Icon name="expand_more" className={`text-base text-on-surface-variant transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="absolute right-0 z-20 mt-2 w-72 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-high shadow-lg shadow-black/30"
        >
          {chainOptions.map((option) => {
            const isAvailable = option.id !== 'localnet' || hasKmdWallet || activeNetwork === 'localnet'
            const isSelected = option.id === activeNetwork

            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={!isAvailable}
                onClick={() => handleChange(option.id)}
                title={isAvailable ? undefined : 'Connect a LocalNet (KMD) wallet to switch here'}
                className={`flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  isSelected ? 'bg-primary/10' : 'hover:bg-surface-container-highest'
                }`}
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${networkDotClass[option.id] ?? 'bg-on-surface-variant'}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={`truncate text-sm font-medium ${isSelected ? 'text-primary' : 'text-on-surface'}`}>
                      {option.label}
                    </span>
                    {!isAvailable && <Icon name="lock" className="text-sm text-on-surface-variant" />}
                  </span>
                  <span className="mt-0.5 block text-xs text-on-surface-variant">{option.hint}</span>
                </span>
                {isSelected && <Icon name="check" className="mt-0.5 shrink-0 text-base text-primary" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
