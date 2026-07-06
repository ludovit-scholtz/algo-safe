import { algo, AlgorandClient } from '@algorandfoundation/algokit-utils'
import {
  ACT_APPL,
  ACT_AXFER,
  ACT_KEYREG,
  ACT_PAY,
  ADM_ADD_MEMBER,
  ADM_CHANGE_THRESHOLD,
  ADM_CREATE_GROUP,
  ADM_REMOVE_MEMBER,
  ADM_SET_ACTIVE,
  ADM_SET_POLICY,
  ADM_SET_PRIVILEGES,
  LATEST_CONTRACT_HASH,
  PRIV_GROUP,
  PRIV_POLICY,
  TX_ACFG,
  TX_APP,
  TX_ASSET,
  TX_KEYREG,
  TX_PAYMENT,
  decodeAppTxn,
  decodeAssetConfigTxn,
  decodeAssetTxn,
  decodeKeyRegTxn,
  decodePaymentTxn,
  getAlgoSafeContractVersion,
  getClient,
  type AdminChange,
  type Proposal as ContractProposal,
} from 'algo-safe'
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
const METHOD_EXECUTE_PROPOSAL_LATEST = 'executeProposal(uint64,uint64)void'
// Generous headroom for on-chain execution's inner-transaction staging; EXECUTION_CALL_FEE
// already budgets enough ALGO to cover the opup inner calls this requests.
const EXECUTION_ENSURE_BUDGET = 20000n

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
  const isLatest = !clientVersion || clientVersion === LATEST_CONTRACT_HASH

  return {
    client: algorand.client.getTypedAppClientById(getClient(clientVersion ?? 'latest'), {
      appId: BigInt(safe.appId),
      defaultSender: sender,
    }),
    isLatest,
  }
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

// The latest contract stores every queued transaction as a tagged `(txType, data)`
// envelope, where `data` is the ARC4-encoded per-type payload. Older deployed
// contracts return a flat 24-field tuple instead — see `LegacyTxTuple`.
type EnvelopeTxTuple = [bigint, Uint8Array]
type LegacyTxTuple = [
  bigint, // txType
  string, // receiver
  bigint, // amount
  bigint, // hasClose
  string, // closeRemainderTo
  bigint, // xferAsset
  string, // assetReceiver
  bigint, // assetAmount
  bigint, // hasAssetClose
  string, // assetCloseTo
  bigint, // appId
  bigint, // numArgs
  Uint8Array, // arg0
  Uint8Array, // arg1
  Uint8Array, // arg2
  Uint8Array, // arg3
  bigint, // online
  Uint8Array, // voteKey
  Uint8Array, // selectionKey
  Uint8Array, // stateProofKey
  bigint, // voteFirst
  bigint, // voteLast
  bigint, // voteKeyDilution
  string, // note
]

async function mapEnvelopeTxLine(
  [txType, data]: EnvelopeTxTuple,
  safeAddress: string,
  resolveAsset: (assetId: number) => Promise<AssetMetadata>,
): Promise<TxLine> {
  if (txType === TX_PAYMENT) {
    const { receiver, amount, note } = decodePaymentTxn(data)
    return {
      type: 'pay',
      summary: `Send ${formatAlgo(amount)} ALGO to ${ellipseAddress(receiver)}`,
      detail: note ? `${receiver} · Note: ${note}` : receiver,
    }
  }

  if (txType === TX_ASSET) {
    const { xferAsset, assetReceiver, assetAmount, note } = decodeAssetTxn(data)
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
    const { appId, appArgs, note } = decodeAppTxn(data)
    return {
      type: 'appl',
      summary: `Call app ${appId.toString()}`,
      detail: `${appArgs.length} argument(s)${note ? ` · Note: ${note}` : ''}`,
    }
  }

  if (txType === TX_ACFG) {
    const { configAsset, assetName, unitName, note } = decodeAssetConfigTxn(data)
    const label = assetName || unitName || (configAsset === 0n ? 'new asset' : `asset ${configAsset.toString()}`)
    return {
      type: 'acfg',
      summary: configAsset === 0n ? `Create asset ${label}` : `Reconfigure asset ${configAsset.toString()}`,
      detail: note ? `${label} · Note: ${note}` : label,
    }
  }

  if (txType === TX_KEYREG) {
    const { online, voteFirst, voteLast } = decodeKeyRegTxn(data)
    return {
      type: 'keyreg',
      summary: online === 0n ? 'Take account offline' : 'Register participation keys',
      detail: `Rounds ${voteFirst.toString()}-${voteLast.toString()}`,
    }
  }

  return { type: 'appl', summary: `Transaction type ${txType.toString()}`, detail: 'Unrecognized transaction type' }
}

