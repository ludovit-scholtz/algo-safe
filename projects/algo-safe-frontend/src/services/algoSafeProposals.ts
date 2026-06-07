import { algo, AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoSafeClient, type Proposal as ContractProposal } from 'algo-safe'
import algosdk, { type TransactionSigner } from 'algosdk'
import type { PolicyCheck, Proposal, ProposalStatus, Safe, TxLine } from './types'

const TX_VALIDITY_WINDOW = 200
const EXECUTION_CALL_FEE = algo(0.2)

const STATUS_ACTIVE = 1n
const STATUS_READY = 2n
const STATUS_EXECUTED = 3n
const STATUS_CANCELLED = 4n

const PAYLOAD_TRANSACTION_GROUP = 1n

const TX_PAYMENT = 1n
const TX_ASSET = 2n
const TX_APP = 3n
const TX_KEYREG = 4n

type AlgoSafeClientInstance = InstanceType<typeof AlgoSafeClient>
type TxTuple = Awaited<ReturnType<AlgoSafeClientInstance['getTransactionGroup']>>[number]

type ProposalContext = {
  algodClient: algosdk.Algodv2
  safe: Safe
  activeAddress?: string | null
  transactionSigner?: TransactionSigner
}

export type ExecuteProposalLifecycle = {
  onSubmitted?: (payload: { txId: string }) => void
  onConfirmed?: (payload: { txId: string; confirmedRound: number }) => void
}

export type ExecuteProposalResult = {
  proposal: Proposal
  txId: string
  confirmedRound: number
}

function buildAppClient({ algodClient, safe, activeAddress, transactionSigner }: ProposalContext) {
  const sender = algosdk.Address.fromString(activeAddress ?? safe.address)
  const algorand = AlgorandClient.fromClients({ algod: algodClient }).setDefaultValidityWindow(TX_VALIDITY_WINDOW)

  if (activeAddress && transactionSigner) {
    algorand.setSigner(sender, transactionSigner)
  }

  return algorand.client.getTypedAppClientById(AlgoSafeClient, {
    appId: BigInt(safe.appId),
    defaultSender: sender,
  })
}

function getCurrentRound(status: Record<string, unknown>) {
  const candidate = status.lastRound ?? status['last-round']
  if (typeof candidate === 'number') return BigInt(candidate)
  if (typeof candidate === 'bigint') return candidate
  if (typeof candidate === 'string' && candidate.trim()) return BigInt(candidate)
  return 0n
}

function ellipseAddress(address: string) {
  if (address.length <= 16) return address
  return `${address.slice(0, 6)}...${address.slice(-6)}`
}

function formatAlgo(amount: bigint) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(Number(amount) / 1_000_000)
}

function formatRawAmount(amount: bigint) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(amount))
}

function mapStatus(status: bigint, expiryRound: bigint, currentRound: bigint): ProposalStatus {
  if ((status === STATUS_ACTIVE || status === STATUS_READY) && currentRound > expiryRound) return 'expired'
  if (status === STATUS_ACTIVE) return 'pending'
  if (status === STATUS_READY) return 'ready'
  if (status === STATUS_EXECUTED) return 'executed'
  if (status === STATUS_CANCELLED) return 'cancelled'
  return 'pending'
}

function mapTxPreview(txns: TxTuple[], safeAddress: string): TxLine[] {
  return txns.map((tx) => {
    const [
      txType,
      receiver,
      amount,
      _hasClose,
      _closeRemainderTo,
      xferAsset,
      assetReceiver,
      assetAmount,
      _hasAssetClose,
      _assetCloseTo,
      appId,
      numArgs,
      _arg0,
      _arg1,
      _arg2,
      _arg3,
      online,
      _voteKey,
      _selectionKey,
      _stateProofKey,
      voteFirst,
      voteLast,
      _voteKeyDilution,
      note,
    ] = tx

    if (txType === TX_PAYMENT) {
      return {
        type: 'pay',
        summary: `Send ${formatAlgo(amount)} ALGO to ${ellipseAddress(receiver)}`,
        detail: note ? `${receiver} · Note: ${note}` : receiver,
      }
    }

    if (txType === TX_ASSET) {
      if (assetAmount === 0n && assetReceiver === safeAddress) {
        return {
          type: 'axfer',
          summary: `Opt in to ASA ${xferAsset.toString()}`,
          detail: `Safe address ${safeAddress}`,
        }
      }

      return {
        type: 'axfer',
        summary: `Transfer ${formatRawAmount(assetAmount)} units of ASA ${xferAsset.toString()}`,
        detail: `${assetReceiver} · ${note || 'No note'}`,
      }
    }

    if (txType === TX_APP) {
      return {
        type: 'appl',
        summary: `Call app ${appId.toString()}`,
        detail: `${numArgs.toString()} argument(s)`,
      }
    }

    return {
      type: 'keyreg',
      summary: online === 0n ? 'Take account offline' : 'Register participation keys',
      detail: `Rounds ${voteFirst.toString()}-${voteLast.toString()}`,
    }
  })
}

function deriveHeadline(txPreview: TxLine[], payloadType: bigint) {
  if (txPreview.length > 0) return txPreview[0].summary
  if (payloadType === PAYLOAD_TRANSACTION_GROUP) return 'Transaction group proposal'
  return 'Admin proposal'
}

