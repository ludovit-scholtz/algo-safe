import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import algosdk from 'algosdk'
import { getClient } from './get-client'
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
  monthlyLimit: bigint
  monthlyUsage: bigint
  cooldownRounds: number
  active: boolean
  isAdminGroup: boolean
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
type RawSignerGroup = {
  name: string
  threshold: bigint
  memberCount: bigint
  adminPrivileges: bigint
  allowedActions: bigint
  limitAssetId: bigint
  dailyLimit: bigint
  dailyUsage: bigint
  monthlyLimit: bigint
  monthlyUsage: bigint
  cooldownRounds: bigint
  active: bigint
}
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
    monthlyLimit: group.monthlyLimit,
    monthlyUsage: group.monthlyUsage,
    cooldownRounds: Number(group.cooldownRounds),
    active: group.active !== 0n,
    isAdminGroup: group.adminPrivileges !== 0n,
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

async function getSignerGroupRecords(client: TypedClient) {
  // `client` is a union across contract versions; older versions don't accept
  // `ensureBudgetValue`, so the union's inferred args type can't be satisfied
  // structurally. Cast narrowly on this call rather than fighting the union.
  const configResult = await client.send.getConfig({ args: { ensureBudgetValue: 0n } as any, suppressLog: true })
  const nextGroupId = configResult.return?.[2] ?? 1n
  const groupIds = Array.from({ length: Math.max(0, Number(nextGroupId - 1n)) }, (_value, index) => BigInt(index + 1))

  return Promise.all(
    groupIds.map(async (groupId) => {
      const result = await client.send.getSignerGroup({ args: { groupId, ensureBudgetValue: 0n } as any, suppressLog: true })
      return [groupId, result.return as RawSignerGroup] as const
    }),
  )
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
      const result = await client.send.getMember({
        args: { groupId: targetGroupId, account, ensureBudgetValue: 0n } as any,
        suppressLog: true,
      })
      return result.return as RawSignerGroupMember
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
            const result = await client.send.isMember({
              args: { groupId: adminGroupId, account: normalizedActiveAddress, ensureBudgetValue: 0n } as any,
              suppressLog: true,
            })
            return [adminGroupId.toString(), Boolean(result.return)] as const
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
