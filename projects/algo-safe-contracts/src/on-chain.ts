import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import algosdk from 'algosdk'
import { getClient } from './get-client'
import type { Proposal, SignerGroup } from './latest-client'
import { getAlgoSafeContractVersion } from './version'

export type AlgoSafeOnChainRef = {
  appId: bigint | number
  address: string
}

export type AlgoSafeSignerGroupRecord = {
  id: string
  name: string
  threshold: number
  memberCount: number
  adminPrivileges: number
  allowedActions: number
  limitAssetId: bigint
  dailyLimit: bigint
  dailyUsage: bigint
  dailyPeriodStart: number
  monthlyLimit: bigint
  monthlyUsage: bigint
  monthlyPeriodStart: number
  cooldownRounds: number
  lastExecutionRound: number
  membershipEpoch: number
  active: boolean
  isAdminGroup: boolean
  groupType: number   // GT_STANDARD=0 | GT_CUSTODIAN=1
  guardCount: number  // number of active asset guards (custodian groups only)
}

export type AlgoSafeSignerGroupMemberRecord = {
  address: string
  label: string
  accountType: number
}

export type AlgoSafeAdminGroupOptionRecord = {
  id: string
  name: string
  isMember: boolean
}

export type AlgoSafeSignerGroupDetailRecord = {
  group: AlgoSafeSignerGroupRecord
  members: AlgoSafeSignerGroupMemberRecord[]
  adminGroupOptions: AlgoSafeAdminGroupOptionRecord[]
}

type TypedClient = Awaited<ReturnType<typeof buildAlgoSafeAppClient>>
// `SignerGroup` is imported from the latest deployed contract's ABI shape (see
// `latest-client.ts`). Older deployed versions that predate a given field
// simply won't populate it at runtime — same tolerance already applied to
// `Proposal.numPayloads` elsewhere in this library (see CLAUDE.md).
type RawSignerGroup = SignerGroup
type RawSignerGroupMember = {
  addr: string
  label: string
  accountType: bigint
}

const MEMBER_BOX_PREFIX = 'm'.charCodeAt(0)
const BOX_PAGE_SIZE = 10_000

function readUint64BigEndian(bytes: Uint8Array) {
  let value = 0n
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte)
  }
  return value
}

function mapSignerGroup(groupId: bigint, group: RawSignerGroup): AlgoSafeSignerGroupRecord {
  return {
    id: groupId.toString(),
    name: group.name,
    threshold: Number(group.threshold),
    memberCount: Number(group.memberCount),
    adminPrivileges: Number(group.adminPrivileges),
    allowedActions: Number(group.allowedActions),
    limitAssetId: group.limitAssetId ?? 0n,
    dailyLimit: group.dailyLimit,
    dailyUsage: group.dailyUsage,
    dailyPeriodStart: Number(group.dailyPeriodStart),
    monthlyLimit: group.monthlyLimit,
    monthlyUsage: group.monthlyUsage,
    monthlyPeriodStart: Number(group.monthlyPeriodStart),
    cooldownRounds: Number(group.cooldownRounds),
    lastExecutionRound: Number(group.lastExecutionRound),
    membershipEpoch: Number(group.membershipEpoch),
    active: group.active !== 0n,
    isAdminGroup: group.adminPrivileges !== 0n,
    groupType: Number(group.groupType ?? 0n),
    guardCount: Number(group.guardCount ?? 0n),
  }
}

export async function buildAlgoSafeAppClient(algodClient: algosdk.Algodv2, safe: AlgoSafeOnChainRef) {
  const algorand = AlgorandClient.fromClients({ algod: algodClient })
  const clientVersion = await getAlgoSafeContractVersion(algodClient, BigInt(safe.appId))

  return algorand.client.getTypedAppClientById(getClient(clientVersion ?? 'latest'), {
    appId: BigInt(safe.appId),
    defaultSender: safe.address,
  })
}

// ---------------------------------------------------------------------------
// Box / global-state readers.
//
// v3.0.0 removed the read-only ABI getters from the contract to reclaim
// approval-program space — all of that data is plain box / global state, which
// every generated client (old and new) exposes through `state.box.*` /
// `state.global.*` accessors that decode with that version's own struct
// layout. The readers below are the getters' replacements and work against
// every deployed contract version. The `client` parameter is a union across
// versions, so calls go through a narrow `any` cast rather than fighting the
// union type.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Minimal structural type for any generated AlgoSafe typed client (any
 * contract version) — the readers only need the state accessors.
 */
