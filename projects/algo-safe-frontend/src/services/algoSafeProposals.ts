import { algo, AlgorandClient } from '@algorandfoundation/algokit-utils'
import { getAlgoSafeContractVersion, getClient, type AdminChange, type Proposal as ContractProposal } from 'algo-safe'
import algosdk, { type TransactionSigner } from 'algosdk'
import type { AssetMetadata } from '../lib/assetMetadata'
import { resolveAssetMetadata } from '../lib/assetMetadata'
import { formatUnits } from '../lib/onChainSafe'
import { ellipseAddress } from '../utils/ellipseAddress'
import type { PolicyCheck, Proposal, ProposalStatus, Safe, TxLine } from './types'

const TX_VALIDITY_WINDOW = 200
const EXECUTION_CALL_FEE = algo(0.2)

const STATUS_ACTIVE = 1n
const STATUS_READY = 2n
const STATUS_EXECUTED = 3n
const STATUS_CANCELLED = 4n

const PAYLOAD_TRANSACTION_GROUP = 1n
const METHOD_EXECUTE_PROPOSAL = 'executeProposal(uint64)void'

const TX_PAYMENT = 1n
const TX_ASSET = 2n
const TX_APP = 3n

const ADM_CREATE_GROUP = 1n
const ADM_ADD_MEMBER = 2n
const ADM_REMOVE_MEMBER = 3n
const ADM_CHANGE_THRESHOLD = 4n
const ADM_SET_POLICY = 5n
const ADM_SET_PRIVILEGES = 6n
const ADM_SET_ACTIVE = 7n

const ACT_PAY = 1n
const ACT_AXFER = 2n
const ACT_APPL = 4n
const ACT_KEYREG = 8n

const PRIV_GROUP = 1n
const PRIV_POLICY = 2n

type AlgoSafeClientInstance = InstanceType<ReturnType<typeof getClient>>
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

