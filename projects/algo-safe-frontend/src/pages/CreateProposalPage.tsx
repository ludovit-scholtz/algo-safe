import { algo, AlgorandClient } from '@algorandfoundation/algokit-utils'
import { useWallet } from '@txnlab/use-wallet-react'
import { AlgoSafeClient } from 'algo-safe'
import algosdk from 'algosdk'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { FormField, inputCls } from '../components/ui/FormField'
import { Icon } from '../components/ui/Icon'
import { useSafe } from '../hooks'
import { useOnChainSafeHoldings } from '../hooks/useOnChainSafeHoldings'
import { useSafeId } from '../lib/SafeContext'
import { formatUnits, getZeroAddress } from '../lib/onChainSafe'

const TX_VALIDITY_WINDOW = 200
const PROPOSAL_CALL_FEE = algo(0.2)

type ProposalKind = 'payment' | 'asset-transfer'

type CreatedProposal = {
  proposalId: string
  txId: string
}

function parseBaseUnits(value: string, decimals: number) {
  const trimmed = value.trim()
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) return null

  const [wholePart, fractionPart = ''] = trimmed.split('.')
  if (fractionPart.length > decimals) return null

  const normalized = `${wholePart}${fractionPart.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '')
  return BigInt(normalized || '0')
}

function getCurrentRound(status: Record<string, unknown>) {
  const candidate = status.lastRound ?? status['last-round']
  if (typeof candidate === 'number') return BigInt(candidate)
  if (typeof candidate === 'bigint') return candidate
  if (typeof candidate === 'string' && candidate.trim()) return BigInt(candidate)
  return 0n
}

export function CreateProposalPage() {
  const safeId = useSafeId()
  const { data: safe } = useSafe(safeId)
  const { data: holdings } = useOnChainSafeHoldings(safeId)
  const { activeAddress, algodClient, transactionSigner, isReady } = useWallet()
  const [proposalKind, setProposalKind] = useState<ProposalKind>('payment')
  const [groupId, setGroupId] = useState('1')
  const [expiryRounds, setExpiryRounds] = useState('2000')
  const [receiver, setReceiver] = useState('')
  const [amount, setAmount] = useState('')
  const [assetId, setAssetId] = useState('')
  const [note, setNote] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [createdProposal, setCreatedProposal] = useState<CreatedProposal | null>(null)

  const assetOptions = useMemo(() => (holdings ?? []).filter((holding) => !holding.isNative), [holdings])
  const selectedAsset = assetOptions.find((holding) => String(holding.assetId) === assetId)

  async function handleSaveProposal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    setCreatedProposal(null)

    if (!safe) {
      setErrorMessage('The selected safe could not be loaded.')
      return
    }

    if (!isReady || !activeAddress || !transactionSigner) {
      setErrorMessage('Connect a wallet before creating a proposal.')
      return
    }

    if (!algosdk.isValidAddress(receiver.trim())) {
      setErrorMessage('Enter a valid Algorand receiver address.')
      return
    }

    const parsedGroupId = BigInt(groupId)
    const parsedExpiryRounds = Number(expiryRounds)
    if (parsedGroupId <= 0n || !Number.isInteger(parsedExpiryRounds) || parsedExpiryRounds <= 0) {
      setErrorMessage('Group ID and expiry rounds must both be positive values.')
      return
    }

    try {
      setIsSubmitting(true)

      const senderAddress = algosdk.Address.fromString(activeAddress)
      const algorand = AlgorandClient.fromClients({ algod: algodClient }).setDefaultValidityWindow(TX_VALIDITY_WINDOW)
      algorand.setSigner(senderAddress, transactionSigner)

      const appClient = algorand.client.getTypedAppClientById(AlgoSafeClient, {
        appId: BigInt(safe.appId),
        defaultSender: senderAddress,
      })

      const status = (await algodClient.status().do()) as unknown as Record<string, unknown>
      const proposalExpiryRound = getCurrentRound(status) + BigInt(parsedExpiryRounds)

      if (proposalKind === 'payment') {
        const rawAmount = parseBaseUnits(amount, 6)
        if (rawAmount === null || rawAmount <= 0n) {
          throw new Error('Enter a valid ALGO amount for the payment proposal.')
        }

        const result = await appClient.send.proposePayment({
          args: {
            groupId: parsedGroupId,
            payload: {
              receiver: receiver.trim(),
              amount: rawAmount,
              hasClose: 0n,
              closeRemainderTo: getZeroAddress(),
              note: note.trim(),
            },
            expiryRound: proposalExpiryRound,
          },
          staticFee: PROPOSAL_CALL_FEE,
          suppressLog: true,
        })

        setCreatedProposal({
          proposalId: result.return?.toString() ?? '',
          txId: result.txIds[0] ?? '',
        })
      } else {
        if (!selectedAsset?.assetId) {
          throw new Error('Select an opted-in asset for the asset transfer proposal.')
        }

        const rawAmount = parseBaseUnits(amount, selectedAsset.decimals)
        if (rawAmount === null || rawAmount <= 0n) {
          throw new Error('Enter a valid asset amount for the transfer proposal.')
        }

        const result = await appClient.send.proposeAssetTransfer({
          args: {
            groupId: parsedGroupId,
            payload: {
              xferAsset: BigInt(selectedAsset.assetId),
              assetReceiver: receiver.trim(),
              assetAmount: rawAmount,
              hasClose: 0n,
              assetCloseTo: getZeroAddress(),
              note: note.trim(),
            },
            expiryRound: proposalExpiryRound,
          },
          staticFee: PROPOSAL_CALL_FEE,
          suppressLog: true,
        })

        setCreatedProposal({
          proposalId: result.return?.toString() ?? '',
          txId: result.txIds[0] ?? '',
        })
      }
    } catch (error) {
      setErrorMessage(error instanceof Error && error.message.trim() ? error.message : 'Failed to save the proposal on-chain.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-on-surface">Create Proposal</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Build a payment or ASA transfer proposal and write it directly to the selected Algo Safe contract.
          </p>
        </div>
        <Link to={`/safe/${safeId}/proposals`}>
          <Button variant="secondary">
            <Icon name="arrow_back" className="text-base" />
            Back to Proposals
          </Button>
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <Card>
          <form className="space-y-5" onSubmit={(event) => void handleSaveProposal(event)}>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Proposal Type" hint="Choose the transaction type the safe should execute once approved.">
                <select className={inputCls} value={proposalKind} onChange={(event) => setProposalKind(event.target.value as ProposalKind)}>
                  <option value="payment">ALGO payment</option>
                  <option value="asset-transfer">ASA transfer</option>
                </select>
              </FormField>
              <FormField
                label="Signer Group ID"
                hint="Bootstrap creates group 1 by default; change this only if your safe uses another signer group."
              >
                <input
                  className={inputCls}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={groupId}
                  onChange={(event) => setGroupId(event.target.value.replace(/[^0-9]/g, ''))}
                />
              </FormField>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Receiver" hint="The address that will receive the ALGO payment or ASA transfer.">
                <input
                  className={inputCls}
                  value={receiver}
                  onChange={(event) => setReceiver(event.target.value)}
                  placeholder="Algorand address"
                />
              </FormField>
              <FormField
                label={proposalKind === 'payment' ? 'Amount (ALGO)' : 'Amount'}
                hint={
                  proposalKind === 'payment'
                    ? 'The amount is converted to microAlgos before submission.'
                    : selectedAsset
                      ? `Uses ${selectedAsset.symbol} with ${selectedAsset.decimals} decimals.`
                      : 'Select an opted-in asset first.'
                }
              >
                <input
                  className={inputCls}
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                />
              </FormField>
            </div>

            {proposalKind === 'asset-transfer' && (
              <FormField label="Opted-in Asset" hint="Only assets already opted in by the safe are available here.">
                <select className={inputCls} value={assetId} onChange={(event) => setAssetId(event.target.value)}>
                  <option value="">Select asset</option>
                  {assetOptions.map((holding) => (
                    <option key={holding.key} value={holding.assetId}>
                      {holding.symbol} · {holding.assetId} · Available {holding.balanceDisplay}
                    </option>
                  ))}
                </select>
              </FormField>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Expiry (Rounds)" hint="Added to the current chain round to compute the proposal expiry round.">
                <input
                  className={inputCls}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={expiryRounds}
                  onChange={(event) => setExpiryRounds(event.target.value.replace(/[^0-9]/g, ''))}
                />
              </FormField>
              <FormField label="Note" hint="Optional note stored with the proposal payload.">
                <input className={inputCls} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional note" />
              </FormField>
            </div>

            {errorMessage && (
              <div className="rounded-sm border border-error/40 bg-error-container/40 px-3 py-2 text-sm text-on-error-container">
                {errorMessage}
              </div>
            )}
            {createdProposal && (
              <div className="rounded-sm border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-on-surface">
                Proposal #{createdProposal.proposalId || 'unknown'} was saved on-chain. Tx ID: {createdProposal.txId || 'pending'}
              </div>
            )}

            <div className="flex items-center justify-end gap-3">
              <Link to={`/safe/${safeId}/proposals`}>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </Link>
              <Button type="submit" disabled={isSubmitting || !safe}>
                {isSubmitting ? <Icon name="sync" className="animate-spin text-base" /> : <Icon name="save" className="text-base" />}
                {isSubmitting ? 'Saving Proposal...' : 'Save Proposal'}
              </Button>
            </div>
          </form>
        </Card>

        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-on-surface-variant">Selected Safe</h2>
            <div className="space-y-2 text-sm text-on-surface-variant">
              <p className="font-semibold text-on-surface">{safe?.name ?? 'Loading safe...'}</p>
              <p className="font-mono break-all">{safe?.address ?? '—'}</p>
              <p>App ID {safe?.appId ?? '—'}</p>
            </div>
          </Card>
          <Card>
            <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-on-surface-variant">Available Balances</h2>
            <div className="space-y-2 text-sm text-on-surface-variant">
              <p>
                Native ALGO:{' '}
                <span className="font-mono text-on-surface">{holdings?.find((holding) => holding.isNative)?.balanceDisplay ?? '—'}</span>
              </p>
              {selectedAsset && (
                <p>
                  Selected ASA balance:{' '}
                  <span className="font-mono text-on-surface">{formatUnits(selectedAsset.rawAmount, selectedAsset.decimals)}</span>
                </p>
              )}
              {!selectedAsset && proposalKind === 'asset-transfer' && <p>Select an asset to see its available balance.</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
