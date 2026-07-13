import { algo, AlgorandClient } from '@algorandfoundation/algokit-utils'
import {
  ACT_ALL,
  ACT_AXFER,
  ACT_PAY,
  ADM_CREATE_CUSTODIAN,
  ADM_CREATE_GROUP,
  ADM_SET_PAUSED,
  createAdminChange,
  getAlgoSafeContractVersion,
  getClient,
  PRIV_ALL,
  readSafeConfig,
} from 'algo-safe'
import algosdk, { type TransactionSigner } from 'algosdk'
import type { Safe } from './types'

const TX_VALIDITY_WINDOW = 200
const PROPOSAL_MAX_FEE = algo(0.05)
const DEFAULT_EXPIRY_ROUNDS = 2000n

export type GovernanceContext = {
  algodClient: algosdk.Algodv2
  safe: Safe
  activeAddress?: string | null
  transactionSigner?: TransactionSigner
}

export type AdminProposalResult = {
  proposalId: string
  txId: string
}

function assertWalletContext(context: GovernanceContext) {
  if (!context.activeAddress || !context.transactionSigner) {
    throw new Error('Connect a wallet before creating a governance proposal.')
  }
}

async function buildContext(context: GovernanceContext) {
  assertWalletContext(context)
  const senderAddress = algosdk.Address.fromString(context.activeAddress!)
  const algorand = AlgorandClient.fromClients({ algod: context.algodClient }).setDefaultValidityWindow(TX_VALIDITY_WINDOW)
  algorand.setSigner(senderAddress, context.transactionSigner!)

  const clientVersion = await getAlgoSafeContractVersion(context.algodClient, BigInt(context.safe.appId))
  const appClient = algorand.client.getTypedAppClientById(getClient(clientVersion ?? 'latest'), {
    appId: BigInt(context.safe.appId),
    defaultSender: senderAddress,
  })

  const status = (await context.algodClient.status().do()) as unknown as { lastRound?: number | bigint }
  const expiryRound = BigInt(status.lastRound ?? 0) + DEFAULT_EXPIRY_ROUNDS
  return { appClient, expiryRound }
}

export type SafePausedState = {
  paused: boolean
  version: string
}

/** Read the safe's live pause flag and contract version. */
export async function readSafePausedState(context: Pick<GovernanceContext, 'algodClient' | 'safe'>): Promise<SafePausedState> {
  const clientVersion = await getAlgoSafeContractVersion(context.algodClient, BigInt(context.safe.appId))
  const algorand = AlgorandClient.fromClients({ algod: context.algodClient })
  const appClient = algorand.client.getTypedAppClientById(getClient(clientVersion ?? 'latest'), {
    appId: BigInt(context.safe.appId),
    defaultSender: context.safe.address,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config = await readSafeConfig(appClient as any)
  return { paused: config.paused !== 0n, version: config.version }
}

/**
 * Propose flipping the safe-wide emergency pause flag (ADM_SET_PAUSED).
 * Pause blocks fund-moving transaction-group proposals/appends/executions only;
 * governance — including the unpause proposal itself — is never blocked, so the
 * safe can never lock itself out through pause. Requires group-admin privileges.
 */
export async function proposeSetPaused(
  context: GovernanceContext,
  params: { adminGroupId: bigint; paused: boolean },
): Promise<AdminProposalResult> {
  const { appClient, expiryRound } = await buildContext(context)

  const result = await appClient.send.proposeAdminChange({
    args: {
      groupId: params.adminGroupId,
      change: createAdminChange({
        changeType: ADM_SET_PAUSED,
        activeFlag: params.paused ? 1n : 0n,
      }),
      expiryRound,
      ensureBudgetValue: 0n,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    maxFee: PROPOSAL_MAX_FEE,
    coverAppCallInnerTransactionFees: true,
    populateAppCallResources: true,
    suppressLog: true,
  })

  return { proposalId: result.return?.toString() ?? '', txId: result.txIds[0] ?? '' }
}

export type CreateSignerGroupParams = {
  adminGroupId: bigint
  name: string
  memberAddress: string
  memberLabel: string
  memberType: bigint
  isCustodian: boolean
  // Standard groups only:
  allowedActions?: bigint
  adminPrivileges?: bigint
  limitAssetId?: bigint
  dailyLimit?: bigint
  monthlyLimit?: bigint
  cooldownRounds?: bigint
}

/**
 * Propose creating a new signer group (ADM_CREATE_GROUP) or custodian group
 * (ADM_CREATE_CUSTODIAN). A new group always starts with exactly one member and
 * threshold 1. Custodian groups are forced to adminPrivileges=0 and (v3.1.0+)
 * their allowedActions are restricted to pay/axfer by the contract.
 */
export async function proposeCreateSignerGroup(context: GovernanceContext, params: CreateSignerGroupParams): Promise<AdminProposalResult> {
  if (!algosdk.isValidAddress(params.memberAddress.trim())) {
    throw new Error('Enter a valid Algorand address for the first member.')
  }
  const { appClient, expiryRound } = await buildContext(context)

  const allowedActions = params.isCustodian
    ? (params.allowedActions ?? ACT_PAY | ACT_AXFER) & (ACT_PAY | ACT_AXFER)
    : (params.allowedActions ?? ACT_ALL)

  const result = await appClient.send.proposeAdminChange({
    args: {
      groupId: params.adminGroupId,
      change: createAdminChange({
        changeType: params.isCustodian ? ADM_CREATE_CUSTODIAN : ADM_CREATE_GROUP,
        groupName: params.name.trim(),
        threshold: 1n,
        memberAddr: params.memberAddress.trim(),
        memberType: params.memberType,
        memberLabel: params.memberLabel.trim() || 'member',
        adminPrivileges: params.isCustodian ? 0n : (params.adminPrivileges ?? 0n) & PRIV_ALL,
        allowedActions,
        limitAssetId: params.limitAssetId ?? 0n,
        dailyLimit: params.dailyLimit ?? 0n,
        monthlyLimit: params.monthlyLimit ?? 0n,
        cooldownRounds: params.cooldownRounds ?? 0n,
        activeFlag: 1n,
      }),
      expiryRound,
      ensureBudgetValue: 0n,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    maxFee: PROPOSAL_MAX_FEE,
    coverAppCallInnerTransactionFees: true,
    populateAppCallResources: true,
    suppressLog: true,
  })

  return { proposalId: result.return?.toString() ?? '', txId: result.txIds[0] ?? '' }
}