async function buildAppClient({ algodClient, safe, activeAddress, transactionSigner }: ProposalContext) {
  const sender = algosdk.Address.fromString(activeAddress ?? safe.address)
  const algorand = AlgorandClient.fromClients({ algod: algodClient }).setDefaultValidityWindow(TX_VALIDITY_WINDOW)

  if (activeAddress && transactionSigner) {
    algorand.setSigner(sender, transactionSigner)
  }

  const clientVersion = await getAlgoSafeContractVersion(algodClient, BigInt(safe.appId))

  return algorand.client.getTypedAppClientById(getClient(clientVersion ?? 'latest'), {
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

function formatAlgo(amount: bigint) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(Number(amount) / 1_000_000)
}

function formatAssetAmount(amount: bigint, asset: AssetMetadata) {
  return `${formatUnits(amount, asset.decimals)} ${asset.symbol}`
}

function formatAssetLabel(asset: AssetMetadata) {
  return asset.isNative ? asset.symbol : `${asset.symbol} (ASA ${asset.assetId})`
}

function humanList(values: string[]) {
  if (values.length === 0) return 'none'
  if (values.length === 1) return values[0]
  if (values.length === 2) return `${values[0]} and ${values[1]}`
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`
}

function describeAllowedActions(mask: bigint) {
  const labels: string[] = []
  if ((mask & ACT_PAY) !== 0n) labels.push('ALGO payments')
  if ((mask & ACT_AXFER) !== 0n) labels.push('ASA transfers')
  if ((mask & ACT_APPL) !== 0n) labels.push('app calls')
  if ((mask & ACT_KEYREG) !== 0n) labels.push('key registration')
  return humanList(labels)
}

function describePrivileges(mask: bigint) {
  const labels: string[] = []
  if ((mask & PRIV_GROUP) !== 0n) labels.push('group administration')
  if ((mask & PRIV_POLICY) !== 0n) labels.push('policy administration')
  return humanList(labels)
}

function describeMemberType(accountType: bigint) {
  switch (accountType) {
    case 2n:
      return 'multisig account'
    case 3n:
      return 'rekeyed account'
    case 4n:
      return 'agent account'
    case 5n:
      return 'quantum account'
    default:
      return 'standard account'
  }
}

function describeCooldown(rounds: bigint) {
  return rounds > 0n ? `${rounds.toString()} rounds` : 'no cooldown'
}

function createAssetResolver(algodClient: algosdk.Algodv2, safe: Safe) {
  const cache = new Map<number, Promise<AssetMetadata>>()

  return (assetId: number) => {
    const existing = cache.get(assetId)
    if (existing) return existing

    const pending = resolveAssetMetadata(algodClient, assetId, safe.network)
    cache.set(assetId, pending)
    return pending
  }
}

function encodeUint64(value: bigint) {
  const bytes = new Uint8Array(8)
  const view = new DataView(bytes.buffer)
  view.setBigUint64(0, value)
  return bytes
}

function concatBytes(...parts: Uint8Array[]) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0

  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }

  return result
}

function createBoxReference(appId: bigint, prefix: string, id: bigint) {
  return {
    appId,
    name: concatBytes(new TextEncoder().encode(prefix), encodeUint64(id)),
  }
}

function getExecuteBoxReferences(appId: bigint, proposalId: bigint, proposal: ContractProposal) {
  const payloadPrefix = proposal.payloadType === PAYLOAD_TRANSACTION_GROUP ? 'txg' : 'dp'

  return [
    createBoxReference(appId, 'p', proposalId),
    createBoxReference(appId, 'g', proposal.groupId),
    createBoxReference(appId, payloadPrefix, proposalId),
  ]
}

function mapStatus(status: bigint, expiryRound: bigint, currentRound: bigint): ProposalStatus {
  if ((status === STATUS_ACTIVE || status === STATUS_READY) && currentRound > expiryRound) return 'expired'
  if (status === STATUS_ACTIVE) return 'pending'
  if (status === STATUS_READY) return 'ready'
  if (status === STATUS_EXECUTED) return 'executed'
  if (status === STATUS_CANCELLED) return 'cancelled'
  return 'pending'
}

async function mapTxPreview(
  txns: TxTuple[],
  safeAddress: string,
  resolveAsset: (assetId: number) => Promise<AssetMetadata>,
): Promise<TxLine[]> {
  return Promise.all(
    txns.map(async (tx) => {
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
        const asset = await resolveAsset(Number(xferAsset))

        if (assetAmount === 0n && assetReceiver === safeAddress) {
          return {
            type: 'axfer',
            summary: `Opt in to ${formatAssetLabel(asset)}`,
            detail: `${asset.name} · Safe address ${safeAddress}`,
          }
        }

        return {
          type: 'axfer',
          summary: `Transfer ${formatAssetAmount(assetAmount, asset)} to ${ellipseAddress(assetReceiver)}`,
          detail: `${asset.name} · ${assetReceiver}${note ? ` · Note: ${note}` : ''}`,
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
    }),
  )
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

async function deriveAmount(txns: TxTuple[], resolveAsset: (assetId: number) => Promise<AssetMetadata>) {
  if (txns.length !== 1) return undefined
  const [txType, , amount, , , xferAsset, , assetAmount] = txns[0]

  if (txType === TX_PAYMENT) return { amount: Number(amount) / 1_000_000, asset: 'ALGO' }
  if (txType === TX_ASSET && assetAmount > 0n) {
    const asset = await resolveAsset(Number(xferAsset))
    return { amount: Number(formatUnits(assetAmount, asset.decimals)), asset: asset.symbol }
  }
  return undefined
}

async function deriveAdminChangePresentation(
  change: AdminChange,
  contractProposal: ContractProposal,
  resolveAsset: (assetId: number) => Promise<AssetMetadata>,
): Promise<{ title: string; description: string; txPreview: TxLine[] }> {
  const groupLabel = `group #${change.targetGroupId.toString()}`

  if (change.changeType === ADM_CREATE_GROUP) {
    const asset = await resolveAsset(Number(change.limitAssetId ?? 0n))
    const title = `Create signer group ${change.groupName || `#${contractProposal.groupId.toString()}`}`
    const description = `Create a new signer group named ${change.groupName || 'Untitled Group'} with threshold ${change.threshold.toString()}, first member ${ellipseAddress(change.memberAddr)}, ${describeAllowedActions(change.allowedActions)} enabled, and ${formatAssetLabel(asset)} policy limits of ${formatAssetAmount(change.dailyLimit, asset)} daily and ${formatAssetAmount(change.monthlyLimit, asset)} monthly.`
    return {
      title,
      description,
      txPreview: [{ type: 'appl', summary: title, detail: description }],
    }
  }

  if (change.changeType === ADM_ADD_MEMBER) {
    const title = `Add member to ${groupLabel}`
    const description = `Add ${change.memberLabel || 'member'} at ${ellipseAddress(change.memberAddr)} to ${groupLabel} as a ${describeMemberType(change.memberType)}.`
    return { title, description, txPreview: [{ type: 'appl', summary: title, detail: description }] }
  }

  if (change.changeType === ADM_REMOVE_MEMBER) {
    const title = `Remove member from ${groupLabel}`
    const description = `Remove ${ellipseAddress(change.memberAddr)} from ${groupLabel}.`
    return { title, description, txPreview: [{ type: 'appl', summary: title, detail: description }] }
  }

  if (change.changeType === ADM_CHANGE_THRESHOLD) {
    const title = `Update threshold for ${groupLabel}`
    const description = `Require ${change.threshold.toString()} approval${change.threshold === 1n ? '' : 's'} before ${groupLabel} can approve execution.`
    return { title, description, txPreview: [{ type: 'appl', summary: title, detail: description }] }
  }

  if (change.changeType === ADM_SET_POLICY) {
    const asset = await resolveAsset(Number(change.limitAssetId ?? 0n))
    const title = `Update ${formatAssetLabel(asset)} policy for ${groupLabel}`
    const description = `Set ${groupLabel} to track spending in ${formatAssetLabel(asset)}, allow ${describeAllowedActions(change.allowedActions)}, enforce a daily limit of ${formatAssetAmount(change.dailyLimit, asset)}, a monthly limit of ${formatAssetAmount(change.monthlyLimit, asset)}, and ${describeCooldown(change.cooldownRounds)}.`
    return { title, description, txPreview: [{ type: 'appl', summary: title, detail: description }] }
  }

  if (change.changeType === ADM_SET_PRIVILEGES) {
    const title = `Update admin privileges for ${groupLabel}`
    const description = `Grant ${groupLabel} ${describePrivileges(change.adminPrivileges)}.`
    return { title, description, txPreview: [{ type: 'appl', summary: title, detail: description }] }
  }

  if (change.changeType === ADM_SET_ACTIVE) {
    const title = `${change.activeFlag === 0n ? 'Disable' : 'Enable'} ${groupLabel}`
    const description = `${change.activeFlag === 0n ? 'Disable' : 'Enable'} ${groupLabel} for proposal approvals and execution.`
    return { title, description, txPreview: [{ type: 'appl', summary: title, detail: description }] }
  }

  const title = 'Admin proposal'
  const description = `Signer group ${contractProposal.groupId.toString()} proposal from ${ellipseAddress(contractProposal.proposer)}.`
  return { title, description, txPreview: [{ type: 'appl', summary: title, detail: description }] }
}

async function hydrateProposal(
  client: AlgoSafeClientInstance,
  proposalId: bigint,
  currentRound: bigint,
  safe: Safe,
  resolveAsset: (assetId: number) => Promise<AssetMetadata>,
  activeAddress?: string | null,
) {
  const contractProposal = await client.getProposal({ args: [proposalId] })
  const userHasApproved = activeAddress ? await client.hasApproved({ args: [proposalId, activeAddress] }) : false

  const txns =
    contractProposal.payloadType === PAYLOAD_TRANSACTION_GROUP
      ? await client.getTransactionGroup({ args: [proposalId] }).catch(() => [])
      : []

  const adminChange = txns.length === 0 ? await client.state.box.adminPayloads.value(proposalId).catch(() => undefined) : undefined
  const txPreview = txns.length > 0 ? await mapTxPreview(txns, safe.address, resolveAsset) : []
  const amountDetails = txns.length > 0 ? await deriveAmount(txns, resolveAsset) : undefined
  const adminPresentation = adminChange ? await deriveAdminChangePresentation(adminChange, contractProposal, resolveAsset) : undefined

  return {
    id: proposalId.toString(),
    title: adminPresentation?.title ?? deriveHeadline(txPreview, contractProposal.payloadType),
    description: adminPresentation?.description ?? deriveDescription(contractProposal, txPreview),
    status: mapStatus(contractProposal.status, contractProposal.expiryRound, currentRound),
    approvals: Number(contractProposal.approvalsCount),
    threshold: Number(contractProposal.threshold),
    amount: amountDetails?.amount,
    asset: amountDetails?.asset,
    date: `Expires at round ${contractProposal.expiryRound.toString()}`,
    txPreview: adminPresentation?.txPreview ?? txPreview,
    policyChecks: [] as PolicyCheck[],
    proposer: contractProposal.proposer,
    groupId: contractProposal.groupId.toString(),
    userHasApproved,
  } satisfies Proposal
}

export async function fetchLiveProposals(context: Omit<ProposalContext, 'transactionSigner'>) {
  const client = await buildAppClient(context)
  const config = await client.getConfig()
  const nextProposalId = config[3] ?? 1n
  const status = (await context.algodClient.status().do()) as unknown as Record<string, unknown>
  const currentRound = getCurrentRound(status)
  const resolveAsset = createAssetResolver(context.algodClient, context.safe)

  const proposalIds = Array.from({ length: Number(nextProposalId - 1n) }, (_value, index) => BigInt(index + 1)).reverse()
  const proposals = await Promise.all(
    proposalIds.map((proposalId) => hydrateProposal(client, proposalId, currentRound, context.safe, resolveAsset, context.activeAddress)),
  )
  return proposals
}

export async function fetchLiveProposal(context: Omit<ProposalContext, 'transactionSigner'>, proposalId: string) {
  const client = await buildAppClient(context)
  const status = (await context.algodClient.status().do()) as unknown as Record<string, unknown>
  const currentRound = getCurrentRound(status)
  const resolveAsset = createAssetResolver(context.algodClient, context.safe)
  return hydrateProposal(client, BigInt(proposalId), currentRound, context.safe, resolveAsset, context.activeAddress)
}

function assertWalletContext(context: ProposalContext) {
  if (!context.activeAddress || !context.transactionSigner) {
    throw new Error('Connect a wallet before signing proposal actions.')
  }
}

async function waitForTransactionConfirmation(algodClient: algosdk.Algodv2, txId: string) {
  const status = await algodClient.status().do()
  let currentRound = Number(status.lastRound ?? 0)

  for (;;) {
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
  const client = await buildAppClient(context)
  await client.send.approveProposal({ args: [BigInt(proposalId)], suppressLog: true })
  return fetchLiveProposal(context, proposalId)
}

export async function cancelLiveProposal(context: ProposalContext, proposalId: string) {
  assertWalletContext(context)
  const client = await buildAppClient(context)
  await client.send.cancelProposal({ args: [BigInt(proposalId)], suppressLog: true })
  return fetchLiveProposal(context, proposalId)
}

export async function executeLiveProposal(
  context: ProposalContext,
  proposalId: string,
  lifecycle?: ExecuteProposalLifecycle,
): Promise<ExecuteProposalResult> {
  assertWalletContext(context)
  const client = await buildAppClient(context)
  const proposalIdValue = BigInt(proposalId)
  const contractProposal = await client.getProposal({ args: [proposalIdValue] })
  const submissionParams = {
    method: METHOD_EXECUTE_PROPOSAL,
    args: [proposalIdValue],
    maxFee: EXECUTION_CALL_FEE,
    populateAppCallResources: true,
    coverAppCallInnerTransactionFees: true,
    boxReferences: getExecuteBoxReferences(BigInt(context.safe.appId), proposalIdValue, contractProposal),
    skipWaiting: true,
    suppressLog: true,
  } as Parameters<typeof client.appClient.send.call>[0] & { skipWaiting: true }

  const submission = await client.appClient.send.call(submissionParams)
  const txId = submission.txIds[0] ?? submission.transactions[0]?.txID()

  if (!txId) {
    throw new Error('Unable to determine the submitted execution transaction ID.')
  }

  lifecycle?.onSubmitted?.({ txId })

  const confirmedRound = await waitForTransactionConfirmation(context.algodClient, txId)
  lifecycle?.onConfirmed?.({ txId, confirmedRound })

  const proposal = await fetchLiveProposal(context, proposalId)
  return { proposal, txId, confirmedRound }
}