async function mapLegacyTxLine(
  tx: LegacyTxTuple,
  safeAddress: string,
  resolveAsset: (assetId: number) => Promise<AssetMetadata>,
): Promise<TxLine> {
  const [
    txType,
    receiver,
    amount,
    ,
    ,
    xferAsset,
    assetReceiver,
    assetAmount,
    ,
    ,
    appId,
    numArgs,
    ,
    ,
    ,
    ,
    online,
    ,
    ,
    ,
    voteFirst,
    voteLast,
    ,
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
}

async function mapTxPreview(
  txns: TxTuple[],
  isLatest: boolean,
  safeAddress: string,
  resolveAsset: (assetId: number) => Promise<AssetMetadata>,
): Promise<TxLine[]> {
  return Promise.all(
    txns.map((tx) =>
      isLatest
        ? mapEnvelopeTxLine(tx as unknown as EnvelopeTxTuple, safeAddress, resolveAsset)
        : mapLegacyTxLine(tx as unknown as LegacyTxTuple, safeAddress, resolveAsset),
    ),
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

async function deriveAmount(txns: TxTuple[], isLatest: boolean, resolveAsset: (assetId: number) => Promise<AssetMetadata>) {
  if (txns.length !== 1) return undefined

  if (isLatest) {
    const [txType, data] = txns[0] as unknown as EnvelopeTxTuple
    if (txType === TX_PAYMENT) {
      const { amount } = decodePaymentTxn(data)
      return { amount: Number(amount) / 1_000_000, asset: 'ALGO' }
    }
    if (txType === TX_ASSET) {
      const { xferAsset, assetAmount } = decodeAssetTxn(data)
      if (assetAmount > 0n) {
        const asset = await resolveAsset(Number(xferAsset))
        return { amount: Number(formatUnits(assetAmount, asset.decimals)), asset: asset.symbol }
      }
    }
    return undefined
  }

  const [txType, , amount, , , xferAsset, , assetAmount] = txns[0] as unknown as LegacyTxTuple

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
  isLatest: boolean,
  proposalId: bigint,
  currentRound: bigint,
  safe: Safe,
  resolveAsset: (assetId: number) => Promise<AssetMetadata>,
  activeAddress?: string | null,
) {
  // The client type unions every historical contract version; only the latest
  // one accepts `ensureBudgetValue`, so these calls need a narrow `as any` cast
  // rather than fighting the union (same pattern as getTransactionGroup below).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contractProposal = (await (client as any).getProposal({
    args: isLatest ? [proposalId, 0n] : [proposalId],
  })) as ContractProposal
  const userHasApproved = activeAddress
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any).hasApproved({ args: isLatest ? [proposalId, activeAddress, 0n] : [proposalId, activeAddress] })
    : false

  // Latest contract (1a77ba21+) requires payloadIndex (and ensureBudgetValue) as extra args; older contracts only take proposalId.
  const txns =
    contractProposal.payloadType === PAYLOAD_TRANSACTION_GROUP
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (client as any).getTransactionGroup({ args: isLatest ? [proposalId, 0n, 0n] : [proposalId] }).catch(() => [])
      : []

  const adminChange = txns.length === 0 ? await client.state.box.adminPayloads.value(proposalId).catch(() => undefined) : undefined
  const txPreview = txns.length > 0 ? await mapTxPreview(txns, isLatest, safe.address, resolveAsset) : []
  const amountDetails = txns.length > 0 ? await deriveAmount(txns, isLatest, resolveAsset) : undefined
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
  const { client, isLatest } = await buildAppClient(context)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config = await (client as any).getConfig({ args: isLatest ? { ensureBudgetValue: 0n } : {} })
  const nextProposalId = config[3] ?? 1n
  const status = (await context.algodClient.status().do()) as unknown as Record<string, unknown>
  const currentRound = getCurrentRound(status)
  const resolveAsset = createAssetResolver(context.algodClient, context.safe)

  const proposalIds = Array.from({ length: Number(nextProposalId - 1n) }, (_value, index) => BigInt(index + 1)).reverse()
  const proposals = await Promise.all(
    proposalIds.map((proposalId) =>
      hydrateProposal(client, isLatest, proposalId, currentRound, context.safe, resolveAsset, context.activeAddress),
    ),
  )
  return proposals
}

export async function fetchLiveProposal(context: Omit<ProposalContext, 'transactionSigner'>, proposalId: string) {
  const { client, isLatest } = await buildAppClient(context)
  const status = (await context.algodClient.status().do()) as unknown as Record<string, unknown>
  const currentRound = getCurrentRound(status)
  const resolveAsset = createAssetResolver(context.algodClient, context.safe)
  return hydrateProposal(client, isLatest, BigInt(proposalId), currentRound, context.safe, resolveAsset, context.activeAddress)
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
  const { client, isLatest } = await buildAppClient(context)
  const args = isLatest ? [BigInt(proposalId), 0n] : [BigInt(proposalId)]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client.send as any).approveProposal({ args, suppressLog: true })
  return fetchLiveProposal(context, proposalId)
}

export async function cancelLiveProposal(context: ProposalContext, proposalId: string) {
  assertWalletContext(context)
  const { client, isLatest } = await buildAppClient(context)
  const args = isLatest ? [BigInt(proposalId), 0n] : [BigInt(proposalId)]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (client.send as any).cancelProposal({ args, suppressLog: true })
  return fetchLiveProposal(context, proposalId)
}

export async function executeLiveProposal(
  context: ProposalContext,
  proposalId: string,
  lifecycle?: ExecuteProposalLifecycle,
): Promise<ExecuteProposalResult> {
  assertWalletContext(context)
  const { client, isLatest } = await buildAppClient(context)
  const proposalIdValue = BigInt(proposalId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contractProposal = (await (client as any).getProposal({
    args: isLatest ? [proposalIdValue, 0n] : [proposalIdValue],
  })) as ContractProposal
  const submissionParams = {
    method: isLatest ? METHOD_EXECUTE_PROPOSAL_LATEST : METHOD_EXECUTE_PROPOSAL,
    args: isLatest ? [proposalIdValue, EXECUTION_ENSURE_BUDGET] : [proposalIdValue],
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
