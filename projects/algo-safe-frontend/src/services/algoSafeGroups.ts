import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoSafeClient } from 'algo-safe'
import type algosdk from 'algosdk'
import type { Safe } from './types'

export type LiveSignerGroup = {
  id: string
  name: string
  threshold: number
  memberCount: number
  adminPrivileges: number
  allowedActions: number
  dailyLimit: bigint
  dailyUsage: bigint
  monthlyLimit: bigint
  monthlyUsage: bigint
  cooldownRounds: number
  active: boolean
  isAdminGroup: boolean
}

function buildAppClient(algodClient: algosdk.Algodv2, safe: Safe) {
  const algorand = AlgorandClient.fromClients({ algod: algodClient })
  return algorand.client.getTypedAppClientById(AlgoSafeClient, {
    appId: BigInt(safe.appId),
    defaultSender: safe.address,
  })
}

export async function fetchLiveSignerGroups(algodClient: algosdk.Algodv2, safe: Safe): Promise<LiveSignerGroup[]> {
  const client = buildAppClient(algodClient, safe)
  const config = await client.getConfig()
  const nextGroupId = config[2] ?? 1n

  if (nextGroupId <= 1n) {
    return []
  }

  const groupIds = Array.from({ length: Number(nextGroupId - 1n) }, (_value, index) => BigInt(index + 1))
  const groups = await Promise.all(
    groupIds.map(async (groupId) => {
      const group = await client.getSignerGroup({ args: [groupId] })

      return {
        id: groupId.toString(),
        name: group.name,
        threshold: Number(group.threshold),
        memberCount: Number(group.memberCount),
        adminPrivileges: Number(group.adminPrivileges),
        allowedActions: Number(group.allowedActions),
        dailyLimit: group.dailyLimit,
        dailyUsage: group.dailyUsage,
        monthlyLimit: group.monthlyLimit,
        monthlyUsage: group.monthlyUsage,
        cooldownRounds: Number(group.cooldownRounds),
        active: group.active !== 0n,
        isAdminGroup: group.adminPrivileges !== 0n,
      } satisfies LiveSignerGroup
    }),
  )

  return groups.sort((left, right) => Number(right.isAdminGroup) - Number(left.isAdminGroup) || Number(left.id) - Number(right.id))
}