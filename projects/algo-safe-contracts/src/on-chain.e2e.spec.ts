import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { beforeEach, describe, expect, test } from 'vitest'
import { createAdminChange } from './admin'
import { ADM_ADD_MEMBER, ADM_CREATE_GROUP, ACT_PAY, FAR_EXPIRY } from './constants'
import { fetchAlgoSafeSignerGroupDetail, fetchAlgoSafeSignerGroups } from './on-chain'
import { AlgoSafeFactory } from '../smart_contracts/artifacts/algo_safe/AlgoSafeClient'

describe('on-chain signer-group readers (fetchAlgoSafeSignerGroups / fetchAlgoSafeSignerGroupDetail)', () => {
  const localnet = algorandFixture()
  beforeEach(localnet.newScope)

  const execParams = { coverAppCallInnerTransactionFees: true, maxFee: (0.02).algo(), suppressLog: true }

  const deployAndBootstrap = async () => {
    const deployer = await localnet.context.generateAccount({ initialFunds: (50).algo() })
    const factory = localnet.algorand.client.getTypedAppFactory(AlgoSafeFactory, { defaultSender: deployer })
    const { appClient } = await factory.send.create.createApplication({ args: { name: 'On-Chain Test Safe' }, suppressLog: true })
    await localnet.algorand.send.payment({
      amount: (5).algo(),
      sender: deployer,
      receiver: appClient.appAddress,
      suppressLog: true,
    })
    await appClient.send.bootstrap({ args: { groupName: 'Admins' }, suppressLog: true })
    return { appClient, deployer }
  }

  const governAdminChange = async (appClient: Awaited<ReturnType<typeof deployAndBootstrap>>['appClient'], adminGroupId: bigint, change: ReturnType<typeof createAdminChange>) => {
    const { return: pid } = await appClient.send.proposeAdminChange({
      args: { groupId: adminGroupId, change, expiryRound: FAR_EXPIRY, ensureBudgetValue: 0n },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await appClient.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })
    return pid!
  }

  test('fetchAlgoSafeSignerGroups lists groups sorted admin-first, then by id', async () => {
    const { appClient } = await deployAndBootstrap()
    const treasurer = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    await governAdminChange(
      appClient,
      1n,
      createAdminChange({
        changeType: ADM_CREATE_GROUP,
        groupName: 'Treasury',
        threshold: 1n,
        memberAddr: treasurer.toString(),
        allowedActions: ACT_PAY,
        adminPrivileges: 0n,
      }),
    )

    const groups = await fetchAlgoSafeSignerGroups(localnet.algorand.client.algod, {
      appId: BigInt(appClient.appId),
      address: appClient.appAddress.toString(),
    })

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ id: '1', name: 'Admins', isAdminGroup: true, threshold: 1, memberCount: 1, active: true })
    expect(groups[1]).toMatchObject({ id: '2', name: 'Treasury', isAdminGroup: false, threshold: 1, memberCount: 1, active: true })
  })

  test('fetchAlgoSafeSignerGroupDetail returns members and admin-group options, or null for an unknown group', async () => {
    const { appClient, deployer } = await deployAndBootstrap()
    const second = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    await governAdminChange(
      appClient,
      1n,
      createAdminChange({ changeType: ADM_ADD_MEMBER, targetGroupId: 1n, memberAddr: second.toString(), memberLabel: 'second' }),
    )

    const safeRef = { appId: BigInt(appClient.appId), address: appClient.appAddress.toString() }

    const detail = await fetchAlgoSafeSignerGroupDetail(localnet.algorand.client.algod, safeRef, '1', deployer.toString())
    expect(detail).not.toBeNull()
    expect(detail!.group.memberCount).toBe(2)
    expect(detail!.members.map((m) => m.address).sort()).toEqual([deployer.toString(), second.toString()].sort())
    expect(detail!.adminGroupOptions).toEqual([{ id: '1', name: 'Admins', isMember: true }])

    const missing = await fetchAlgoSafeSignerGroupDetail(localnet.algorand.client.algod, safeRef, '999', deployer.toString())
    expect(missing).toBeNull()
  })
})
