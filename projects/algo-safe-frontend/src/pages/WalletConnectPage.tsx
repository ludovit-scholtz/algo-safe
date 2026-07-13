import { useWallet } from '@txnlab/use-wallet-react'
import { useState } from 'react'
import { AddressDisplay } from '../components/AddressDisplay'
import { WalletConnectRequestPanel } from '../components/WalletConnectRequestPanel'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { FormField, inputCls } from '../components/ui/FormField'
import { Icon } from '../components/ui/Icon'
import { useWalletKit } from '../hooks/useWalletKit'
import { useSafe } from '../hooks'
import { getCaipChainId } from '../lib/networks'
import { useSafeId } from '../lib/SafeContext'

export function WalletConnectPage() {
  const safeId = useSafeId()
  const { data: safe } = useSafe(safeId)
  const { algodClient, activeAddress, transactionSigner } = useWallet()
  const {
    sessions,
    pendingProposal,
    pendingRequests,
    isReady,
    error,
    pair,
    approveSession,
    rejectSession,
    disconnectSession,
    respondToRequest,
    rejectRequest,
  } = useWalletKit()
  const [uri, setUri] = useState('')
  const [pairing, setPairing] = useState(false)

  async function handlePair() {
    if (!uri.trim()) return
    setPairing(true)
    try {
      await pair(uri.trim())
      setUri('')
    } finally {
      setPairing(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-on-surface">WalletConnect</h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          Pair this Safe with a dapp as if it were a wallet. Incoming requests are converted into Safe proposals — see{' '}
          <code>docs/WALLETCONNECT_WALLET_SETUP.md</code> for setup and limitations.
        </p>
      </div>

      <Card>
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-on-surface-variant">Pair a dapp</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-72 flex-1">
            <FormField label="WalletConnect URI" hint="Paste the wc: URI shown by the connecting dapp.">
              <input className={inputCls} value={uri} onChange={(event) => setUri(event.target.value)} placeholder="wc:..." />
            </FormField>
          </div>
          <Button disabled={pairing || !uri.trim() || !isReady} onClick={() => void handlePair()}>
            {pairing ? <Icon name="sync" className="animate-spin text-base" /> : <Icon name="link" className="text-base" />}
            Pair
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-error">{error}</p>}
        {!activeAddress && (
          <p className="mt-2 text-sm text-on-surface-variant">
            Connect a wallet first — it will sign proposals raised from incoming requests.
          </p>
        )}
      </Card>

      {pendingProposal && safe && (
        <Card className="border-primary/40 bg-primary/5">
          <h2 className="mb-3 font-semibold text-on-surface">Session proposal</h2>
          <p className="text-sm text-on-surface-variant">
            {pendingProposal.proposer.metadata.name} ({pendingProposal.proposer.metadata.url}) wants to connect to this Safe.
          </p>
          <div className="mt-4 flex gap-3">
            <Button onClick={() => void approveSession(pendingProposal, getCaipChainId(safe.network), safe.address)}>
              <Icon name="check" className="text-base" />
              Approve
            </Button>
            <Button variant="ghost" onClick={() => void rejectSession(pendingProposal.id)}>
              Reject
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-on-surface-variant">Active sessions</h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No dapps are paired yet.</p>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => (
              <div key={session.topic} className="flex items-center justify-between rounded-sm border border-outline-variant p-3 text-sm">
                <div>
                  <div className="font-medium text-on-surface">{session.peer.metadata.name}</div>
                  <div className="text-xs text-on-surface-variant">{session.peer.metadata.url}</div>
                </div>
                <Button variant="ghost" onClick={() => void disconnectSession(session.topic)}>
                  Disconnect
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {safe && (
        <div className="space-y-4">
          <h2 className="font-mono text-xs uppercase tracking-wide text-on-surface-variant">Pending requests</h2>
          {pendingRequests.length === 0 && <p className="text-sm text-on-surface-variant">No incoming requests.</p>}
          {pendingRequests.map((request) => (
            <WalletConnectRequestPanel
              key={`${request.topic}-${request.id}`}
              request={request}
              safe={safe}
              algodClient={algodClient}
              activeAddress={activeAddress}
              transactionSigner={transactionSigner}
              onReject={rejectRequest}
              onRespond={respondToRequest}
            />
          ))}
        </div>
      )}

      <Card>
        <h2 className="mb-2 font-mono text-xs uppercase tracking-wide text-on-surface-variant">Safe account exposed to dapps</h2>
        <AddressDisplay address={safe?.address} textClassName="text-sm text-on-surface-variant" fallback="—" />
      </Card>
    </div>
  )
}
