import { useWallet } from '@txnlab/use-wallet-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AddressDisplay } from './AddressDisplay'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'

export function AuthStatus() {
  const { activeAddress, activeWallet, isReady } = useWallet()
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const navigate = useNavigate()

  async function handleLogout() {
    if (!activeWallet) return

    setIsDisconnecting(true)
    try {
      await activeWallet.disconnect()
      navigate('/', { replace: true })
    } finally {
      setIsDisconnecting(false)
    }
  }

  if (!isReady) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-3 py-1.5 text-sm text-on-surface-variant">
        <Icon name="sync" className="animate-spin text-base" />
        <span>Checking wallet</span>
      </div>
    )
  }

  if (!activeAddress || !activeWallet) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-warn/30 bg-warn/10 px-3 py-1.5 text-sm text-warn">
        <Icon name="lock_person" className="text-base" />
        <span>Log in with an Algorand wallet to access your safes</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <div className="inline-flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container px-2.5 py-1.5">
        <span className="rounded-full bg-primary/15 p-1 text-primary">
          <Icon name="account_circle" className="text-lg" />
        </span>
        <div className="leading-tight">
          <AddressDisplay
            address={activeAddress}
            textClassName="text-sm font-medium text-on-surface"
            buttonClassName="h-5 w-5 border-transparent bg-transparent"
          />
          <div className="font-mono text-[11px] uppercase tracking-wide text-on-surface-variant">{activeWallet.metadata.name}</div>
        </div>
      </div>
      <Button variant="ghost" onClick={handleLogout} disabled={isDisconnecting}>
        <Icon name="logout" className="text-lg" />
        {isDisconnecting ? 'Logging out' : 'Logout'}
      </Button>
    </div>
  )
}