export type SafeStateClient = {
  state: {
    global: { getAll(): Promise<object> }
    box: object
  }
}

// algokit-utils' getMapValue throws a 404 ("box not found") when the box is
// absent — normalise that to undefined so callers get getter-like optionality.
async function tolerateMissingBox<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('box not found') || message.includes('404')) {
      return undefined
    }
    throw error
  }
}

export type AlgoSafeConfigRecord = {
  name: string
  groupCount: bigint
  nextGroupId: bigint
  nextProposalId: bigint
  paused: bigint
  version: string
  activePrivGroupCount: bigint
}

/** Read the safe's global configuration (former `getConfig` + `getActivePrivGroupCount`). */
export async function readSafeConfig(client: SafeStateClient): Promise<AlgoSafeConfigRecord> {
  const globalState = await (client.state.global as any).getAll()
  return {
    name: String(globalState.name ?? ''),
    groupCount: BigInt(globalState.groupCount ?? 0n),
    nextGroupId: BigInt(globalState.nextGroupId ?? 1n),
    nextProposalId: BigInt(globalState.nextProposalId ?? 1n),
    paused: BigInt(globalState.paused ?? 0n),
    version: String(globalState.version ?? ''),
    activePrivGroupCount: BigInt(globalState.activePrivGroupCount ?? 0n),
  }
}

/** Read one signer group box (former `getSignerGroup`); undefined when missing. */
export async function readSignerGroup(client: SafeStateClient, groupId: bigint) {
  return tolerateMissingBox(async () => (await (client.state.box as any).groups.value(groupId)) as RawSignerGroup)
}

/** Read one member box (former `getMember`); undefined when not a member. */
export async function readMember(client: SafeStateClient, groupId: bigint, account: string) {
  return tolerateMissingBox(async () => (await (client.state.box as any).members.value({ groupId, account })) as RawSignerGroupMember)
}

/** Former `isMember`. */
export async function readIsMember(client: SafeStateClient, groupId: bigint, account: string) {
  return (await readMember(client, groupId, account)) !== undefined
}

// Multiplier separating per-chunk payload box keys: key = proposalId * 7 + chunkIndex.
// Must match TXG_KEY_MULT in contract.algo.ts.
const TXG_KEY_MULT = 7n

/** Read one proposal box (former `getProposal`); undefined when missing/pruned. */
export async function readProposal(client: SafeStateClient, proposalId: bigint) {
  return tolerateMissingBox(async () => (await (client.state.box as any).proposals.value(proposalId)) as Proposal)
}

/** Read one transaction-payload chunk (former `getTransactionGroup`); undefined when the slot is empty. */
export async function readTransactionGroup(client: SafeStateClient, proposalId: bigint, payloadIndex: bigint) {
  return tolerateMissingBox(
    async () =>
      (await (client.state.box as any).transactionGroups.value(proposalId * TXG_KEY_MULT + payloadIndex)) as [
        bigint,
        Uint8Array,
      ][],
  )
}

/** Former `hasApproved`. */
export async function readHasApproved(client: SafeStateClient, proposalId: bigint, account: string) {
  const approval = await tolerateMissingBox(async () => (client.state.box as any).approvals.value({ proposalId, account }))
  return approval !== undefined
}

/** Read one rekeyed-address registry entry (former `getRekeyedAddress` / `isRekeyedAddress`). */
export async function readRekeyedAddress(client: SafeStateClient, account: string) {
  return tolerateMissingBox(
    async () => (await (client.state.box as any).rekeyedAddresses.value(account)) as { label: string; addedRound: bigint },
  )
}

/** Read one custodian asset guard (former `getAssetGuard` / `hasAssetGuard`). */
export async function readAssetGuard(client: SafeStateClient, custodianGroupId: bigint, assetId: bigint) {
  return tolerateMissingBox(
    async () =>
      (await (client.state.box as any).assetGuards.value({ custodianGroupId, assetId })) as {
        createdRound: bigint
        lockedAmount: bigint
      },
  )
}