function deriveDescription(contractProposal: ContractProposal, txPreview: TxLine[]) {
  const actionSummary = txPreview.length === 1 ? txPreview[0].detail : `${txPreview.length} transactions queued for execution.`
  return `Signer group ${contractProposal.groupId.toString()} proposal from ${ellipseAddress(contractProposal.proposer)}. ${actionSummary}`
}

function deriveAmount(txns: TxTuple[]) {
  if (txns.length !== 1) return undefined
  const [txType, , amount, , , xferAsset, , assetAmount] = txns[0]

  if (txType === TX_PAYMENT) return { amount: Number(amount) / 1_000_000, asset: 'ALGO' }
  if (txType === TX_ASSET && assetAmount > 0n) return { amount: Number(assetAmount), asset: `ASA ${xferAsset.toString()}` }
  return undefined
}

async function hydrateProposal(client: AlgoSafeClientInstance, proposalId: bigint, currentRound: bigint, safe: Safe, activeAddress?: string | null) {
  const contractProposal = await client.getProposal({ args: [proposalId] })
  const userHasApproved = activeAddress ? await client.hasApproved({ args: [proposalId, activeAddress] }) : false

  const txns = contractProposal.payloadType === PAYLOAD_TRANSACTION_GROUP
    ? await client.getTransactionGroup({ args: [proposalId] }).catch(() => [])
    : []

  const txPreview = mapTxPreview(txns, safe.address)
  const amountDetails = deriveAmount(txns)

  return {
    id: proposalId.toString(),
    title: deriveHeadline(txPreview, contractProposal.payloadType),
    description: deriveDescription(contractProposal, txPreview),
    status: mapStatus(contractProposal.status, contractProposal.expiryRound, currentRound),
    approvals: Number(contractProposal.approvalsCount),
    threshold: Number(contractProposal.threshold),
    amount: amountDetails?.amount,
    asset: amountDetails?.asset,
    date: `Expires at round ${contractProposal.expiryRound.toString()}`,
    txPreview,
    policyChecks: [] as PolicyCheck[],
    proposer: contractProposal.proposer,
    groupId: contractProposal.groupId.toString(),
    userHasApproved,
  } satisfies Proposal
}

export async function fetchLiveProposals(context: Omit<ProposalContext, 'transactionSigner'>) {
  const client = buildAppClient(context)
  const config = await client.getConfig()
  const nextProposalId = config[3] ?? 1n
  const status = (await context.algodClient.status().do()) as unknown as Record<string, unknown>
  const currentRound = getCurrentRound(status)

  const proposalIds = Array.from({ length: Number(nextProposalId - 1n) }, (_value, index) => BigInt(index + 1)).reverse()
  const proposals = await Promise.all(proposalIds.map((proposalId) => hydrateProposal(client, proposalId, currentRound, context.safe, context.activeAddress)))
  return proposals
}

export async function fetchLiveProposal(context: Omit<ProposalContext, 'transactionSigner'>, proposalId: string) {
  const client = buildAppClient(context)
  const status = (await context.algodClient.status().do()) as unknown as Record<string, unknown>
  const currentRound = getCurrentRound(status)
  return hydrateProposal(client, BigInt(proposalId), currentRound, context.safe, context.activeAddress)
}

function assertWalletContext(context: ProposalContext) {
  if (!context.activeAddress || !context.transactionSigner) {
    throw new Error('Connect a wallet before signing proposal actions.')
  }
}

async function waitForTransactionConfirmation(algodClient: algosdk.Algodv2, txId: string) {
  const status = await algodClient.status().do()
  let currentRound = Number(status.lastRound ?? 0)

  while (true) {
    const pending = await algodClient.pendingTransactionInformation(txId).do()
    const confirmedRound = Number(pending.confirmedRound ?? 0)
    const poolError = String(pending.poolError ?? '')

    if (confirmedRound > 0) {
      return confirmedRound
    }

    if (poolError) {
      throw new Error(poolError)
    }

    currentRound += 1
    await algodClient.statusAfterBlock(currentRound).do()
  }
}

export async function approveLiveProposal(context: ProposalContext, proposalId: string) {
  assertWalletContext(context)
  const client = buildAppClient(context)
  await client.send.approveProposal({ args: [BigInt(proposalId)], suppressLog: true })
  return fetchLiveProposal(context, proposalId)
}

export async function cancelLiveProposal(context: ProposalContext, proposalId: string) {
  assertWalletContext(context)
  const client = buildAppClient(context)
  await client.send.cancelProposal({ args: [BigInt(proposalId)], suppressLog: true })
  return fetchLiveProposal(context, proposalId)
}

export async function executeLiveProposal(context: ProposalContext, proposalId: string, lifecycle?: ExecuteProposalLifecycle): Promise<ExecuteProposalResult> {
  assertWalletContext(context)
  const client = buildAppClient(context)
  const transactionGroup = await client.createTransaction.executeProposal({ args: [BigInt(proposalId)], staticFee: EXECUTION_CALL_FEE })
  const transaction = transactionGroup.transactions[0]
  const txId = transaction.txID()
  const signedTransactions = await context.transactionSigner!(transactionGroup.transactions, [0])

  await context.algodClient.sendRawTransaction(signedTransactions).do()
  lifecycle?.onSubmitted?.({ txId })

  const confirmedRound = await waitForTransactionConfirmation(context.algodClient, txId)
  lifecycle?.onConfirmed?.({ txId, confirmedRound })

  const proposal = await fetchLiveProposal(context, proposalId)
  return { proposal, txId, confirmedRound }
}