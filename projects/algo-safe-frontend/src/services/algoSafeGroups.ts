import { fetchAlgoSafeSignerGroupDetail, fetchAlgoSafeSignerGroups, type AlgoSafeSignerGroupRecord } from 'algo-safe'
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

async function getLimitAssetMap(algodClient: algosdk.Algodv2, safe: Safe, groups: readonly AlgoSafeSignerGroupRecord[]) {
  const assetIds = Array.from(new Set(groups.map((group) => Number(group.limitAssetId ?? 0n))))
  const entries = await Promise.all(
    assetIds.map(
      async (assetId) =>
        [assetId, assetId === 0 ? getNativeAssetMetadata() : await resolveAssetMetadata(algodClient, assetId, safe.network)] as const,
    ),
  )

  return new Map<number, AssetMetadata>(entries)
}

function mapLiveSignerGroup(group: AlgoSafeSignerGroupRecord, limitAssetMap: Map<number, AssetMetadata>): LiveSignerGroup {
  const limitAssetId = group.limitAssetId ?? 0n

  return {
    id: group.id,
    name: group.name,
    threshold: group.threshold,
    memberCount: group.memberCount,
    adminPrivileges: group.adminPrivileges,
    allowedActions: group.allowedActions,
    limitAssetId,
    dailyLimit: group.dailyLimit,
    dailyUsage: group.dailyUsage,
    monthlyLimit: group.monthlyLimit,
    monthlyUsage: group.monthlyUsage,
    cooldownRounds: group.cooldownRounds,
    limitAsset: limitAssetMap.get(Number(limitAssetId)) ?? getNativeAssetMetadata(),
    active: group.active,
    isAdminGroup: group.isAdminGroup,
  }
}

export async function fetchLiveSignerGroups(algodClient: algosdk.Algodv2, safe: Safe): Promise<LiveSignerGroup[]> {
  const groups = await fetchAlgoSafeSignerGroups(algodClient, { appId: safe.appId, address: safe.address })

  if (groups.length === 0) {
    return []
  }

  const limitAssetMap = await getLimitAssetMap(algodClient, safe, groups)

  return groups.map((group) => mapLiveSignerGroup(group, limitAssetMap))
}

export async function fetchLiveSignerGroupDetail(
  algodClient: algosdk.Algodv2,
  safe: Safe,
  groupId: string,
  activeAddress?: string | null,
): Promise<LiveSignerGroupDetail | null> {
  const detail = await fetchAlgoSafeSignerGroupDetail(algodClient, { appId: safe.appId, address: safe.address }, groupId, activeAddress)

  if (!detail) {
    return null
  }

  const groups = await fetchAlgoSafeSignerGroups(algodClient, { appId: safe.appId, address: safe.address })
  const limitAssetMap = await getLimitAssetMap(algodClient, safe, groups)

  return {
    group: mapLiveSignerGroup(detail.group, limitAssetMap),
    members: detail.members,
    adminGroupOptions: detail.adminGroupOptions,
  }
}
