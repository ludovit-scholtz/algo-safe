import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { getAlgoSafeContractVersion, getClient } from 'algo-safe'
import type algosdk from 'algosdk'
import type { AssetMetadata } from '../lib/assetMetadata'
import { getNativeAssetMetadata, resolveAssetMetadata } from '../lib/assetMetadata'
import type { Safe } from './types'

export type LiveSignerGroup = {
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
  limitAsset: AssetMetadata
  active: boolean
  isAdminGroup: boolean
}

export type LiveSignerGroupMember = {
  address: string
  label: string
  accountType: number
}

export type LiveAdminGroupOption = {
  id: string
  name: string
  isMember: boolean
}

export type LiveSignerGroupDetail = {
  group: LiveSignerGroup
  members: LiveSignerGroupMember[]
  adminGroupOptions: LiveAdminGroupOption[]
}

async function buildAppClient(algodClient: algosdk.Algodv2, safe: Safe) {
  const algorand = AlgorandClient.fromClients({ algod: algodClient })
  const clientVersion = await getAlgoSafeContractVersion(algodClient, BigInt(safe.appId))

  return algorand.client.getTypedAppClientById(getClient(clientVersion ?? 'latest'), {
    appId: BigInt(safe.appId),
    defaultSender: safe.address,
  })
}

async function getBoxMaps(algodClient: algosdk.Algodv2, safe: Safe) {
  const client = await buildAppClient(algodClient, safe)
  const [groupsMap, membersMap] = await Promise.all([client.state.box.groups.getMap(), client.state.box.members.getMap()])

  return { groupsMap, membersMap }
}

type GroupBoxValue = Awaited<ReturnType<typeof getBoxMaps>>['groupsMap'] extends Map<bigint, infer TValue> ? TValue : never

async function getLimitAssetMap(algodClient: algosdk.Algodv2, safe: Safe, groupsMap: Map<bigint, GroupBoxValue>) {
  const assetIds = Array.from(new Set(Array.from(groupsMap.values(), (group) => Number(group.limitAssetId ?? 0n))))
  const entries = await Promise.all(
    assetIds.map(
      async (assetId) =>
        [assetId, assetId === 0 ? getNativeAssetMetadata() : await resolveAssetMetadata(algodClient, assetId, safe.network)] as const,
    ),
  )

  return new Map<number, AssetMetadata>(entries)
}

function mapLiveSignerGroup(groupId: bigint, group: GroupBoxValue, limitAssetMap: Map<number, AssetMetadata>): LiveSignerGroup {
  const limitAssetId = group.limitAssetId ?? 0n

  return {
    id: groupId.toString(),
    name: group.name,
    threshold: Number(group.threshold),
    memberCount: Number(group.memberCount),
    adminPrivileges: Number(group.adminPrivileges),
    allowedActions: Number(group.allowedActions),
    limitAssetId,
    dailyLimit: group.dailyLimit,
    dailyUsage: group.dailyUsage,
    monthlyLimit: group.monthlyLimit,
    monthlyUsage: group.monthlyUsage,
    cooldownRounds: Number(group.cooldownRounds),
    limitAsset: limitAssetMap.get(Number(limitAssetId)) ?? getNativeAssetMetadata(),
    active: group.active !== 0n,
    isAdminGroup: group.adminPrivileges !== 0n,
  }
}

export async function fetchLiveSignerGroups(algodClient: algosdk.Algodv2, safe: Safe): Promise<LiveSignerGroup[]> {
  const { groupsMap } = await getBoxMaps(algodClient, safe)

  if (groupsMap.size === 0) {
    return []
  }

  const limitAssetMap = await getLimitAssetMap(algodClient, safe, groupsMap)
  const groups = Array.from(groupsMap.entries(), ([groupId, group]) => mapLiveSignerGroup(groupId, group, limitAssetMap))

  return groups.sort((left, right) => Number(right.isAdminGroup) - Number(left.isAdminGroup) || Number(left.id) - Number(right.id))
}

export async function fetchLiveSignerGroupDetail(
  algodClient: algosdk.Algodv2,
  safe: Safe,
  groupId: string,
  activeAddress?: string | null,
): Promise<LiveSignerGroupDetail | null> {
  const { groupsMap, membersMap } = await getBoxMaps(algodClient, safe)
  const targetGroupId = BigInt(groupId)
  const targetGroup = groupsMap.get(targetGroupId)

  if (!targetGroup) {
    return null
  }

  const limitAssetMap = await getLimitAssetMap(algodClient, safe, groupsMap)

  const members = Array.from(membersMap.entries())
    .filter(([key]) => key.groupId === targetGroupId)
    .map(([_key, member]) => ({
      address: member.addr,
      label: member.label,
      accountType: Number(member.accountType),
    }))
    .sort((left, right) => left.label.localeCompare(right.label) || left.address.localeCompare(right.address))

  const normalizedActiveAddress = activeAddress?.trim() ?? ''
  const adminGroupOptions = Array.from(groupsMap.entries())
    .filter(([_id, group]) => group.adminPrivileges !== 0n && group.active !== 0n)
    .map(([adminGroupId, group]) => ({
      id: adminGroupId.toString(),
      name: group.name,
      isMember: normalizedActiveAddress
        ? Array.from(membersMap.keys()).some((key) => key.groupId === adminGroupId && key.account === normalizedActiveAddress)
        : false,
    }))
    .sort((left, right) => Number(right.isMember) - Number(left.isMember) || Number(left.id) - Number(right.id))

  return {
    group: mapLiveSignerGroup(targetGroupId, targetGroup, limitAssetMap),
    members,
    adminGroupOptions,
  }
}
