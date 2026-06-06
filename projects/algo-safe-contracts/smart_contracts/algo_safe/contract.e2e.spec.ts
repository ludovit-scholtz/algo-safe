import { Config } from '@algorandfoundation/algokit-utils'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import algosdk from 'algosdk'
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import {
  AdminChange,
  AlgoSafeClient,
  AlgoSafeFactory,
  SafeTxn,
  TransactionGroupPayload,
} from '../artifacts/algo_safe/AlgoSafeClient'

// Contract constants mirrored for the tests.
const ACT_PAY = 1n
const ACT_AXFER = 2n
const ACT_APPL = 4n
const ACT_ALL = 15n
const PRIV_GROUP = 1n
const PRIV_ALL = 7n

const TX_PAYMENT = 1n
const TX_APP = 3n

const ADM_CREATE_GROUP = 1n
const ADM_ADD_MEMBER = 2n
const ADM_REMOVE_MEMBER = 3n
const ADM_CHANGE_THRESHOLD = 4n

const ZERO_ADDR = algosdk.encodeAddress(new Uint8Array(32))
const FAR_EXPIRY = 4_000_000_000n

function mkAdminChange(partial: Partial<AdminChange>): AdminChange {
  return {
    changeType: 0n,
    targetGroupId: 0n,
    groupName: '',
    memberAddr: ZERO_ADDR,
    memberType: 1n,
    memberLabel: '',
    threshold: 0n,
    adminPrivileges: 0n,
    allowedActions: 0n,
    dailyLimit: 0n,
    monthlyLimit: 0n,
    cooldownRounds: 0n,
    activeFlag: 0n,
    ...partial,
  }
}

function mkPayment(receiver: string, amount: bigint) {
  return { receiver, amount, hasClose: 0n, closeRemainderTo: ZERO_ADDR, note: '' }
}

const EMPTY_BYTES = new Uint8Array()

function emptySafeTxn(): SafeTxn {
  return {
    txType: TX_PAYMENT,
    receiver: ZERO_ADDR,
    amount: 0n,
    hasClose: 0n,
    closeRemainderTo: ZERO_ADDR,
    xferAsset: 0n,
    assetReceiver: ZERO_ADDR,
    assetAmount: 0n,
    hasAssetClose: 0n,
    assetCloseTo: ZERO_ADDR,
    appId: 0n,
    numArgs: 0n,
    arg0: EMPTY_BYTES,
    arg1: EMPTY_BYTES,
    arg2: EMPTY_BYTES,
    arg3: EMPTY_BYTES,
    online: 0n,
    voteKey: EMPTY_BYTES,
    selectionKey: EMPTY_BYTES,
    stateProofKey: EMPTY_BYTES,
    voteFirst: 0n,
    voteLast: 0n,
    voteKeyDilution: 0n,
    note: '',
  }
}

function safePayment(receiver: string, amount: bigint, note = ''): SafeTxn {
  return { ...emptySafeTxn(), txType: TX_PAYMENT, receiver, amount, note }
}

function safeAppCall(appId: bigint, args: Uint8Array[] = []): SafeTxn {
  return {
    ...emptySafeTxn(),
    txType: TX_APP,
    appId,
    numArgs: BigInt(args.length),
    arg0: args[0] ?? EMPTY_BYTES,
    arg1: args[1] ?? EMPTY_BYTES,
    arg2: args[2] ?? EMPTY_BYTES,
    arg3: args[3] ?? EMPTY_BYTES,
  }
}

function txGroup(txs: SafeTxn[]): TransactionGroupPayload {
  return {
    count: BigInt(txs.length),
    tx0: txs[0],
    tx1: txs[1] ?? emptySafeTxn(),
    tx2: txs[2] ?? emptySafeTxn(),
  }
}