async function getSignerGroupRecords(client: TypedClient) {
  const { nextGroupId } = await readSafeConfig(client)
  const groupIds = Array.from({ length: Math.max(0, Number(nextGroupId - 1n)) }, (_value, index) => BigInt(index + 1))

  const entries = await Promise.all(
    groupIds.map(async (groupId) => {
      const group = await readSignerGroup(client, groupId)
      return group ? ([groupId, group] as const) : undefined
    }),
  )
  return entries.filter((entry): entry is readonly [bigint, RawSignerGroup] => entry !== undefined)
}

async function listMemberAddressesForGroup(algodClient: algosdk.Algodv2, safe: AlgoSafeOnChainRef, groupId: bigint) {
  const response = (await algodClient.getApplicationBoxes(safe.appId).max(BOX_PAGE_SIZE).do()) as {
    boxes?: Array<{ name?: Uint8Array }>
  }

  return (response.boxes ?? [])
    .map((box) => box.name)
    .filter((name): name is Uint8Array => name instanceof Uint8Array && name.length >= 41)
    .filter((name) => name[0] === MEMBER_BOX_PREFIX && readUint64BigEndian(name.slice(1, 9)) === groupId)
    .map((name) => algosdk.encodeAddress(name.slice(9, 41)))
}

export async function fetchAlgoSafeSignerGroups(
  algodClient: algosdk.Algodv2,
  safe: AlgoSafeOnChainRef,
): Promise<AlgoSafeSignerGroupRecord[]> {
  const client = await buildAlgoSafeAppClient(algodClient, safe)
  const groupEntries = await getSignerGroupRecords(client)
  const groups = groupEntries.map(([groupId, group]) => mapSignerGroup(groupId, group))

  return groups.sort(
    (left, right) => Number(right.isAdminGroup) - Number(left.isAdminGroup) || Number(left.id) - Number(right.id),
  )
}

export async function fetchAlgoSafeSignerGroupDetail(
  algodClient: algosdk.Algodv2,
  safe: AlgoSafeOnChainRef,
  groupId: string,
  activeAddress?: string | null,
): Promise<AlgoSafeSignerGroupDetailRecord | null> {
  const client = await buildAlgoSafeAppClient(algodClient, safe)
  const groupEntries = await getSignerGroupRecords(client)
  const targetGroupId = BigInt(groupId)
  const targetGroup = groupEntries.find(([candidateGroupId]) => candidateGroupId === targetGroupId)?.[1]

  if (!targetGroup) {
    return null
  }

  const memberAddresses = await listMemberAddressesForGroup(algodClient, safe, targetGroupId)
  const memberResults = await Promise.all(
    memberAddresses.map(async (account) => {
      const member = await readMember(client, targetGroupId, account)
      return member ?? { addr: account, label: '', accountType: 1n }
    }),
  )

  const members = memberResults
    .map((member) => ({
      address: member.addr,
      label: member.label,
      accountType: Number(member.accountType),
    }))
    .sort((left, right) => left.label.localeCompare(right.label) || left.address.localeCompare(right.address))

  const normalizedActiveAddress = activeAddress?.trim() ?? ''
  const adminGroups = groupEntries.filter(([_id, group]) => group.adminPrivileges !== 0n && group.active !== 0n)
  const adminMemberships =
    normalizedActiveAddress && algosdk.isValidAddress(normalizedActiveAddress)
      ? await Promise.all(
          adminGroups.map(async ([adminGroupId]) => {
            const isGroupMember = await readIsMember(client, adminGroupId, normalizedActiveAddress)
            return [adminGroupId.toString(), isGroupMember] as const
          }),
        )
      : []
  const adminMembershipMap = new Map(adminMemberships)
  const adminGroupOptions = adminGroups
    .map(([adminGroupId, group]) => ({
      id: adminGroupId.toString(),
      name: group.name,
      isMember: adminMembershipMap.get(adminGroupId.toString()) ?? false,
    }))
    .sort((left, right) => Number(right.isMember) - Number(left.isMember) || Number(left.id) - Number(right.id))

  return {
    group: mapSignerGroup(targetGroupId, targetGroup),
    members,
    adminGroupOptions,
  }
}
