import { AlgorandClient, microAlgo } from '@algorandfoundation/algokit-utils'
import { expect, test } from '@playwright/test'
import { ACT_ALL, AlgoSafeFactory, fetchAlgoSafeSignerGroupDetail, PRIV_ALL } from 'algo-safe'
import algosdk from 'algosdk'
import { approveLiveProposal, executeLiveProposal } from '../src/services/algoSafeProposals'
import { proposeMigrationRekey, upgradeSafeToLatest } from '../src/services/algoSafeMigration'
import type { Safe } from '../src/services/types'

// Full safe-upgrade e2e against AlgoKit LocalNet (`algokit localnet start`):
//   1. Deploy an "old" safe governed by a 2-of-2 admin group (two addresses).
//   2. Upgrade it through the frontend's own migration service: deploy a fresh
//      safe on the latest contract and clone the configuration onto it.
//   3. Propose the migration rekey on the old safe (admin 1), approve it with
//      admin 2 to meet the 2-of-2 threshold, and execute it.
//   4. Assert the old safe's account is now rekeyed to the new safe, and that
//      both admins are configured (2-of-2) in the newly deployed safe — first
//      on-chain, then rendered in the UI.
//
// The vite dev server (auto-started by playwright.config.ts) reads `.env`,
// which targets LocalNet, so the UI talks to the same chain as this test.

const ALGOD_SERVER = 'http://localhost'
const ALGOD_PORT = 4001
const TOKEN = 'a'.repeat(64)

const algodClient = new algosdk.Algodv2(TOKEN, ALGOD_SERVER, ALGOD_PORT)

async function localnetAvailable() {
  try {
    await algodClient.status().do()
    return true
  } catch {
    return false
  }
}

