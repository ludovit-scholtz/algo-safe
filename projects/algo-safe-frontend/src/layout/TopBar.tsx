// src/layout/TopBar.tsx
import { useState } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { Icon } from '../components/ui'
import ConnectWallet from '../components/ConnectWallet'
import { shortAddr } from '../lib/format'

const NETS = ['Mainnet', 'Testnet', 'LocalNet']

export const TopBar = () => {
  const [net, setNet] = useState('Mainnet')
  const [open, setOpen] = useState(false)
  const { activeAddress } = useWallet()

  return (
    <header className="flex items-center justify-between border-b border-surface-border bg-white px-6 h-16 sticky top-0 z-40">
      {/* Left: brand + network selector */}
      <div className="flex items-center gap-6">
        <span className="text-base font-bold text-ink-900">AlgoSafe Console</span>
        <div className="h-5 w-px bg-surface-border" />
        <nav className="flex items-center gap-1 text-sm">
          {NETS.map(n => (
            <button
              key={n}
              onClick={() => setNet(n)}
              className={`px-2 py-1 rounded transition-colors ${
                net === n
                  ? 'font-bold text-ink-900 border-b-2 border-ink-900 pb-0'
                  : 'text-ink-500 hover:text-ink-700'
              }`}
            >
              {n}
            </button>
          ))}
        </nav>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1">
        <button className="p-2 rounded-full text-ink-500 hover:text-ink-900 hover:bg-surface-muted transition-colors">
          <Icon name="notifications" className="text-[20px]" />
        </button>
        <button className="p-2 rounded-full text-ink-500 hover:text-ink-900 hover:bg-surface-muted transition-colors">
          <Icon name="help_outline" className="text-[20px]" />
        </button>

        {/* Divider */}
        <div className="h-5 w-px bg-surface-border mx-2" />

        <button
          onClick={() => setOpen(true)}
          className="text-sm font-semibold text-ink-900 border border-surface-border bg-white hover:bg-surface-muted px-3 py-1.5 rounded-lg transition-colors"
        >
          {activeAddress ? shortAddr(activeAddress) : 'Connect Wallet'}
        </button>
      </div>

      <ConnectWallet openModal={open} closeModal={() => setOpen(false)} />
    </header>
  )
}