describe('AlgoSafe contract', () => {
  const localnet = algorandFixture()

  beforeAll(() => {
    Config.configure({ debug: false, populateAppCallResources: true })
  })
  beforeEach(localnet.newScope)

  const deploy = async () => {
    // Use a well-funded generated account as the deployer / genesis admin.
    const deployer = await localnet.context.generateAccount({ initialFunds: (50).algo() })
    const factory = localnet.algorand.client.getTypedAppFactory(AlgoSafeFactory, {
      defaultSender: deployer,
    })
    const { appClient } = await factory.send.create.createApplication({
      args: { name: 'Test Safe' },
      suppressLog: true,
    })
    // Fund the app account for box MBR and inner-transaction payments.
    await localnet.algorand.send.payment({
      amount: (5).algo(),
      sender: deployer,
      receiver: appClient.appAddress,
      suppressLog: true,
    })
    return { client: appClient, deployer }
  }

  const deployAndBootstrap = async () => {
    const { client, deployer } = await deploy()
    await client.send.bootstrap({ args: { groupName: 'Admins' }, suppressLog: true })
    return { client, deployer }
  }

  const execParams = { coverAppCallInnerTransactionFees: true, maxFee: (0.02).algo(), suppressLog: true }

  /** Propose an admin change from the (1-of-1) admin group and execute it. */
  const governAdminChange = async (client: AlgoSafeClient, adminGroupId: bigint, change: AdminChange) => {
    const { return: pid } = await client.send.proposeAdminChange({
      args: { groupId: adminGroupId, change, expiryRound: FAR_EXPIRY },
      suppressLog: true,
    })
    await client.send.executeProposal({ args: { proposalId: pid! }, ...execParams })
    return pid!
  }

  const currentRound = async () => (await localnet.algorand.client.algod.status().do()).lastRound

  const createBareNoOpApp = async (sender: algosdk.Account) => {
    const algod = localnet.algorand.client.algod
    const approval = await algod.compile(Buffer.from('#pragma version 10\nint 1')).do()
    const clear = await algod.compile(Buffer.from('#pragma version 10\nint 1')).do()
    const suggestedParams = await algod.getTransactionParams().do()
    const createTxn = algosdk.makeApplicationCreateTxnFromObject({
      sender: sender.addr,
      suggestedParams,
      onComplete: algosdk.OnApplicationComplete.NoOpOC,
      approvalProgram: new Uint8Array(Buffer.from(approval.result, 'base64')),
      clearProgram: new Uint8Array(Buffer.from(clear.result, 'base64')),
      numLocalInts: 0,
      numLocalByteSlices: 0,
      numGlobalInts: 0,
      numGlobalByteSlices: 0,
    })
    const signed = algosdk.signTransaction(createTxn, sender.sk)
    await algod.sendRawTransaction(signed.blob).do()
    const confirmed = await algosdk.waitForConfirmation(algod, signed.txID, 4)
    return BigInt(confirmed.applicationIndex!)
  }

  // -------------------------------------------------------------------------

  test('initialises config and bootstraps the genesis admin group', async () => {
    const { client, deployer } = await deployAndBootstrap()

    const config = await client.send.getConfig({ args: {}, suppressLog: true })
    const [name, groupCount, nextGroupId, nextProposalId, paused, version] = config.return!
    expect(name).toBe('Test Safe')
    expect(groupCount).toBe(1n)
    expect(nextGroupId).toBe(2n)
    expect(nextProposalId).toBe(1n)
    expect(paused).toBe(0n)
    expect(version).toBe(1n)

    const group = await client.send.getSignerGroup({ args: { groupId: 1n }, suppressLog: true })
    expect(group.return!.threshold).toBe(1n)
    expect(group.return!.memberCount).toBe(1n)
    expect(group.return!.adminPrivileges).toBe(PRIV_ALL)
    expect(group.return!.allowedActions).toBe(ACT_ALL)

    const isMember = await client.send.isMember({
      args: { groupId: 1n, account: deployer.toString() },
      suppressLog: true,
    })
    expect(isMember.return).toBe(true)
  })

  test('bootstrap can only be called once and only by the creator', async () => {
    const { client } = await deployAndBootstrap()

    await expect(client.send.bootstrap({ args: { groupName: 'Again' }, suppressLog: true })).rejects.toThrow()

    const stranger = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    await expect(
      client.send.bootstrap({ args: { groupName: 'X' }, sender: stranger, suppressLog: true }),
    ).rejects.toThrow()
  })

  test('executes an ALGO payment proposal (1-of-1) end to end', async () => {
    const { client } = await deployAndBootstrap()
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    const { return: pid } = await client.send.proposePayment({
      args: { groupId: 1n, payload: mkPayment(recipient.toString(), (1).algo().microAlgo), expiryRound: FAR_EXPIRY },
      suppressLog: true,
    })

    // Proposer auto-approves; 1-of-1 becomes ready immediately.
    const proposal = await client.send.getProposal({ args: { proposalId: pid! }, suppressLog: true })
    expect(proposal.return!.approvalsCount).toBe(1n)
    expect(proposal.return!.status).toBe(2n) // READY

    await client.send.executeProposal({ args: { proposalId: pid! }, ...execParams })

    const recipInfo = await localnet.algorand.account.getInformation(recipient)
    expect(recipInfo.balance.microAlgo).toBe((1).algo().microAlgo)

    const after = await client.send.getProposal({ args: { proposalId: pid! }, suppressLog: true })
    expect(after.return!.status).toBe(3n) // EXECUTED
  })

  test('approves and executes a mixed ordered payment plus app-call transaction group', async () => {
    const { client, deployer } = await deployAndBootstrap()
    const targetAppId = await createBareNoOpApp(deployer)
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    const payload = txGroup([
      safePayment(recipient.toString(), (0.25).algo().microAlgo, 'first'),
      safeAppCall(targetAppId, [new TextEncoder().encode('second')]),
    ])

    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 1n, payload, expiryRound: FAR_EXPIRY },
      suppressLog: true,
    })

    const stored = await client.send.getTransactionGroup({ args: { proposalId: pid! }, suppressLog: true })
    expect(stored.return!.count).toBe(2n)
    expect(stored.return!.tx0.txType).toBe(TX_PAYMENT)
    expect(stored.return!.tx1.txType).toBe(TX_APP)

    await client.send.executeProposal({ args: { proposalId: pid! }, ...execParams })

    const recipInfo = await localnet.algorand.account.getInformation(recipient)
    expect(recipInfo.balance.microAlgo).toBe((0.25).algo().microAlgo)
  })

  test('groups several app calls into one safe approval and execution transaction', async () => {
    const { client, deployer } = await deployAndBootstrap()
    const targetAppId = await createBareNoOpApp(deployer)
    const encoder = new TextEncoder()

    const { return: pid } = await client.send.proposeTransactionGroup({
      args: {
        groupId: 1n,
        payload: txGroup([
          safeAppCall(targetAppId, [encoder.encode('app-call-1')]),
          safeAppCall(targetAppId, [encoder.encode('app-call-2')]),
          safeAppCall(targetAppId, [encoder.encode('app-call-3')]),
        ]),
        expiryRound: FAR_EXPIRY,
      },
      suppressLog: true,
    })

    const stored = await client.send.getTransactionGroup({ args: { proposalId: pid! }, suppressLog: true })
    expect(stored.return!.count).toBe(3n)
    expect(stored.return!.tx0.appId).toBe(targetAppId)
    expect(stored.return!.tx1.appId).toBe(targetAppId)
    expect(stored.return!.tx2.appId).toBe(targetAppId)

    await client.send.executeProposal({ args: { proposalId: pid! }, ...execParams })

    const after = await client.send.getProposal({ args: { proposalId: pid! }, suppressLog: true })
    expect(after.return!.status).toBe(3n) // EXECUTED
  })

  test('cannot execute a proposal twice', async () => {
    const { client } = await deployAndBootstrap()
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    const { return: pid } = await client.send.proposePayment({
      args: { groupId: 1n, payload: mkPayment(recipient.toString(), (1).algo().microAlgo), expiryRound: FAR_EXPIRY },
      suppressLog: true,
    })
    await client.send.executeProposal({ args: { proposalId: pid! }, ...execParams })
    await expect(client.send.executeProposal({ args: { proposalId: pid! }, ...execParams })).rejects.toThrow()
  })

  test('creates a multisig group through governance and requires M-of-N approvals', async () => {
    const { client } = await deployAndBootstrap()

    const a = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const b = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    // Admins create a Treasury group starting with member A.
    await governAdminChange(
      client,
      1n,
      mkAdminChange({
        changeType: ADM_CREATE_GROUP,
        groupName: 'Treasury',
        threshold: 1n,
        memberAddr: a.toString(),
        allowedActions: ACT_PAY,
        adminPrivileges: 0n,
      }),
    )
    // Add member B and raise threshold to 2-of-2.
    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_ADD_MEMBER, targetGroupId: 2n, memberAddr: b.toString() }),
    )
    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_CHANGE_THRESHOLD, targetGroupId: 2n, threshold: 2n }),
    )

    const group = await client.send.getSignerGroup({ args: { groupId: 2n }, suppressLog: true })
    expect(group.return!.memberCount).toBe(2n)
    expect(group.return!.threshold).toBe(2n)

    // Member A proposes a payment (auto-approve = 1 of 2).
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })
    const { return: pid } = await client.send.proposePayment({
      args: { groupId: 2n, payload: mkPayment(recipient.toString(), (1).algo().microAlgo), expiryRound: FAR_EXPIRY },
      sender: a,
      suppressLog: true,
    })

    // Not enough approvals yet.
    await expect(
      client.send.executeProposal({ args: { proposalId: pid! }, sender: a, ...execParams }),
    ).rejects.toThrow()

    // Member B approves (2 of 2), now executable.
    await client.send.approveProposal({ args: { proposalId: pid! }, sender: b, suppressLog: true })
    await client.send.executeProposal({ args: { proposalId: pid! }, sender: b, ...execParams })

    const recipInfo = await localnet.algorand.account.getInformation(recipient)
    expect(recipInfo.balance.microAlgo).toBe((1).algo().microAlgo)
  })

  test('rejects approvals from non-members and duplicate approvals', async () => {
    const { client } = await deployAndBootstrap()
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    const { return: pid } = await client.send.proposePayment({
      args: { groupId: 1n, payload: mkPayment(recipient.toString(), (1).algo().microAlgo), expiryRound: FAR_EXPIRY },
      suppressLog: true,
    })

    const stranger = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    await expect(
      client.send.approveProposal({ args: { proposalId: pid! }, sender: stranger, suppressLog: true }),
    ).rejects.toThrow()

    // Proposer already auto-approved, so approving again must fail.
    await expect(client.send.approveProposal({ args: { proposalId: pid! }, suppressLog: true })).rejects.toThrow()
  })

  test('rejects proposals from non-members', async () => {
    const { client } = await deployAndBootstrap()
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })
    const stranger = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    await expect(
      client.send.proposePayment({
        args: { groupId: 1n, payload: mkPayment(recipient.toString(), (1).algo().microAlgo), expiryRound: FAR_EXPIRY },
        sender: stranger,
        suppressLog: true,
      }),
    ).rejects.toThrow()
  })

  test('opts the safe into an ASA and transfers it under governance', async () => {
    const { client, deployer } = await deployAndBootstrap()

    // Create an ASA owned by the deployer account.
    const createAsset = await localnet.algorand.send.assetCreate({
      sender: deployer,
      total: 1_000_000n,
      decimals: 0,
      unitName: 'TST',
      assetName: 'Test ASA',
      suppressLog: true,
    })
    const assetId = createAsset.assetId

    // Safe opts in (axfer amount 0 to itself).
    const { return: optInPid } = await client.send.proposeAssetTransfer({
      args: {
        groupId: 1n,
        payload: {
          xferAsset: assetId,
          assetReceiver: client.appAddress.toString(),
          assetAmount: 0n,
          hasClose: 0n,
          assetCloseTo: ZERO_ADDR,
          note: '',
        },
        expiryRound: FAR_EXPIRY,
      },
      suppressLog: true,
    })
    await client.send.executeProposal({ args: { proposalId: optInPid! }, ...execParams })

    // Fund the safe with 500 units.
    await localnet.algorand.send.assetTransfer({
      sender: deployer,
      receiver: client.appAddress,
      assetId,
      amount: 500n,
      suppressLog: true,
    })

    // Recipient opts in, then the safe sends 100 units via governance.
    const recipient = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    await localnet.algorand.send.assetOptIn({ sender: recipient, assetId, suppressLog: true })

    const { return: xferPid } = await client.send.proposeAssetTransfer({
      args: {
        groupId: 1n,
        payload: {
          xferAsset: assetId,
          assetReceiver: recipient.toString(),
          assetAmount: 100n,
          hasClose: 0n,
          assetCloseTo: ZERO_ADDR,
          note: '',
        },
        expiryRound: FAR_EXPIRY,
      },
      suppressLog: true,
    })
    await client.send.executeProposal({ args: { proposalId: xferPid! }, ...execParams })

    const info = await localnet.algorand.account.getInformation(recipient)
    const held = info.assets?.find((a) => a.assetId === assetId)
    expect(held?.amount).toBe(100n)
  })

  test('enforces daily spending limits on a constrained group', async () => {
    const { client } = await deployAndBootstrap()
    const agent = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    // Create an agent group with a 1 ALGO daily limit, pay-only.
    await governAdminChange(
      client,
      1n,
      mkAdminChange({
        changeType: ADM_CREATE_GROUP,
        groupName: 'Agent',
        threshold: 1n,
        memberAddr: agent.toString(),
        allowedActions: ACT_PAY,
        adminPrivileges: 0n,
        dailyLimit: (1).algo().microAlgo,
      }),
    )

    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    // A payment within the limit succeeds and records usage.
    const { return: okPid } = await client.send.proposePayment({
      args: { groupId: 2n, payload: mkPayment(recipient.toString(), (0.4).algo().microAlgo), expiryRound: FAR_EXPIRY },
      sender: agent,
      suppressLog: true,
    })
    await client.send.executeProposal({ args: { proposalId: okPid! }, sender: agent, ...execParams })

    const group = await client.send.getSignerGroup({ args: { groupId: 2n }, suppressLog: true })
    expect(group.return!.dailyUsage).toBe((0.4).algo().microAlgo)

    // A payment exceeding the remaining limit is rejected at execution.
    const { return: badPid } = await client.send.proposePayment({
      args: { groupId: 2n, payload: mkPayment(recipient.toString(), (0.8).algo().microAlgo), expiryRound: FAR_EXPIRY },
      sender: agent,
      suppressLog: true,
    })
    await expect(
      client.send.executeProposal({ args: { proposalId: badPid! }, sender: agent, ...execParams }),
    ).rejects.toThrow()
  })

  test('blocks a disallowed action for the proposing group', async () => {
    const { client } = await deployAndBootstrap()
    const agent = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    // Agent group may only do axfer, not pay.
    await governAdminChange(
      client,
      1n,
      mkAdminChange({
        changeType: ADM_CREATE_GROUP,
        groupName: 'AxferOnly',
        threshold: 1n,
        memberAddr: agent.toString(),
        allowedActions: ACT_AXFER,
        adminPrivileges: 0n,
      }),
    )

    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })
    await expect(
      client.send.proposePayment({
        args: { groupId: 2n, payload: mkPayment(recipient.toString(), (1).algo().microAlgo), expiryRound: FAR_EXPIRY },
        sender: agent,
        suppressLog: true,
      }),
    ).rejects.toThrow()
  })

  test('removes a member through governance', async () => {
    const { client } = await deployAndBootstrap()
    const a = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const b = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    await governAdminChange(
      client,
      1n,
      mkAdminChange({
        changeType: ADM_CREATE_GROUP,
        groupName: 'Ops',
        threshold: 1n,
        memberAddr: a.toString(),
        allowedActions: ACT_PAY,
        adminPrivileges: PRIV_GROUP,
      }),
    )
    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_ADD_MEMBER, targetGroupId: 2n, memberAddr: b.toString() }),
    )

    let group = await client.send.getSignerGroup({ args: { groupId: 2n }, suppressLog: true })
    expect(group.return!.memberCount).toBe(2n)

    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_REMOVE_MEMBER, targetGroupId: 2n, memberAddr: b.toString() }),
    )
    group = await client.send.getSignerGroup({ args: { groupId: 2n }, suppressLog: true })
    expect(group.return!.memberCount).toBe(1n)

    const stillMember = await client.send.isMember({
      args: { groupId: 2n, account: b.toString() },
      suppressLog: true,
    })
    expect(stillMember.return).toBe(false)
  })

  test('cancels a pending proposal', async () => {
    const { client } = await deployAndBootstrap()
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    const { return: pid } = await client.send.proposePayment({
      args: { groupId: 1n, payload: mkPayment(recipient.toString(), (1).algo().microAlgo), expiryRound: FAR_EXPIRY },
      suppressLog: true,
    })
    await client.send.cancelProposal({ args: { proposalId: pid! }, suppressLog: true })

    const proposal = await client.send.getProposal({ args: { proposalId: pid! }, suppressLog: true })
    expect(proposal.return!.status).toBe(4n) // CANCELLED

    // A cancelled proposal cannot be executed.
    await expect(client.send.executeProposal({ args: { proposalId: pid! }, ...execParams })).rejects.toThrow()
  })

  test('rejects proposals whose expiry is not in the future', async () => {
    const { client } = await deployAndBootstrap()
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    const round = await currentRound()
    await expect(
      client.send.proposePayment({
        args: { groupId: 1n, payload: mkPayment(recipient.toString(), (1).algo().microAlgo), expiryRound: round },
        suppressLog: true,
      }),
    ).rejects.toThrow()
  })
})
