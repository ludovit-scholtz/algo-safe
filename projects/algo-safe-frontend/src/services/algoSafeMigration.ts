import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { algo } from '@algorandfoundation/algokit-utils'
import {
  ADM_ADD_REKEYED_ADDR,
  ADM_REMOVE_REKEYED_ADDR,
  buildMigrationRekeyPayload,
  createAdminChange,
  deployClonedSafe,
  fetchSafeCloneConfig,
  fetchSafeVersionStatus,
  getAlgoSafeContractVersion,
  getClient,
  listRekeyedAddresses,
  type AdminChange,
  type RekeyedAddressRecord,
  type SafeCloneConfig,
  type SafeVersionStatus,
} from 'algo-safe'
import algosdk, { type TransactionSigner } from 'algosdk'
import { proposeLiveTransactionGroup, type ProposeTransactionGroupResult } from './algoSafeProposals'
import type { Safe } from './types'

const TX_VALIDITY_WINDOW = 200
const PROPOSAL_MAX_FEE = algo(0.05)
const DEFAULT_EXPIRY_ROUNDS = 2000n

type MigrationContext = {
  algodClient: algosdk.Algodv2
  safe: Safe
  activeAddress?: string | null
  transactionSigner?: TransactionSigner
}

function assertWalletContext(context: MigrationContext) {
  if (!context.activeAddress || !context.transactionSigner) {
    throw new Error('Connect a wallet before running safe migration actions.')
  }
}

function toAdminChangeTuple(change: AdminChange) {
  return [
    change.changeType,
    change.targetGroupId,
    change.groupName,
    change.memberAddr,
    change.memberType,
    change.memberLabel,
    change.threshold,
    change.adminPrivileges,
    change.allowedActions,
    change.limitAssetId,
    change.dailyLimit,
    change.monthlyLimit,
    change.cooldownRounds,
    change.activeFlag,
  ] as const
}

export function getSafeUpgradeStatus(context: MigrationContext): Promise<SafeVersionStatus> {
  return fetchSafeVersionStatus(context.algodClient, BigInt(context.safe.appId))
}

export function fetchSafeRekeyedAddresses(context: MigrationContext): Promise<RekeyedAddressRecord[]> {
  return listRekeyedAddresses(context.algodClient, BigInt(context.safe.appId))
}

export type RekeyedAddressChange = {
  adminGroupId: bigint
  action: 'add' | 'remove'
  address: string
  label?: string
}

export type AdminProposalResult = {
  proposalId: string
  txId: string
}

/**
 * Propose adding or removing an entry of the safe's rekeyed-address registry.
 * Requires the proposing group to hold group-admin privileges; the change
 * applies once the group's threshold approves and someone executes it.
 */
export async function proposeRekeyedAddressChange(context: MigrationContext, params: RekeyedAddressChange): Promise<AdminProposalResult> {
  assertWalletContext(context)

  const senderAddress = algosdk.Address.fromString(context.activeAddress!)
  const algorand = AlgorandClient.fromClients({ algod: context.algodClient }).setDefaultValidityWindow(TX_VALIDITY_WINDOW)
  algorand.setSigner(senderAddress, context.transactionSigner!)

  const clientVersion = await getAlgoSafeContractVersion(context.algodClient, BigInt(context.safe.appId))
  const appClient = algorand.client.getTypedAppClientById(getClient(clientVersion ?? 'latest'), {
    appId: BigInt(context.safe.appId),
    defaultSender: senderAddress,
  })

  const status = await context.algodClient.status().do()
  const expiryRound = BigInt(status.lastRound ?? 0) + DEFAULT_EXPIRY_ROUNDS
  const change = createAdminChange({
    changeType: params.action === 'add' ? ADM_ADD_REKEYED_ADDR : ADM_REMOVE_REKEYED_ADDR,
    memberAddr: params.address.trim(),
    memberLabel: params.label?.trim() ?? '',
  })

  const result = await appClient.send.proposeAdminChange({
    // The versioned-client union types the args as the intersection of every
    // contract version's shape, which no single value satisfies — narrow cast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: [params.adminGroupId, toAdminChangeTuple(change) as unknown as AdminChange, expiryRound, 0n] as any,
    maxFee: PROPOSAL_MAX_FEE,
    coverAppCallInnerTransactionFees: true,
    populateAppCallResources: true,
    suppressLog: true,
  })

  return { proposalId: result.return?.toString() ?? '', txId: result.txIds[0] ?? '' }
}

export type UpgradeSafeResult = {
  appId: bigint
  appAddress: string
  config: SafeCloneConfig
}

/**
 * Step 1 of a safe upgrade: deploy a fresh safe on the latest contract and
 * clone the current safe's configuration (active signer groups with members,
 * policies, privileges, and the rekeyed-address registry) onto it. The
 * connected wallet becomes the new safe's creator and signs the deployment,
 * funding, and seeding calls. Custody does NOT move yet — that happens when
 * the migration rekey proposal (step 2) is approved and executed.
 */
export async function upgradeSafeToLatest(
  context: MigrationContext,
  options: { name?: string; fundMicroAlgo?: bigint } = {},
): Promise<UpgradeSafeResult> {
  assertWalletContext(context)

  const config = await fetchSafeCloneConfig(context.algodClient, {
    appId: BigInt(context.safe.appId),
    address: context.safe.address,
  })
  const result = await deployClonedSafe({
    algodClient: context.algodClient,
    sender: context.activeAddress!,
    signer: context.transactionSigner!,
    config,
    name: options.name,
    fundMicroAlgo: options.fundMicroAlgo,
  })

  return { ...result, config }
}

/**
 * Step 2 of a safe upgrade: propose the migration rekey on the OLD safe — one
 * rekey per registered external address, then the old safe's own application
 * account, all to the new safe's application address. Executing it (once the
 * admin group's threshold approves) irrevocably moves custody to the new safe.
 */
export async function proposeMigrationRekey(
  context: MigrationContext,
  params: { groupId: bigint; newSafeAddress: string; expiryRounds?: bigint },
): Promise<ProposeTransactionGroupResult> {
  assertWalletContext(context)

  const rekeyedAddresses = await listRekeyedAddresses(context.algodClient, BigInt(context.safe.appId))
  const payload = buildMigrationRekeyPayload(
    rekeyedAddresses.map((record) => record.address),
    params.newSafeAddress,
  )

  return proposeLiveTransactionGroup(context, {
    groupId: params.groupId,
    payload,
    expiryRounds: params.expiryRounds ?? DEFAULT_EXPIRY_ROUNDS,
  })
}
