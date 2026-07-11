import { useNetwork, useWallet, WalletId } from '@txnlab/use-wallet-react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { chainOptions } from '../lib/networks'
import { Icon } from './ui/Icon'

export function NetworkSwitcher() {
  const { wallets } = useWallet()
  const { activeNetwork, setActiveNetwork } = useNetwork()
  const navigate = useNavigate()
  const location = useLocation()
  const [isSwitching, setIsSwitching] = useState(false)

  const hasKmdWallet = wallets.some((wallet) => wallet.id === WalletId.KMD)
  const availableChainOptions = chainOptions.filter((option) => option.id !== 'localnet' || hasKmdWallet || activeNetwork === 'localnet')

  async function handleChange(chainId: string) {
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
    <div className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container px-2.5 py-1.5">
      {isSwitching ? (
        <Icon name="sync" className="animate-spin text-base text-on-surface-variant" />
      ) : (
        <Icon name="hub" className="text-base text-on-surface-variant" />
      )}
      <select
        className="cursor-pointer bg-transparent text-sm font-medium text-on-surface focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        value={activeNetwork}
        onChange={(event) => void handleChange(event.target.value)}
        disabled={isSwitching}
        title="Switch network without disconnecting your wallet"
      >
        {availableChainOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
