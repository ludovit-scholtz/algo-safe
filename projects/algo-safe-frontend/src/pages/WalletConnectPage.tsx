import { useWallet } from '@txnlab/use-wallet-react'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('walletconnect')
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
          <Trans t={t} i18nKey="page.intro" components={{ code: <code /> }} />
        </p>
      </div>

      <Card>
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-on-surface-variant">{t('page.pairTitle')}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-72 flex-1">
            <FormField label={t('page.uriLabel')} hint={t('page.uriHint')}>
              <input
                className={inputCls}
                value={uri}
                onChange={(event) => setUri(event.target.value)}
                placeholder={t('page.uriPlaceholder')}
              />
            </FormField>
          </div>
          <Button disabled={pairing || !uri.trim() || !isReady} onClick={() => void handlePair()}>
            {pairing ? <Icon name="sync" className="animate-spin text-base" /> : <Icon name="link" className="text-base" />}
            {t('page.pair')}
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-error">{error}</p>}
        {!activeAddress && <p className="mt-2 text-sm text-on-surface-variant">{t('page.connectWalletFirst')}</p>}
      </Card>

      {pendingProposal && safe && (
        <Card className="border-primary/40 bg-primary/5">
          <h2 className="mb-3 font-semibold text-on-surface">{t('page.sessionProposal')}</h2>
          <p className="text-sm text-on-surface-variant">
            {t('page.wantsToConnect', { name: pendingProposal.proposer.metadata.name, url: pendingProposal.proposer.metadata.url })}
          </p>
          <div className="mt-4 flex gap-3">
            <Button onClick={() => void approveSession(pendingProposal, getCaipChainId(safe.network), safe.address)}>
              <Icon name="check" className="text-base" />
              {t('page.approve')}
            </Button>
            <Button variant="ghost" onClick={() => void rejectSession(pendingProposal.id)}>
              {t('page.reject')}
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-on-surface-variant">{t('page.activeSessions')}</h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-on-surface-variant">{t('page.noSessions')}</p>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => (
              <div key={session.topic} className="flex items-center justify-between rounded-sm border border-outline-variant p-3 text-sm">
                <div>
                  <div className="font-medium text-on-surface">{session.peer.metadata.name}</div>
                  <div className="text-xs text-on-surface-variant">{session.peer.metadata.url}</div>
                </div>
                <Button variant="ghost" onClick={() => void disconnectSession(session.topic)}>
                  {t('page.disconnect')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {safe && (
        <div className="space-y-4">
          <h2 className="font-mono text-xs uppercase tracking-wide text-on-surface-variant">{t('page.pendingRequests')}</h2>
          {pendingRequests.length === 0 && <p className="text-sm text-on-surface-variant">{t('page.noRequests')}</p>}
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
        <h2 className="mb-2 font-mono text-xs uppercase tracking-wide text-on-surface-variant">{t('page.exposedAccount')}</h2>
        <AddressDisplay address={safe?.address} textClassName="text-sm text-on-surface-variant" fallback="—" />
      </Card>
    </div>
  )
}
