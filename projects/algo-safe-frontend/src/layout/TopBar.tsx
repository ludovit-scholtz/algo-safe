// src/layout/TopBar.tsx
import { useState } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { Icon, Button } from '../components/ui'
import ConnectWallet from '../components/ConnectWallet'
import { shortAddr } from '../lib/format'
const NETS = ['Mainnet', 'Testnet', 'LocalNet']
export const TopBar = () => {
  const [net, setNet] = useState('Mainnet')
  const [open, setOpen] = useState(false)
  const { activeAddress } = useWallet()
  return (<header className="flex items-center justify-between border-b border-surface-border bg-white px-6 py-3">
    <div className="flex items-center gap-6"><span className="font-semibold">AlgoSafe Console</span>
      <div className="flex gap-1 text-sm">{NETS.map(n => <button key={n} onClick={() => setNet(n)} className={`rounded-md px-2 py-1 ${net === n ? 'font-semibold text-ink-900 underline underline-offset-4' : 'text-ink-500'}`}>{n}</button>)}</div></div>
    <div className="flex items-center gap-3"><Icon name="notifications" className="text-ink-500" /><Icon name="help_outline" className="text-ink-500" />
      <Button variant="secondary" onClick={() => setOpen(true)}>{activeAddress ? shortAddr(activeAddress) : 'Connect Wallet'}</Button></div>
    <ConnectWallet openModal={open} closeModal={() => setOpen(false)} />
  </header>)
}