test.describe('Safe upgrade (LocalNet)', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(240_000)

  test('clones a 2-of-2 admin safe to a new deployment and rekeys custody over', async ({ page }) => {
    test.skip(!(await localnetAvailable()), 'AlgoKit LocalNet is not running (algokit localnet start)')

    const algorand = AlgorandClient.fromConfig({
      algodConfig: { server: ALGOD_SERVER, port: ALGOD_PORT, token: TOKEN },
      kmdConfig: { server: ALGOD_SERVER, port: 4002, token: TOKEN },
    })

    // --- Setup: two funded admin accounts and the "old" safe (2-of-2). -----
    const dispenser = await algorand.account.localNetDispenser()
    const adminOne = algosdk.generateAccount()
    const adminTwo = algosdk.generateAccount()
    for (const admin of [adminOne, adminTwo]) {
      await algorand.send.payment({
        sender: dispenser.addr,
        receiver: admin.addr,
        amount: microAlgo(20_000_000n),
        suppressLog: true,
      })
    }
    algorand.setSigner(adminOne.addr, algosdk.makeBasicAccountTransactionSigner(adminOne))
    algorand.setSigner(adminTwo.addr, algosdk.makeBasicAccountTransactionSigner(adminTwo))

    const factory = algorand.client.getTypedAppFactory(AlgoSafeFactory, { defaultSender: adminOne.addr })
    const { appClient: oldSafeClient } = await factory.send.create.createApplication({
      args: { name: 'Upgrade Test Safe' },
      suppressLog: true,
    })
    await algorand.send.payment({
      sender: adminOne.addr,
      receiver: oldSafeClient.appAddress,
      amount: microAlgo(3_000_000n),
      suppressLog: true,
    })
    await oldSafeClient.send.bootstrapGroup({
      args: {
        seed: {
          name: 'Admins',
          threshold: 2n,
          adminPrivileges: PRIV_ALL,
          allowedActions: ACT_ALL,
          limitAssetId: 0n,
          dailyLimit: 0n,
          monthlyLimit: 0n,
          cooldownRounds: 0n,
        },
        members: [
          [adminOne.addr.toString(), 1n, 'admin one'],
          [adminTwo.addr.toString(), 1n, 'admin two'],
        ],
        ensureBudgetValue: 0n,
      },
      populateAppCallResources: true,
      suppressLog: true,
    })
    await oldSafeClient.send.finalizeBootstrap({ args: {}, suppressLog: true })

    const oldSafe: Safe = {
      name: 'Upgrade Test Safe',
      appId: Number(oldSafeClient.appId),
      address: oldSafeClient.appAddress.toString(),
      network: 'localnet',
    }

    // --- Step 1: deploy + clone via the frontend migration service. --------
    const adminOneContext = {
      algodClient,
      safe: oldSafe,
      activeAddress: adminOne.addr.toString(),
      transactionSigner: algosdk.makeBasicAccountTransactionSigner(adminOne),
    }
    const upgrade = await upgradeSafeToLatest(adminOneContext)
    expect(upgrade.config.groups).toHaveLength(1)
    expect(upgrade.config.groups[0].seed.threshold).toBe(2n)
    expect(upgrade.config.groups[0].members).toHaveLength(2)

    // --- Step 2: migration rekey — proposed by admin 1, approved by admin 2,
    // then executed once the 2-of-2 threshold is met. ------------------------
    const { proposalId } = await proposeMigrationRekey(adminOneContext, {
      groupId: 1n,
      newSafeAddress: upgrade.appAddress,
    })
    expect(proposalId).not.toBe('')

    // Not executable yet: only the proposer's auto-approval (1 of 2).
    await expect(executeLiveProposal(adminOneContext, proposalId)).rejects.toThrow()

    const adminTwoContext = {
      algodClient,
      safe: oldSafe,
      activeAddress: adminTwo.addr.toString(),
      transactionSigner: algosdk.makeBasicAccountTransactionSigner(adminTwo),
    }
    await approveLiveProposal(adminTwoContext, proposalId)
    const executed = await executeLiveProposal(adminOneContext, proposalId)
    expect(executed.proposal.status).toBe('executed')

    // --- On-chain assertions. ----------------------------------------------
    const oldSafeAccount = await algodClient.accountInformation(oldSafe.address).do()
    expect(oldSafeAccount.authAddr?.toString()).toBe(upgrade.appAddress)

    const newGroupDetail = await fetchAlgoSafeSignerGroupDetail(
      algodClient,
      { appId: upgrade.appId, address: upgrade.appAddress },
      '1',
    )
    expect(newGroupDetail).not.toBeNull()
    expect(newGroupDetail!.group.threshold).toBe(2)
    expect(newGroupDetail!.group.memberCount).toBe(2)
    const newMemberAddresses = newGroupDetail!.members.map((member) => member.address).sort()
    expect(newMemberAddresses).toEqual([adminOne.addr.toString(), adminTwo.addr.toString()].sort())

    // --- UI assertion: the new safe's admin group shows both admins. --------
    const registryEntry = {
      safeId: `localnet-${upgrade.appId.toString()}`,
      name: 'Upgrade Test Safe',
      appId: Number(upgrade.appId),
      address: upgrade.appAddress,
      network: 'localnet',
      creatorAddress: adminOne.addr.toString(),
    }
    await page.addInitScript((entry) => {
      window.localStorage.setItem('algo-safe.registry', JSON.stringify([entry]))
    }, registryEntry)

    await page.goto(`/safe/${registryEntry.safeId}/signer-groups/1/edit`)
    await expect(page.getByText('admin one')).toBeVisible({ timeout: 30000 })
    await expect(page.getByText('admin two')).toBeVisible({ timeout: 30000 })
    await expect(page.locator(`[title="${adminOne.addr.toString()}"]`).first()).toBeVisible()
    await expect(page.locator(`[title="${adminTwo.addr.toString()}"]`).first()).toBeVisible()
    await expect(page.getByText('2 members')).toBeVisible()
  })
})
