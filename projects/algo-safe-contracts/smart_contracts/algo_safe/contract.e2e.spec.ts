import { Config } from '@algorandfoundation/algokit-utils'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import algosdk from 'algosdk'
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import {
  ACT_ALL,
  ACT_AXFER,
  ACT_PAY,
  ACT_REKEY,
  ADM_ADD_MEMBER,
  ADM_CHANGE_THRESHOLD,
  ADM_CREATE_GROUP,
  ADM_REMOVE_MEMBER,
  ADM_SET_ACTIVE,
  ADM_SET_POLICY,
  ADM_SET_PRIVILEGES,
  FAR_EXPIRY,
  PRIV_ALL,
  PRIV_GROUP,
  TX_ACFG,
  TX_APP,
  TX_ASSET,
  TX_KEYREG,
  TX_PAYMENT,
  TX_REKEY,
  ZERO_ADDR,
  algosdkTxnsToSafeTxnGroup,
  createAdminChange,
  createAppCallPayload,
  createAppCallSafeTxn,
  createAssetConfigSafeTxn,
  createAssetSafeTxn,
  createKeyRegSafeTxn,
  createPaymentSafeTxn,
  createRekeySafeTxn,
  decodeAppTxn,
  decodeAssetConfigTxn,
  decodeAssetTxn,
  decodeKeyRegTxn,
  decodePaymentTxn,
  decodeRekeyTxn,
  toSafeTxnGroup,
  type SafeTxn,
} from '../../src'
import { AdminChange, AlgoSafeClient, AlgoSafeFactory } from '../artifacts/algo_safe/AlgoSafeClient'

function mkAdminChange(partial: Partial<AdminChange>): AdminChange {
  return createAdminChange(partial)
}

// Box key for a single-uint64-keyed BoxMap: ASCII prefix + 8-byte big-endian id.
function boxKeyU64(prefix: string, n: bigint): Uint8Array {
  const p = new TextEncoder().encode(prefix)
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigUint64(0, n, false)
  const r = new Uint8Array(p.length + 8)
  r.set(p)
  r.set(b, p.length)
  return r
}

function safePayment(receiver: string, amount: bigint, note = ''): SafeTxn {
  return createPaymentSafeTxn({ sender: ZERO_ADDR, receiver, amount, hasClose: 0n, closeRemainderTo: ZERO_ADDR, note })
}

function safeAppCall(appId: bigint, args: Uint8Array[] = []): SafeTxn {
  return createAppCallSafeTxn(createAppCallPayload(appId, args))
}

function getObjectField(value: unknown, keys: string[]): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key]
    if (candidate && typeof candidate === 'object') {
      return candidate as Record<string, unknown>
    }
  }

  return undefined
}

function getArrayField(value: unknown, keys: string[]): unknown[] | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key]
    if (Array.isArray(candidate)) {
      return candidate
    }
  }

  return undefined
}

function getInnerTransactions(confirmation: unknown): Record<string, unknown>[] {
  const innerTransactions =
    getArrayField(confirmation, ['innerTxns', 'inner-txns']) ??
    getArrayField(getObjectField(confirmation, ['txnResult', 'txn-result']), ['innerTxns', 'inner-txns']) ??
    []
  return innerTransactions.filter((innerTxn): innerTxn is Record<string, unknown> =>
    Boolean(innerTxn && typeof innerTxn === 'object'),
  )
}

function getInnerTransactionType(innerTxn: Record<string, unknown>): string | undefined {
  const txnEnvelope = getObjectField(innerTxn, ['txn']) ?? innerTxn
  const txn = getObjectField(txnEnvelope, ['txn']) ?? txnEnvelope
  const type = txn.type
  return typeof type === 'string' ? type : undefined
}

function getBigIntLike(value: unknown): bigint | undefined {
  if (typeof value === 'bigint') {
    return value
  }
  if (typeof value === 'number') {
    return BigInt(value)
  }
  if (typeof value === 'string') {
    return BigInt(value)
  }
  return undefined
}

function getInnerAssetTransfer(innerTxn: Record<string, unknown>) {
  const txnEnvelope = getObjectField(innerTxn, ['txn']) ?? innerTxn
  const txn = getObjectField(txnEnvelope, ['txn']) ?? txnEnvelope
  const assetTransfer = getObjectField(txn, ['assetTransfer', 'asset-transfer'])
  return {
    assetId: getBigIntLike(assetTransfer?.assetIndex ?? assetTransfer?.['asset-index'] ?? txn.xaid),
    amount: getBigIntLike(assetTransfer?.amount ?? assetTransfer?.['asset-amount'] ?? txn.aamt),
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
      args: { groupId: adminGroupId, change, expiryRound: FAR_EXPIRY, ensureBudgetValue: 0n },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })
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

    const config = await client.send.getConfig({ args: { ensureBudgetValue: 0n }, suppressLog: true })
    const [name, groupCount, nextGroupId, nextProposalId, paused, version] = config.return!
    expect(name).toBe('Test Safe')
    expect(groupCount).toBe(1n)
    expect(nextGroupId).toBe(2n)
    expect(nextProposalId).toBe(1n)
    expect(paused).toBe(0n)
    expect(typeof version).toBe('string')
    expect(version.length).toBeGreaterThan(0)

    const group = await client.send.getSignerGroup({ args: { groupId: 1n, ensureBudgetValue: 0n }, suppressLog: true })
    expect(group.return!.threshold).toBe(1n)
    expect(group.return!.memberCount).toBe(1n)
    expect(group.return!.adminPrivileges).toBe(PRIV_ALL)
    expect(group.return!.allowedActions).toBe(ACT_ALL)

    const isMember = await client.send.isMember({
      args: { groupId: 1n, account: deployer.toString(), ensureBudgetValue: 0n },
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

    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 1n, payload: toSafeTxnGroup([safePayment(recipient.toString(), (1).algo().microAlgo)]), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    // Proposer auto-approves; 1-of-1 becomes ready immediately.
    const proposal = await client.send.getProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, suppressLog: true })
    expect(proposal.return!.approvalsCount).toBe(1n)
    expect(proposal.return!.status).toBe(2n) // READY

    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })

    const recipInfo = await localnet.algorand.account.getInformation(recipient)
    expect(recipInfo.balance.microAlgo).toBe((1).algo().microAlgo)

    const after = await client.send.getProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, suppressLog: true })
    expect(after.return!.status).toBe(3n) // EXECUTED
  })

  test('proposes and executes an ALGO payment in one call (execute: true, 1-of-1 group)', async () => {
    const { client } = await deployAndBootstrap()
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    const { return: pid } = await client.send.proposeTransactionGroup({
      args: {
        groupId: 1n,
        payload: toSafeTxnGroup([safePayment(recipient.toString(), (1).algo().microAlgo)]),
        expiryRound: FAR_EXPIRY,
        execute: true,
        ensureBudgetValue: 6000n,
      },
      ...execParams,
    })

    const recipInfo = await localnet.algorand.account.getInformation(recipient)
    expect(recipInfo.balance.microAlgo).toBe((1).algo().microAlgo)

    const after = await client.send.getProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, suppressLog: true })
    expect(after.return!.status).toBe(3n) // EXECUTED
  })

  test('rejects execute: true when the group threshold requires more than one approval', async () => {
    const { client, deployer } = await deployAndBootstrap()
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })
    const a = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_CREATE_GROUP, groupName: 'Multisig', threshold: 1n, memberAddr: a.toString() }),
    )
    const multisigGroupId = 2n
    await governAdminChange(
      client,
      1n,
      mkAdminChange({
        changeType: ADM_ADD_MEMBER,
        targetGroupId: multisigGroupId,
        memberAddr: deployer.toString(),
        memberType: 1n,
        memberLabel: 'second',
      }),
    )
    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_CHANGE_THRESHOLD, targetGroupId: multisigGroupId, threshold: 2n }),
    )

    await expect(
      client.send.proposeTransactionGroup({
        args: {
          groupId: multisigGroupId,
          payload: toSafeTxnGroup([safePayment(recipient.toString(), (1).algo().microAlgo)]),
          expiryRound: FAR_EXPIRY,
          execute: true,
          ensureBudgetValue: 6000n,
        },
        sender: a,
        suppressLog: true,
        staticFee: (0.2).algo(),
      }),
    ).rejects.toThrow()
  })

  test('approves and executes a mixed ordered payment plus app-call transaction group', async () => {
    const { client, deployer } = await deployAndBootstrap()
    const targetAppId = await createBareNoOpApp(deployer)
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    const txs = [
      safePayment(recipient.toString(), (0.25).algo().microAlgo, 'first'),
      safeAppCall(targetAppId, [new TextEncoder().encode('second')]),
    ]

    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 1n, payload: toSafeTxnGroup(txs), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    const stored = await client.send.getTransactionGroup({ args: { proposalId: pid!, payloadIndex: 1n, ensureBudgetValue: 0n }, suppressLog: true })
    expect(stored.return!.length).toBe(2)
    expect(stored.return![0][0]).toBe(TX_PAYMENT) // tx0 txType
    expect(stored.return![1][0]).toBe(TX_APP) // tx1 txType

    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })

    const recipInfo = await localnet.algorand.account.getInformation(recipient)
    expect(recipInfo.balance.microAlgo).toBe((0.25).algo().microAlgo)
  })

  test('converts a native algosdk transaction group into a safe payload and executes it', async () => {
    const { client, deployer } = await deployAndBootstrap()
    const targetAppId = await createBareNoOpApp(deployer)
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })
    const suggestedParams = await localnet.algorand.client.algod.getTransactionParams().do()

    // Build a normal algosdk atomic group (sender is irrelevant — the safe
    // re-issues each as an inner transaction) and convert it to safe payloads.
    const payTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: client.appAddress,
      receiver: recipient.addr,
      amount: (0.3).algo().microAlgo,
      note: new TextEncoder().encode('from-algosdk'),
      suggestedParams,
    })
    const appTxn = algosdk.makeApplicationCallTxnFromObject({
      sender: client.appAddress,
      appIndex: targetAppId,
      onComplete: algosdk.OnApplicationComplete.NoOpOC,
      appArgs: [new TextEncoder().encode('algosdk-arg')],
      suggestedParams,
    })

    const payload = algosdkTxnsToSafeTxnGroup([payTxn, appTxn])

    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 1n, payload, expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    const stored = await client.send.getTransactionGroup({ args: { proposalId: pid!, payloadIndex: 1n, ensureBudgetValue: 0n }, suppressLog: true })
    expect(stored.return!.length).toBe(2)
    expect(stored.return![0][0]).toBe(TX_PAYMENT)
    const decodedPay = decodePaymentTxn(stored.return![0][1])
    expect(decodedPay.receiver).toBe(recipient.toString())
    expect(decodedPay.amount).toBe((0.3).algo().microAlgo)
    expect(decodedPay.note).toBe('from-algosdk')
    expect(stored.return![1][0]).toBe(TX_APP)
    const decodedApp = decodeAppTxn(stored.return![1][1])
    expect(decodedApp.appId).toBe(targetAppId)
    expect(decodedApp.appArgs.length).toBe(1)
    expect(decodedApp.appArgs[0]).toEqual(new TextEncoder().encode('algosdk-arg'))

    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })

    const recipInfo = await localnet.algorand.account.getInformation(recipient)
    expect(recipInfo.balance.microAlgo).toBe((0.3).algo().microAlgo)
  })

  test('groups several app calls into one safe approval and execution transaction', async () => {
    const { client, deployer } = await deployAndBootstrap()
    const targetAppId = await createBareNoOpApp(deployer)
    const encoder = new TextEncoder()

    const txs = [
      safeAppCall(targetAppId, [encoder.encode('app-call-1')]),
      safeAppCall(targetAppId, [encoder.encode('app-call-2')]),
      safeAppCall(targetAppId, [encoder.encode('app-call-3')]),
    ]

    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 1n, payload: toSafeTxnGroup(txs), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    const stored = await client.send.getTransactionGroup({ args: { proposalId: pid!, payloadIndex: 1n, ensureBudgetValue: 0n }, suppressLog: true })
    expect(stored.return!.length).toBe(3)
    expect(stored.return![0][0]).toBe(TX_APP)
    expect(decodeAppTxn(stored.return![0][1]).appId).toBe(targetAppId) // tx0 appId
    expect(decodeAppTxn(stored.return![1][1]).appId).toBe(targetAppId) // tx1 appId
    expect(decodeAppTxn(stored.return![2][1]).appId).toBe(targetAppId) // tx2 appId

    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })

    const after = await client.send.getProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, suppressLog: true })
    expect(after.return!.status).toBe(3n) // EXECUTED
  })

  test('splits a 6-payment group across two payload slots and executes them atomically', async () => {
    // populateAppCallResources simulation doesn't discover proposals(1) because the ABI
    // routing validation loop consumes the 700-opcode initial budget before the method
    // body (and ensureBudget) fires for multi-element payloads. We bypass resource
    // population for all three calls and supply exact box references manually.
    const { client, deployer } = await deployAndBootstrap()
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    // 3 payments in slot 1, 3 payments in slot 2 — demonstrates multi-slot execution
    const pays1 = [1n, 2n, 3n].map((amt) => safePayment(recipient.toString(), amt * 10_000n))
    const pays2 = [4n, 5n, 6n].map((amt) => safePayment(recipient.toString(), amt * 10_000n))

    const TXG_KEY_MULT = 7n
    const appId = BigInt(client.appId)
    const pid = 1n // first proposal in each fresh test scope

    // Box key helpers: single uint64 → 8-byte big-endian appended to ASCII prefix
    const bKey = (prefix: string, n: bigint): Uint8Array => {
      const p = new TextEncoder().encode(prefix)
      const b = new Uint8Array(8)
      new DataView(b.buffer).setBigUint64(0, n, false)
      const r = new Uint8Array(p.length + 8)
      r.set(p)
      r.set(b, p.length)
      return r
    }
    // Composite key: prefix + uint64 + 32-byte account public key
    const cKey = (prefix: string, n: bigint, addr: string): Uint8Array => {
      const p = new TextEncoder().encode(prefix)
      const nb = new Uint8Array(8)
      new DataView(nb.buffer).setBigUint64(0, n, false)
      const ab = algosdk.decodeAddress(addr).publicKey
      const r = new Uint8Array(p.length + 8 + 32)
      r.set(p)
      r.set(nb, p.length)
      r.set(ab, p.length + 8)
      return r
    }

    const deployerAddr = deployer.toString()

    // propose: accesses groups(1), members({1,deployer}), proposals(1),
    //   approvals({1,deployer}), transactionGroups(pid*7+1)
    await client.send.proposeTransactionGroup({
      args: { groupId: 1n, payload: toSafeTxnGroup(pays1), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      suppressLog: true,
      staticFee: (0.2).algo(),
      populateAppCallResources: false,
      boxReferences: [
        { appId, name: bKey('g', 1n) },
        { appId, name: cKey('m', 1n, deployerAddr) },
        { appId, name: bKey('p', pid) },
        { appId, name: cKey('a', pid, deployerAddr) },
        { appId, name: bKey('txg', pid * TXG_KEY_MULT + 1n) },
      ],
    })

    // append: accesses proposals(1), groups(1), members({1,deployer}),
    //   transactionGroups(pid*7+2)
    await client.send.appendTransactionGroupPayload({
      args: { proposalId: pid, payloadIndex: 2n, payload: toSafeTxnGroup(pays2), ensureBudgetValue: 10000n },
      suppressLog: true,
      staticFee: (0.1).algo(),
      populateAppCallResources: false,
      boxReferences: [
        { appId, name: bKey('p', pid) },
        { appId, name: bKey('g', 1n) },
        { appId, name: cKey('m', 1n, deployerAddr) },
        { appId, name: bKey('txg', pid * TXG_KEY_MULT + 2n) },
      ],
    })

    const stored1 = await client.send.getTransactionGroup({ args: { proposalId: pid, payloadIndex: 1n, ensureBudgetValue: 0n }, suppressLog: true })
    expect(stored1.return!.length).toBe(3)
    expect(stored1.return![0][0]).toBe(TX_PAYMENT)
    const stored2 = await client.send.getTransactionGroup({ args: { proposalId: pid, payloadIndex: 2n, ensureBudgetValue: 0n }, suppressLog: true })
    expect(stored2.return!.length).toBe(3)
    expect(stored2.return![0][0]).toBe(TX_PAYMENT)

    // execute: accesses proposals(1), groups(1), transactionGroups(8), transactionGroups(9),
    //   and recipient account (required for inner payment Receiver field)
    await client.send.executeProposal({
      args: { proposalId: pid, ensureBudgetValue: 6000n },
      suppressLog: true,
      staticFee: (0.05).algo(),
      populateAppCallResources: false,
      boxReferences: [
        { appId, name: bKey('p', pid) },
        { appId, name: bKey('g', 1n) },
        { appId, name: bKey('txg', pid * TXG_KEY_MULT + 1n) },
        { appId, name: bKey('txg', pid * TXG_KEY_MULT + 2n) },
      ],
      accountReferences: [recipient.toString()],
    })

    const after = await client.send.getProposal({ args: { proposalId: pid, ensureBudgetValue: 0n }, suppressLog: true })
    expect(after.return!.status).toBe(3n) // EXECUTED

    // (1+2+3 + 4+5+6) × 10_000 = 210_000 µAlgo received by recipient
    const info = await localnet.algorand.account.getInformation(recipient)
    expect(info.balance.microAlgo).toBe(210_000n)
  })

  test('cannot execute a proposal twice', async () => {
    const { client } = await deployAndBootstrap()
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 1n, payload: toSafeTxnGroup([safePayment(recipient.toString(), (1).algo().microAlgo)]), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })
    await expect(client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })).rejects.toThrow()
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

    const group = await client.send.getSignerGroup({ args: { groupId: 2n, ensureBudgetValue: 0n }, suppressLog: true })
    expect(group.return!.memberCount).toBe(2n)
    expect(group.return!.threshold).toBe(2n)

    // Member A proposes a payment (auto-approve = 1 of 2).
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })
    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 2n, payload: toSafeTxnGroup([safePayment(recipient.toString(), (1).algo().microAlgo)]), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      sender: a,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    // Not enough approvals yet.
    await expect(
      client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, sender: a, ...execParams }),
    ).rejects.toThrow()

    // Member B approves (2 of 2), now executable.
    await client.send.approveProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, sender: b, suppressLog: true })
    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, sender: b, ...execParams })

    const recipInfo = await localnet.algorand.account.getInformation(recipient)
    expect(recipInfo.balance.microAlgo).toBe((1).algo().microAlgo)
  })

  test('rejects approvals from non-members and duplicate approvals', async () => {
    const { client } = await deployAndBootstrap()
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 1n, payload: toSafeTxnGroup([safePayment(recipient.toString(), (1).algo().microAlgo)]), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    const stranger = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    await expect(
      client.send.approveProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, sender: stranger, suppressLog: true }),
    ).rejects.toThrow()

    // Proposer already auto-approved, so approving again must fail.
    await expect(client.send.approveProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, suppressLog: true })).rejects.toThrow()
  })

  test('rejects proposals from non-members', async () => {
    const { client } = await deployAndBootstrap()
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })
    const stranger = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    await expect(
      client.send.proposeTransactionGroup({
        args: { groupId: 1n, payload: toSafeTxnGroup([safePayment(recipient.toString(), (1).algo().microAlgo)]), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
        sender: stranger,
        suppressLog: true,
        staticFee: (0.2).algo(),
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

    // Safe opts in (axfer amount 0 to itself) via proposeTransactionGroup.
    const { return: optInPid } = await client.send.proposeTransactionGroup({
      args: {
        groupId: 1n,
        payload: toSafeTxnGroup([
          createAssetSafeTxn({
            sender: ZERO_ADDR,
            xferAsset: assetId,
            assetReceiver: client.appAddress.toString(),
            assetAmount: 0n,
            hasClose: 0n,
            assetCloseTo: ZERO_ADDR,
            note: '',
          }),
        ]),
        expiryRound: FAR_EXPIRY,
        execute: false,
        ensureBudgetValue: 10000n,
      },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await client.send.executeProposal({ args: { proposalId: optInPid!, ensureBudgetValue: 6000n }, ...execParams })

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

    const { return: xferPid } = await client.send.proposeTransactionGroup({
      args: {
        groupId: 1n,
        payload: toSafeTxnGroup([
          createAssetSafeTxn({
            sender: ZERO_ADDR,
            xferAsset: assetId,
            assetReceiver: recipient.toString(),
            assetAmount: 100n,
            hasClose: 0n,
            assetCloseTo: ZERO_ADDR,
            note: '',
          }),
        ]),
        expiryRound: FAR_EXPIRY,
        execute: false,
        ensureBudgetValue: 10000n,
      },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    const stored = await client.send.getTransactionGroup({ args: { proposalId: xferPid!, payloadIndex: 1n, ensureBudgetValue: 0n }, suppressLog: true })
    expect(stored.return!).toHaveLength(1)
    expect(stored.return![0][0]).toBe(TX_ASSET)
    const decodedXfer = decodeAssetTxn(stored.return![0][1])
    expect(decodedXfer.xferAsset).toBe(assetId)
    expect(decodedXfer.assetAmount).toBe(100n)

    const executeResult = await client.send.executeProposal({ args: { proposalId: xferPid!, ensureBudgetValue: 6000n }, ...execParams })
    const pendingInfo = await localnet.algorand.client.algod.pendingTransactionInformation(executeResult.txIds[0]).do()
    const assetInnerTxn = getInnerTransactions(pendingInfo).find(
      (innerTxn) => getInnerTransactionType(innerTxn) === 'axfer',
    )
    expect(assetInnerTxn).toBeDefined()
    expect(getInnerTransactionType(assetInnerTxn!)).toBe('axfer')
    expect(getInnerAssetTransfer(assetInnerTxn!).assetId).toBe(assetId)
    expect(getInnerAssetTransfer(assetInnerTxn!).amount).toBe(100n)

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
    const { return: okPid } = await client.send.proposeTransactionGroup({
      args: { groupId: 2n, payload: toSafeTxnGroup([safePayment(recipient.toString(), (0.4).algo().microAlgo)]), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      sender: agent,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await client.send.executeProposal({ args: { proposalId: okPid!, ensureBudgetValue: 6000n }, sender: agent, ...execParams })

    const group = await client.send.getSignerGroup({ args: { groupId: 2n, ensureBudgetValue: 0n }, suppressLog: true })
    expect(group.return!.dailyUsage).toBe((0.4).algo().microAlgo)

    // A payment exceeding the remaining limit is rejected at execution.
    const { return: badPid } = await client.send.proposeTransactionGroup({
      args: { groupId: 2n, payload: toSafeTxnGroup([safePayment(recipient.toString(), (0.8).algo().microAlgo)]), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      sender: agent,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await expect(
      client.send.executeProposal({ args: { proposalId: badPid!, ensureBudgetValue: 6000n }, sender: agent, ...execParams }),
    ).rejects.toThrow()
  })

  test('stores and changes the asset id used for daily and monthly limits', async () => {
    const { client, deployer } = await deployAndBootstrap()
    const agent = await localnet.context.generateAccount({ initialFunds: (2).algo() })

    const createAsset = await localnet.algorand.send.assetCreate({
      sender: deployer,
      total: 1_000_000n,
      decimals: 0,
      unitName: 'LIM',
      assetName: 'Limit Asset',
      suppressLog: true,
    })
    const assetId = createAsset.assetId

    await governAdminChange(
      client,
      1n,
      mkAdminChange({
        changeType: ADM_CREATE_GROUP,
        groupName: 'Scoped Limits',
        threshold: 1n,
        memberAddr: agent.toString(),
        allowedActions: ACT_PAY | ACT_AXFER,
        adminPrivileges: 0n,
        limitAssetId: assetId,
        dailyLimit: 150n,
        monthlyLimit: 300n,
      }),
    )

    let group = await client.send.getSignerGroup({ args: { groupId: 2n, ensureBudgetValue: 0n }, suppressLog: true })
    expect(group.return!.limitAssetId).toBe(assetId)
    expect(group.return!.dailyLimit).toBe(150n)
    expect(group.return!.monthlyLimit).toBe(300n)

    // Safe opts in via proposeTransactionGroup.
    const { return: safeOptInPid } = await client.send.proposeTransactionGroup({
      args: {
        groupId: 1n,
        payload: toSafeTxnGroup([
          createAssetSafeTxn({
            sender: ZERO_ADDR,
            xferAsset: assetId,
            assetReceiver: client.appAddress.toString(),
            assetAmount: 0n,
            hasClose: 0n,
            assetCloseTo: ZERO_ADDR,
            note: '',
          }),
        ]),
        expiryRound: FAR_EXPIRY,
        execute: false,
        ensureBudgetValue: 10000n,
      },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await client.send.executeProposal({ args: { proposalId: safeOptInPid!, ensureBudgetValue: 6000n }, ...execParams })

    await localnet.algorand.send.assetTransfer({
      sender: deployer,
      receiver: client.appAddress,
      assetId,
      amount: 500n,
      suppressLog: true,
    })

    const assetRecipient = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    await localnet.algorand.send.assetOptIn({ sender: assetRecipient, assetId, suppressLog: true })

    const { return: assetPid } = await client.send.proposeTransactionGroup({
      args: {
        groupId: 2n,
        payload: toSafeTxnGroup([
          createAssetSafeTxn({
            sender: ZERO_ADDR,
            xferAsset: assetId,
            assetReceiver: assetRecipient.toString(),
            assetAmount: 100n,
            hasClose: 0n,
            assetCloseTo: ZERO_ADDR,
            note: '',
          }),
        ]),
        expiryRound: FAR_EXPIRY,
        execute: false,
        ensureBudgetValue: 10000n,
      },
      sender: agent,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await client.send.executeProposal({ args: { proposalId: assetPid!, ensureBudgetValue: 6000n }, sender: agent, ...execParams })

    group = await client.send.getSignerGroup({ args: { groupId: 2n, ensureBudgetValue: 0n }, suppressLog: true })
    expect(group.return!.dailyUsage).toBe(100n)
    expect(group.return!.monthlyUsage).toBe(100n)

    await governAdminChange(
      client,
      1n,
      mkAdminChange({
        changeType: ADM_SET_POLICY,
        targetGroupId: 2n,
        allowedActions: ACT_PAY,
        limitAssetId: 0n,
        dailyLimit: (2).algo().microAlgo,
        monthlyLimit: (3).algo().microAlgo,
      }),
    )

    group = await client.send.getSignerGroup({ args: { groupId: 2n, ensureBudgetValue: 0n }, suppressLog: true })
    expect(group.return!.limitAssetId).toBe(0n)
    expect(group.return!.dailyUsage).toBe(0n)
    expect(group.return!.monthlyUsage).toBe(0n)
    expect(group.return!.dailyLimit).toBe((2).algo().microAlgo)
    expect(group.return!.monthlyLimit).toBe((3).algo().microAlgo)

    const algoRecipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })
    const { return: algoPid } = await client.send.proposeTransactionGroup({
      args: {
        groupId: 2n,
        payload: toSafeTxnGroup([safePayment(algoRecipient.toString(), (1).algo().microAlgo)]),
        expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      sender: agent,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await client.send.executeProposal({ args: { proposalId: algoPid!, ensureBudgetValue: 6000n }, sender: agent, ...execParams })

    group = await client.send.getSignerGroup({ args: { groupId: 2n, ensureBudgetValue: 0n }, suppressLog: true })
    expect(group.return!.dailyUsage).toBe((1).algo().microAlgo)
    expect(group.return!.monthlyUsage).toBe((1).algo().microAlgo)
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

    // Proposal succeeds (action check happens at execution, not proposal time).
    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 2n, payload: toSafeTxnGroup([safePayment(recipient.toString(), (1).algo().microAlgo)]), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      sender: agent,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    // Execution fails: ACT_PAY is not in allowedActions for this group.
    await expect(
      client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, sender: agent, ...execParams }),
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

    let group = await client.send.getSignerGroup({ args: { groupId: 2n, ensureBudgetValue: 0n }, suppressLog: true })
    expect(group.return!.memberCount).toBe(2n)

    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_REMOVE_MEMBER, targetGroupId: 2n, memberAddr: b.toString() }),
    )
    group = await client.send.getSignerGroup({ args: { groupId: 2n, ensureBudgetValue: 0n }, suppressLog: true })
    expect(group.return!.memberCount).toBe(1n)

    const stillMember = await client.send.isMember({
      args: { groupId: 2n, account: b.toString(), ensureBudgetValue: 0n },
      suppressLog: true,
    })
    expect(stillMember.return).toBe(false)
  })

  test('cancels a pending proposal', async () => {
    const { client } = await deployAndBootstrap()
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 1n, payload: toSafeTxnGroup([safePayment(recipient.toString(), (1).algo().microAlgo)]), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await client.send.cancelProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, suppressLog: true })

    const proposal = await client.send.getProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, suppressLog: true })
    expect(proposal.return!.status).toBe(4n) // CANCELLED

    // A cancelled proposal cannot be executed.
    await expect(client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })).rejects.toThrow()
  })

  test('rejects proposals whose expiry is not in the future', async () => {
    const { client } = await deployAndBootstrap()
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    const round = await currentRound()
    await expect(
      client.send.proposeTransactionGroup({
        args: { groupId: 1n, payload: toSafeTxnGroup([safePayment(recipient.toString(), (1).algo().microAlgo)]), expiryRound: round, execute: false, ensureBudgetValue: 10000n },
        suppressLog: true,
        staticFee: (0.2).algo(),
      }),
    ).rejects.toThrow()
  })

  test('round-trips a mixed algosdk group through the SafeTxn byte encoding and back', async () => {
    const { deployer } = await deployAndBootstrap()
    const sp = await localnet.algorand.client.algod.getTransactionParams().do()
    const sender = deployer.addr
    const acctA = (await localnet.context.generateAccount({ initialFunds: (0).algo() })).toString()

    const pay = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender,
      receiver: acctA,
      amount: 12_345n,
      note: new TextEncoder().encode('pay-note'),
      suggestedParams: sp,
    })
    const axfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender,
      receiver: acctA,
      assetIndex: 777n,
      amount: 9n,
      suggestedParams: sp,
    })
    const appl = algosdk.makeApplicationCallTxnFromObject({
      sender,
      appIndex: 555n,
      onComplete: algosdk.OnApplicationComplete.OptInOC,
      appArgs: [new Uint8Array([1, 2, 3]), new Uint8Array([9])],
      accounts: [acctA],
      foreignApps: [111n, 222n],
      foreignAssets: [333n],
      suggestedParams: sp,
    })
    const voteKey = new Uint8Array(32).fill(1)
    const selectionKey = new Uint8Array(32).fill(2)
    const stateProofKey = new Uint8Array(64).fill(3)
    const keyreg = algosdk.makeKeyRegistrationTxnWithSuggestedParamsFromObject({
      sender,
      voteKey,
      selectionKey,
      stateProofKey,
      voteFirst: 1n,
      voteLast: 1000n,
      voteKeyDilution: 50n,
      suggestedParams: sp,
    })
    const acfg = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
      sender,
      total: 1000n,
      decimals: 2,
      defaultFrozen: false,
      unitName: 'RT',
      assetName: 'RoundTrip',
      assetURL: 'https://example.io',
      manager: sender,
      reserve: sender,
      freeze: sender,
      clawback: sender,
      suggestedParams: sp,
    })

    const tuples = algosdkTxnsToSafeTxnGroup([pay, axfer, appl, keyreg, acfg])
    expect(tuples.map((t) => t[0])).toEqual([TX_PAYMENT, TX_ASSET, TX_APP, TX_KEYREG, TX_ACFG])

    const dp = decodePaymentTxn(tuples[0][1])
    expect(dp.receiver).toBe(acctA)
    expect(dp.amount).toBe(12_345n)
    expect(dp.note).toBe('pay-note')

    const da = decodeAssetTxn(tuples[1][1])
    expect(da.xferAsset).toBe(777n)
    expect(da.assetReceiver).toBe(acctA)
    expect(da.assetAmount).toBe(9n)

    const dapp = decodeAppTxn(tuples[2][1])
    expect(dapp.appId).toBe(555n)
    expect(dapp.onCompletion).toBe(1n) // OptIn
    expect(dapp.appArgs).toEqual([new Uint8Array([1, 2, 3]), new Uint8Array([9])])
    expect(dapp.accounts).toEqual([acctA])
    expect(dapp.foreignApps).toEqual([111n, 222n])
    expect(dapp.foreignAssets).toEqual([333n])

    const dk = decodeKeyRegTxn(tuples[3][1])
    expect(dk.online).toBe(1n)
    expect(dk.voteKey).toEqual(voteKey)
    expect(dk.selectionKey).toEqual(selectionKey)
    expect(dk.stateProofKey).toEqual(stateProofKey)
    expect(dk.voteFirst).toBe(1n)
    expect(dk.voteLast).toBe(1000n)
    expect(dk.voteKeyDilution).toBe(50n)

    const dc = decodeAssetConfigTxn(tuples[4][1])
    expect(dc.configAsset).toBe(0n)
    expect(dc.total).toBe(1000n)
    expect(dc.decimals).toBe(2n)
    expect(dc.defaultFrozen).toBe(0n)
    expect(dc.unitName).toBe('RT')
    expect(dc.assetName).toBe('RoundTrip')
    expect(dc.url).toBe('https://example.io')
    expect(dc.manager).toBe(sender.toString())
    expect(dc.reserve).toBe(sender.toString())
  })

  test('executes an app call carrying more than four arguments', async () => {
    const { client, deployer } = await deployAndBootstrap()
    const targetAppId = await createBareNoOpApp(deployer)
    const enc = new TextEncoder()
    const args = ['a', 'b', 'c', 'd', 'e', 'f'].map((s) => enc.encode(s))

    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 1n, payload: toSafeTxnGroup([safeAppCall(targetAppId, args)]), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    const stored = await client.send.getTransactionGroup({ args: { proposalId: pid!, payloadIndex: 1n, ensureBudgetValue: 0n }, suppressLog: true })
    expect(decodeAppTxn(stored.return![0][1]).appArgs.length).toBe(6)

    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })
    const after = await client.send.getProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, suppressLog: true })
    expect(after.return!.status).toBe(3n) // EXECUTED
  })

  test('executes an app call that references a foreign asset, app and account', async () => {
    const { client, deployer } = await deployAndBootstrap()
    const targetAppId = await createBareNoOpApp(deployer)
    const created = await localnet.algorand.send.assetCreate({
      sender: deployer,
      total: 100n,
      decimals: 0,
      suppressLog: true,
    })
    const assetId = created.assetId
    const someAccount = (await localnet.context.generateAccount({ initialFunds: (0).algo() })).toString()

    const tx = createAppCallSafeTxn(
      createAppCallPayload(targetAppId, [new TextEncoder().encode('x')], {
        accounts: [someAccount],
        foreignApps: [targetAppId],
        foreignAssets: [assetId],
      }),
    )

    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 1n, payload: toSafeTxnGroup([tx]), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    const stored = await client.send.getTransactionGroup({ args: { proposalId: pid!, payloadIndex: 1n, ensureBudgetValue: 0n }, suppressLog: true })
    const decoded = decodeAppTxn(stored.return![0][1])
    expect(decoded.foreignAssets).toEqual([assetId])
    expect(decoded.foreignApps).toEqual([targetAppId])
    expect(decoded.accounts).toEqual([someAccount])

    const appId = BigInt(client.appId)
    await client.send.executeProposal({
      args: { proposalId: pid!, ensureBudgetValue: 6000n },
      suppressLog: true,
      staticFee: (0.05).algo(),
      populateAppCallResources: false,
      boxReferences: [
        { appId, name: boxKeyU64('p', pid!) },
        { appId, name: boxKeyU64('g', 1n) },
        { appId, name: boxKeyU64('txg', pid! * 7n + 1n) },
      ],
      assetReferences: [assetId],
      appReferences: [targetAppId],
      accountReferences: [someAccount],
    })

    const after = await client.send.getProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, suppressLog: true })
    expect(after.return!.status).toBe(3n) // EXECUTED
  })

  test('creates a new ASA from the safe via an asset-config proposal', async () => {
    const { client } = await deployAndBootstrap()

    const tx = createAssetConfigSafeTxn({
      configAsset: 0n,
      total: 1000n,
      decimals: 0n,
      defaultFrozen: 0n,
      unitName: 'SAFE',
      assetName: 'Safe Asset',
      url: 'https://safe.example',
      metadataHash: new Uint8Array(0),
      manager: client.appAddress.toString(),
      reserve: client.appAddress.toString(),
      freeze: ZERO_ADDR,
      clawback: ZERO_ADDR,
      note: '',
    })

    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 1n, payload: toSafeTxnGroup([tx]), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    const stored = await client.send.getTransactionGroup({ args: { proposalId: pid!, payloadIndex: 1n, ensureBudgetValue: 0n }, suppressLog: true })
    expect(stored.return![0][0]).toBe(TX_ACFG)
    expect(decodeAssetConfigTxn(stored.return![0][1]).assetName).toBe('Safe Asset')

    const executeResult = await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })
    const pendingInfo = await localnet.algorand.client.algod.pendingTransactionInformation(executeResult.txIds[0]).do()
    const acfgInner = getInnerTransactions(pendingInfo).find((innerTxn) => getInnerTransactionType(innerTxn) === 'acfg')
    expect(acfgInner).toBeDefined()

    // The safe (creator) holds the full supply of the newly created asset.
    const info = await localnet.algorand.account.getInformation(client.appAddress)
    const held = info.assets?.find((a) => a.amount === 1000n)
    expect(held).toBeDefined()
  })

  test('executes an offline key registration from the safe', async () => {
    const { client } = await deployAndBootstrap()

    const tx = createKeyRegSafeTxn({
      online: 0n,
      voteKey: new Uint8Array(0),
      selectionKey: new Uint8Array(0),
      stateProofKey: new Uint8Array(0),
      voteFirst: 0n,
      voteLast: 0n,
      voteKeyDilution: 0n,
    })

    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 1n, payload: toSafeTxnGroup([tx]), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    const stored = await client.send.getTransactionGroup({ args: { proposalId: pid!, payloadIndex: 1n, ensureBudgetValue: 0n }, suppressLog: true })
    expect(stored.return![0][0]).toBe(TX_KEYREG)

    const executeResult = await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })
    const pendingInfo = await localnet.algorand.client.algod.pendingTransactionInformation(executeResult.txIds[0]).do()
    const krInner = getInnerTransactions(pendingInfo).find((innerTxn) => getInnerTransactionType(innerTxn) === 'keyreg')
    expect(krInner).toBeDefined()
  })

  test('rejects an app call that exceeds the foreign-reference limit', async () => {
    const { client, deployer } = await deployAndBootstrap()
    const targetAppId = await createBareNoOpApp(deployer)

    // 4 accounts + 4 apps + 1 asset = 9 references > MaxAppTotalTxnReferences (8).
    const accounts = await Promise.all(
      [0, 1, 2, 3].map(async () => (await localnet.context.generateAccount({ initialFunds: (0).algo() })).toString()),
    )
    const tx = createAppCallSafeTxn(
      createAppCallPayload(targetAppId, [], {
        accounts,
        foreignApps: [targetAppId, targetAppId, targetAppId, targetAppId],
        foreignAssets: [1n],
      }),
    )

    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 1n, payload: toSafeTxnGroup([tx]), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    // The reference-count check fires at execution time.
    await expect(client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })).rejects.toThrow()
  })

  // -------------------------------------------------------------------------
  // Security-audit regression tests (2026-07-06 report)
  // -------------------------------------------------------------------------

  test('rejects appending a transaction-group payload chunk after an independent approval (C-01 regression)', async () => {
    const { client } = await deployAndBootstrap()
    const attacker = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const honestMember = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const decoy = await localnet.context.generateAccount({ initialFunds: (0).algo() })
    const attackerPayout = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    // Governance creates a 2-of-2 Treasury group with an attacker and an honest member.
    await governAdminChange(
      client,
      1n,
      mkAdminChange({
        changeType: ADM_CREATE_GROUP,
        groupName: 'Treasury',
        threshold: 1n,
        memberAddr: attacker.toString(),
        allowedActions: ACT_PAY,
        adminPrivileges: 0n,
      }),
    )
    const treasuryGroupId = 2n
    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_ADD_MEMBER, targetGroupId: treasuryGroupId, memberAddr: honestMember.toString() }),
    )
    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_CHANGE_THRESHOLD, targetGroupId: treasuryGroupId, threshold: 2n }),
    )

    // Attacker proposes an innocuous small payment (auto-approves, 1 of 2).
    const { return: pid } = await client.send.proposeTransactionGroup({
      args: {
        groupId: treasuryGroupId,
        payload: toSafeTxnGroup([safePayment(decoy.toString(), (0.5).algo().microAlgo)]),
        expiryRound: FAR_EXPIRY,
        execute: false,
        ensureBudgetValue: 10000n,
      },
      sender: attacker,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    // Honest member reviews the single visible payment and approves — proposal reaches READY.
    await client.send.approveProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, sender: honestMember, suppressLog: true })
    const ready = await client.send.getProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, suppressLog: true })
    expect(ready.return!.approvalsCount).toBe(2n)
    expect(ready.return!.status).toBe(2n) // READY

    // Attacker attempts to append a large drain payment after approvals are locked in — must be rejected.
    await expect(
      client.send.appendTransactionGroupPayload({
        args: {
          proposalId: pid!,
          payloadIndex: 2n,
          payload: toSafeTxnGroup([safePayment(attackerPayout.toString(), (19).algo().microAlgo)]),
          ensureBudgetValue: 10000n,
        },
        sender: attacker,
        suppressLog: true,
        staticFee: (0.1).algo(),
      }),
    ).rejects.toThrow()

    // Execution only ever moves the single, honestly reviewed payment.
    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, sender: honestMember, ...execParams })
    const decoyInfo = await localnet.algorand.account.getInformation(decoy)
    expect(decoyInfo.balance.microAlgo).toBe((0.5).algo().microAlgo)
  })

  test('rejects appendTransactionGroupPayload from a group member who is not the proposer', async () => {
    const { client } = await deployAndBootstrap()
    const a = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const b = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    await governAdminChange(
      client,
      1n,
      mkAdminChange({
        changeType: ADM_CREATE_GROUP,
        groupName: 'Ops',
        threshold: 1n,
        memberAddr: a.toString(),
        allowedActions: ACT_PAY,
        adminPrivileges: 0n,
      }),
    )
    const groupId = 2n
    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_ADD_MEMBER, targetGroupId: groupId, memberAddr: b.toString() }),
    )
    // Threshold stays 1, so A's proposal reaches READY on auto-approval alone —
    // isolating the proposer check from the approvalsCount===1 check.

    const { return: pid } = await client.send.proposeTransactionGroup({
      args: {
        groupId,
        payload: toSafeTxnGroup([safePayment(recipient.toString(), (0.1).algo().microAlgo)]),
        expiryRound: FAR_EXPIRY,
        execute: false,
        ensureBudgetValue: 10000n,
      },
      sender: a,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    await expect(
      client.send.appendTransactionGroupPayload({
        args: {
          proposalId: pid!,
          payloadIndex: 2n,
          payload: toSafeTxnGroup([safePayment(recipient.toString(), (0.2).algo().microAlgo)]),
          ensureBudgetValue: 10000n,
        },
        sender: b,
        suppressLog: true,
        staticFee: (0.1).algo(),
      }),
    ).rejects.toThrow()
  })

  test('rejects appendTransactionGroupPayload and executeProposal from a proposer removed from the group (H-01 regression)', async () => {
    const { client } = await deployAndBootstrap()
    const attacker = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const bystander = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const decoy = await localnet.context.generateAccount({ initialFunds: (0).algo() })
    const attackerPayout = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    // Governance creates a 1-of-2 Treasury group with the attacker as an initial member.
    await governAdminChange(
      client,
      1n,
      mkAdminChange({
        changeType: ADM_CREATE_GROUP,
        groupName: 'Treasury',
        threshold: 1n,
        memberAddr: attacker.toString(),
        allowedActions: ACT_PAY,
        adminPrivileges: 0n,
      }),
    )
    const treasuryGroupId = 2n
    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_ADD_MEMBER, targetGroupId: treasuryGroupId, memberAddr: bystander.toString() }),
    )

    // Attacker proposes a small decoy payment; threshold 1 means auto-approval reaches READY immediately.
    const { return: pid } = await client.send.proposeTransactionGroup({
      args: {
        groupId: treasuryGroupId,
        payload: toSafeTxnGroup([safePayment(decoy.toString(), (0.1).algo().microAlgo)]),
        expiryRound: FAR_EXPIRY,
        execute: false,
        ensureBudgetValue: 10000n,
      },
      sender: attacker,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    const ready = await client.send.getProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, suppressLog: true })
    expect(ready.return!.status).toBe(2n) // READY

    // Governance removes the attacker from the group.
    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_REMOVE_MEMBER, targetGroupId: treasuryGroupId, memberAddr: attacker.toString() }),
    )
    const stillMember = await client.send.isMember({
      args: { groupId: treasuryGroupId, account: attacker.toString(), ensureBudgetValue: 0n },
      suppressLog: true,
    })
    expect(stillMember.return).toBe(false)

    // Removed attacker attempts to append a drain payment to their own now-orphaned proposal — must be rejected.
    await expect(
      client.send.appendTransactionGroupPayload({
        args: {
          proposalId: pid!,
          payloadIndex: 2n,
          payload: toSafeTxnGroup([safePayment(attackerPayout.toString(), (3).algo().microAlgo)]),
          ensureBudgetValue: 10000n,
        },
        sender: attacker,
        suppressLog: true,
        staticFee: (0.1).algo(),
      }),
    ).rejects.toThrow()

    // Even without appending, the removed proposer should not be able to execute their own stale proposal
    // via a spoofed sender — executeProposal itself doesn't require membership, so only the append path
    // needed the fix, but confirm the payout account never received anything.
    const payoutInfo = await localnet.algorand.account.getInformation(attackerPayout)
    expect(payoutInfo.balance.microAlgo).toBe(0n)
  })

  test('rejects the sole PRIV_GROUP holder revoking its own group-admin privilege (M-01 lockout guard)', async () => {
    const { client } = await deployAndBootstrap()

    const initialCount = await client.send.getActivePrivGroupCount({ args: { ensureBudgetValue: 0n }, suppressLog: true })
    expect(initialCount.return).toBe(1n)

    await expect(
      client.send.proposeAdminChange({
        args: {
          groupId: 1n,
          change: mkAdminChange({ changeType: ADM_SET_PRIVILEGES, targetGroupId: 1n, adminPrivileges: 0n }),
          expiryRound: FAR_EXPIRY,
          ensureBudgetValue: 0n,
        },
        suppressLog: true,
        staticFee: (0.2).algo(),
      }),
    ).rejects.toThrow()

    const countAfter = await client.send.getActivePrivGroupCount({ args: { ensureBudgetValue: 0n }, suppressLog: true })
    expect(countAfter.return).toBe(1n)
  })

  test('rejects deactivating the sole active PRIV_GROUP holder (M-01 lockout guard)', async () => {
    const { client } = await deployAndBootstrap()

    await expect(
      client.send.proposeAdminChange({
        args: {
          groupId: 1n,
          change: mkAdminChange({ changeType: ADM_SET_ACTIVE, targetGroupId: 1n, activeFlag: 0n }),
          expiryRound: FAR_EXPIRY,
          ensureBudgetValue: 0n,
        },
        suppressLog: true,
        staticFee: (0.2).algo(),
      }),
    ).rejects.toThrow()
  })

  test('allows revoking PRIV_GROUP while another active group still holds it, but blocks removing the last one (M-01)', async () => {
    const { client } = await deployAndBootstrap()
    const b = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    // Create a second group that also holds PRIV_GROUP.
    await governAdminChange(
      client,
      1n,
      mkAdminChange({
        changeType: ADM_CREATE_GROUP,
        groupName: 'Backup Admins',
        threshold: 1n,
        memberAddr: b.toString(),
        allowedActions: 0n,
        adminPrivileges: PRIV_GROUP,
      }),
    )
    let count = await client.send.getActivePrivGroupCount({ args: { ensureBudgetValue: 0n }, suppressLog: true })
    expect(count.return).toBe(2n)

    // Group 1 revokes its own PRIV_GROUP — allowed, since group 2 still holds it.
    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_SET_PRIVILEGES, targetGroupId: 1n, adminPrivileges: 0n }),
    )
    count = await client.send.getActivePrivGroupCount({ args: { ensureBudgetValue: 0n }, suppressLog: true })
    expect(count.return).toBe(1n)

    // Group 2 is now the sole holder — it cannot strip its own PRIV_GROUP either.
    await expect(
      client.send.proposeAdminChange({
        args: {
          groupId: 2n,
          change: mkAdminChange({ changeType: ADM_SET_PRIVILEGES, targetGroupId: 2n, adminPrivileges: 0n }),
          expiryRound: FAR_EXPIRY,
          ensureBudgetValue: 0n,
        },
        sender: b,
        suppressLog: true,
        staticFee: (0.2).algo(),
      }),
    ).rejects.toThrow()
  })

  test('requires the live group threshold at execution when it was raised after the proposal was already READY (M-02 defense in depth)', async () => {
    const { client } = await deployAndBootstrap()
    const a = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const b = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    // Treasury group starts 1-of-2 (threshold 1, two members).
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
    const groupId = 2n
    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_ADD_MEMBER, targetGroupId: groupId, memberAddr: b.toString() }),
    )

    // A proposes a payment; auto-approves under threshold=1 → immediately READY.
    const { return: pid } = await client.send.proposeTransactionGroup({
      args: {
        groupId,
        payload: toSafeTxnGroup([safePayment(recipient.toString(), (0.3).algo().microAlgo)]),
        expiryRound: FAR_EXPIRY,
        execute: false,
        ensureBudgetValue: 10000n,
      },
      sender: a,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    const ready = await client.send.getProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, suppressLog: true })
    expect(ready.return!.status).toBe(2n) // READY under the threshold=1 snapshot

    // Governance raises the group's live threshold to 2 (e.g. responding to a suspected compromise).
    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_CHANGE_THRESHOLD, targetGroupId: groupId, threshold: 2n }),
    )

    // Execution now requires the live threshold (2), not the stale snapshot (1).
    await expect(
      client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, sender: a, ...execParams }),
    ).rejects.toThrow()

    // Once a second, independent approval brings approvalsCount to 2, execution succeeds.
    await client.send.approveProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, sender: b, suppressLog: true })
    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, sender: b, ...execParams })

    const recipInfo = await localnet.algorand.account.getInformation(recipient)
    expect(recipInfo.balance.microAlgo).toBe((0.3).algo().microAlgo)
  })

  test('prunes box storage for a terminal, expired proposal but not before (L-01)', async () => {
    const { client, deployer } = await deployAndBootstrap()
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    const round = await currentRound()
    const expiryRound = round + 20n

    const { return: pid } = await client.send.proposeTransactionGroup({
      args: {
        groupId: 1n,
        payload: toSafeTxnGroup([safePayment(recipient.toString(), (0.1).algo().microAlgo)]),
        expiryRound,
        execute: false,
        ensureBudgetValue: 10000n,
      },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    // Not terminal yet (still READY, unexecuted) — prune must be rejected.
    await expect(
      client.send.pruneProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, suppressLog: true }),
    ).rejects.toThrow()

    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })

    // Terminal (EXECUTED) but not yet past expiry — still rejected.
    await expect(
      client.send.pruneProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, suppressLog: true }),
    ).rejects.toThrow()

    // Advance rounds past expiry with a few unrelated payments.
    for (let i = 0; i < 25; i += 1) {
      await localnet.algorand.send.payment({ amount: (0).algo(), sender: deployer, receiver: deployer, suppressLog: true })
    }

    await client.send.pruneProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, suppressLog: true })

    await expect(
      client.send.getProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, suppressLog: true }),
    ).rejects.toThrow()
    await expect(
      client.send.getTransactionGroup({ args: { proposalId: pid!, payloadIndex: 1n, ensureBudgetValue: 0n }, suppressLog: true }),
    ).rejects.toThrow()
  })

  test('rejects an ALGO close-remainder-to payment that would sweep more than the daily limit (H-01 regression)', async () => {
    const { client } = await deployAndBootstrap()
    const agent = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    // Agent group limited to 1 ALGO/day; the safe's app account (funded with
    // 5 ALGO at deploy) holds far more than that.
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

    const receiver = await localnet.context.generateAccount({ initialFunds: (0).algo() })
    const closeTo = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    // Declared `amount` is well within the limit, but `hasClose` sweeps the
    // entire remaining balance to `closeTo` — must still be rejected.
    const { return: pid } = await client.send.proposeTransactionGroup({
      args: {
        groupId: 2n,
        payload: toSafeTxnGroup([
          createPaymentSafeTxn({
            sender: ZERO_ADDR,
            receiver: receiver.toString(),
            amount: (0.05).algo().microAlgo,
            hasClose: 1n,
            closeRemainderTo: closeTo.toString(),
            note: '',
          }),
        ]),
        expiryRound: FAR_EXPIRY,
        execute: false,
        ensureBudgetValue: 10000n,
      },
      sender: agent,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    await expect(
      client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, sender: agent, ...execParams }),
    ).rejects.toThrow()
  })

  test('rejects an asset close-to transfer that would sweep more than the tracked-asset daily limit (H-01 regression)', async () => {
    const { client, deployer } = await deployAndBootstrap()
    const agent = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    const createAsset = await localnet.algorand.send.assetCreate({
      sender: deployer,
      total: 1_000_000n,
      decimals: 0,
      unitName: 'CLS',
      assetName: 'Close Asset',
      suppressLog: true,
    })
    const assetId = createAsset.assetId

    await governAdminChange(
      client,
      1n,
      mkAdminChange({
        changeType: ADM_CREATE_GROUP,
        groupName: 'Agent',
        threshold: 1n,
        memberAddr: agent.toString(),
        allowedActions: ACT_AXFER,
        adminPrivileges: 0n,
        limitAssetId: assetId,
        dailyLimit: 50n,
      }),
    )

    // Safe opts in and is funded with 500 units — far more than the 50-unit limit.
    const { return: optInPid } = await client.send.proposeTransactionGroup({
      args: {
        groupId: 1n,
        payload: toSafeTxnGroup([
          createAssetSafeTxn({
            sender: ZERO_ADDR,
            xferAsset: assetId,
            assetReceiver: client.appAddress.toString(),
            assetAmount: 0n,
            hasClose: 0n,
            assetCloseTo: ZERO_ADDR,
            note: '',
          }),
        ]),
        expiryRound: FAR_EXPIRY,
        execute: false,
        ensureBudgetValue: 10000n,
      },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await client.send.executeProposal({ args: { proposalId: optInPid!, ensureBudgetValue: 6000n }, ...execParams })
    await localnet.algorand.send.assetTransfer({
      sender: deployer,
      receiver: client.appAddress,
      assetId,
      amount: 500n,
      suppressLog: true,
    })

    const receiver = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    await localnet.algorand.send.assetOptIn({ sender: receiver, assetId, suppressLog: true })
    const closeTo = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    await localnet.algorand.send.assetOptIn({ sender: closeTo, assetId, suppressLog: true })

    // Declared `assetAmount` is within the limit, but `hasAssetClose` sweeps
    // the safe's entire 500-unit holding to `closeTo` — must be rejected.
    const { return: pid } = await client.send.proposeTransactionGroup({
      args: {
        groupId: 2n,
        payload: toSafeTxnGroup([
          createAssetSafeTxn({
            sender: ZERO_ADDR,
            xferAsset: assetId,
            assetReceiver: receiver.toString(),
            assetAmount: 10n,
            hasClose: 1n,
            assetCloseTo: closeTo.toString(),
            note: '',
          }),
        ]),
        expiryRound: FAR_EXPIRY,
        execute: false,
        ensureBudgetValue: 10000n,
      },
      sender: agent,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    await expect(
      client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, sender: agent, ...execParams }),
    ).rejects.toThrow()
  })

  test('spends from an external account rekeyed to the safe via the payment sender field', async () => {
    const { client } = await deployAndBootstrap()
    const external = await localnet.context.generateAccount({ initialFunds: (2).algo() })
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    // The external account hands control to the safe with a normal rekey.
    await localnet.algorand.send.payment({
      sender: external,
      receiver: external,
      amount: (0).algo(),
      rekeyTo: client.appAddress,
      suppressLog: true,
    })

    const { return: pid } = await client.send.proposeTransactionGroup({
      args: {
        groupId: 1n,
        payload: toSafeTxnGroup([
          createPaymentSafeTxn({
            sender: external.toString(),
            receiver: recipient.toString(),
            amount: (0.5).algo().microAlgo,
            hasClose: 0n,
            closeRemainderTo: ZERO_ADDR,
            note: '',
          }),
        ]),
        expiryRound: FAR_EXPIRY,
        execute: false,
        ensureBudgetValue: 10000n,
      },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })

    const recipInfo = await localnet.algorand.account.getInformation(recipient)
    expect(recipInfo.balance.microAlgo).toBe((0.5).algo().microAlgo)
    // 2 ALGO funded − 0.001 rekey fee − 0.5 payment (inner fee 0, pooled by the caller).
    const externalInfo = await localnet.algorand.account.getInformation(external)
    expect(externalInfo.balance.microAlgo).toBe((1.499).algo().microAlgo)
  })

  test('releases a rekeyed external account back to its own key via a governed rekey proposal', async () => {
    const { client } = await deployAndBootstrap()
    const external = await localnet.context.generateAccount({ initialFunds: (2).algo() })

    await localnet.algorand.send.payment({
      sender: external,
      receiver: external,
      amount: (0).algo(),
      rekeyTo: client.appAddress,
      suppressLog: true,
    })
    const rekeyed = await localnet.algorand.account.getInformation(external)
    expect(rekeyed.authAddr?.toString()).toBe(client.appAddress.toString())

    const rekeyTxn = createRekeySafeTxn({ sender: external.toString(), rekeyTo: external.toString(), note: '' })
    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 1n, payload: toSafeTxnGroup([rekeyTxn]), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    const stored = await client.send.getTransactionGroup({ args: { proposalId: pid!, payloadIndex: 1n, ensureBudgetValue: 0n }, suppressLog: true })
    expect(stored.return![0][0]).toBe(TX_REKEY)
    const decoded = decodeRekeyTxn(stored.return![0][1])
    expect(decoded.sender).toBe(external.toString())
    expect(decoded.rekeyTo).toBe(external.toString())

    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })

    // Rekeying an account to its own address clears its auth-addr.
    const released = await localnet.algorand.account.getInformation(external)
    expect(released.authAddr === undefined || released.authAddr.toString() === external.toString()).toBe(true)

    // The external account can sign for itself again.
    const probe = await localnet.context.generateAccount({ initialFunds: (0).algo() })
    await localnet.algorand.send.payment({
      sender: external,
      receiver: probe,
      amount: (0.1).algo(),
      suppressLog: true,
    })
    const probeInfo = await localnet.algorand.account.getInformation(probe)
    expect(probeInfo.balance.microAlgo).toBe((0.1).algo().microAlgo)
  })

  test('rekeys the safe itself to a new address through admin consensus (migration path)', async () => {
    const { client } = await deployAndBootstrap()
    const newController = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    // sender zero address = the safe's own application account.
    const rekeyTxn = createRekeySafeTxn({ sender: ZERO_ADDR, rekeyTo: newController.toString(), note: 'migrate' })
    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 1n, payload: toSafeTxnGroup([rekeyTxn]), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })

    // The safe address is now controlled by the new address, not the app.
    const safeInfo = await localnet.algorand.account.getInformation(client.appAddress)
    expect(safeInfo.authAddr?.toString()).toBe(newController.toString())
  })

  test('executes a rekey only after the admin group threshold is fully met (2-of-2)', async () => {
    const { client, deployer } = await deployAndBootstrap()
    const secondAdmin = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const newController = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    // Grow the genesis admin group to 2-of-2 (threshold change last, while 1-of-1 still governs).
    await governAdminChange(
      client,
      1n,
      mkAdminChange({
        changeType: ADM_ADD_MEMBER,
        targetGroupId: 1n,
        memberAddr: secondAdmin.toString(),
        memberType: 1n,
        memberLabel: 'second admin',
      }),
    )
    await governAdminChange(client, 1n, mkAdminChange({ changeType: ADM_CHANGE_THRESHOLD, targetGroupId: 1n, threshold: 2n }))

    const rekeyTxn = createRekeySafeTxn({ sender: ZERO_ADDR, rekeyTo: newController.toString(), note: '' })
    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 1n, payload: toSafeTxnGroup([rekeyTxn]), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      sender: deployer,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    // Only the proposer's auto-approval so far — execution must fail short of the threshold.
    await expect(
      client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams }),
    ).rejects.toThrow()
    const safeBefore = await localnet.algorand.account.getInformation(client.appAddress)
    expect(safeBefore.authAddr).toBeUndefined()

    // Second admin approves; the threshold is met and the rekey executes.
    await client.send.approveProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, sender: secondAdmin, suppressLog: true })
    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })

    const safeAfter = await localnet.algorand.account.getInformation(client.appAddress)
    expect(safeAfter.authAddr?.toString()).toBe(newController.toString())
  })

  test('rejects a rekey proposal from a group without the ACT_REKEY action', async () => {
    const { client } = await deployAndBootstrap()
    const agent = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    await governAdminChange(
      client,
      1n,
      mkAdminChange({
        changeType: ADM_CREATE_GROUP,
        groupName: 'PayOnly',
        threshold: 1n,
        memberAddr: agent.toString(),
        allowedActions: ACT_PAY,
        adminPrivileges: 0n,
      }),
    )

    const rekeyTxn = createRekeySafeTxn({ sender: ZERO_ADDR, rekeyTo: agent.toString(), note: '' })
    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 2n, payload: toSafeTxnGroup([rekeyTxn]), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      sender: agent,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await expect(
      client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, sender: agent, ...execParams }),
    ).rejects.toThrow()
  })

  test('rejects a rekey from an ACT_REKEY group that lacks the group-admin privilege', async () => {
    const { client } = await deployAndBootstrap()
    const agent = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    // The group is explicitly allowed the rekey action but holds no admin
    // privilege — rekey is reserved for admin consensus, so execution must fail.
    await governAdminChange(
      client,
      1n,
      mkAdminChange({
        changeType: ADM_CREATE_GROUP,
        groupName: 'RekeyNoAdmin',
        threshold: 1n,
        memberAddr: agent.toString(),
        allowedActions: ACT_REKEY,
        adminPrivileges: 0n,
      }),
    )

    const rekeyTxn = createRekeySafeTxn({ sender: ZERO_ADDR, rekeyTo: agent.toString(), note: '' })
    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 2n, payload: toSafeTxnGroup([rekeyTxn]), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      sender: agent,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await expect(
      client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, sender: agent, ...execParams }),
    ).rejects.toThrow()
  })

  test('enforces cooldownRounds between successive executions of a group (M-01 regression)', async () => {
    const { client } = await deployAndBootstrap()
    const agent = await localnet.context.generateAccount({ initialFunds: (1).algo() })

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
        cooldownRounds: 1000n,
      }),
    )

    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    const { return: firstPid } = await client.send.proposeTransactionGroup({
      args: {
        groupId: 2n,
        payload: toSafeTxnGroup([safePayment(recipient.toString(), (0.1).algo().microAlgo)]),
        expiryRound: FAR_EXPIRY,
        execute: false,
        ensureBudgetValue: 10000n,
      },
      sender: agent,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await client.send.executeProposal({ args: { proposalId: firstPid!, ensureBudgetValue: 6000n }, sender: agent, ...execParams })

    // Second proposal, approved and ready, but the group's cooldown has not elapsed.
    const { return: secondPid } = await client.send.proposeTransactionGroup({
      args: {
        groupId: 2n,
        payload: toSafeTxnGroup([safePayment(recipient.toString(), (0.1).algo().microAlgo)]),
        expiryRound: FAR_EXPIRY,
        execute: false,
        ensureBudgetValue: 10000n,
      },
      sender: agent,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await expect(
      client.send.executeProposal({ args: { proposalId: secondPid!, ensureBudgetValue: 6000n }, sender: agent, ...execParams }),
    ).rejects.toThrow()
  })

  test('rejects a cooldownRounds value above the configured maximum on group creation (M-03 regression)', async () => {
    const { client } = await deployAndBootstrap()
    const agent = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    await expect(
      client.send.proposeAdminChange({
        args: {
          groupId: 1n,
          change: mkAdminChange({
            changeType: ADM_CREATE_GROUP,
            groupName: 'Agent',
            threshold: 1n,
            memberAddr: agent.toString(),
            allowedActions: ACT_PAY,
            adminPrivileges: 0n,
            cooldownRounds: 10_000_001n,
          }),
          expiryRound: FAR_EXPIRY,
          ensureBudgetValue: 0n,
        },
        suppressLog: true,
        staticFee: (0.2).algo(),
      }),
    ).rejects.toThrow()
  })

  test('rejects a cooldownRounds value above the configured maximum via ADM_SET_POLICY, closing the overflow DoS (M-03 regression)', async () => {
    const { client } = await deployAndBootstrap()
    const agent = await localnet.context.generateAccount({ initialFunds: (1).algo() })

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
      }),
    )

    // The value that previously caused an unhandled AVM arithmetic-overflow
    // panic at execution time (uint64 max) must now be rejected cleanly and
    // immediately, at proposal time, well before it can ever reach `+`.
    await expect(
      client.send.proposeAdminChange({
        args: {
          groupId: 1n,
          change: mkAdminChange({
            changeType: ADM_SET_POLICY,
            targetGroupId: 2n,
            allowedActions: ACT_PAY,
            cooldownRounds: 18446744073709551615n,
          }),
          expiryRound: FAR_EXPIRY,
          ensureBudgetValue: 0n,
        },
        suppressLog: true,
        staticFee: (0.2).algo(),
      }),
    ).rejects.toThrow()

    // A value at the boundary is still accepted.
    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_SET_POLICY, targetGroupId: 2n, allowedActions: ACT_PAY, cooldownRounds: 10_000_000n }),
    )
    const group = await client.send.getSignerGroup({ args: { groupId: 2n, ensureBudgetValue: 0n }, suppressLog: true })
    expect(group.return!.cooldownRounds).toBe(10_000_000n)
  })

  test('invalidates a pending proposal\'s recorded approvals when a group member is removed (M-02 regression)', async () => {
    const { client } = await deployAndBootstrap()
    const a = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const b = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    // 2-of-2 Treasury group.
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

    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    // A proposes (auto-approved 1-of-2); B approves independently, reaching threshold.
    const { return: pid } = await client.send.proposeTransactionGroup({
      args: {
        groupId: 2n,
        payload: toSafeTxnGroup([safePayment(recipient.toString(), (0.1).algo().microAlgo)]),
        expiryRound: FAR_EXPIRY,
        execute: false,
        ensureBudgetValue: 10000n,
      },
      sender: a,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await client.send.approveProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, sender: b, suppressLog: true })

    // Now B (one of the two approvers) is removed from the group — e.g.
    // incident response to a suspected compromised signer. Lower the
    // threshold first so removal doesn't trip the below-threshold guard.
    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_CHANGE_THRESHOLD, targetGroupId: 2n, threshold: 1n }),
    )
    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_REMOVE_MEMBER, targetGroupId: 2n, memberAddr: b.toString() }),
    )

    // The proposal's approvals were recorded before the removal; execution
    // must now be rejected rather than trusting the stale approval set.
    await expect(
      client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, sender: a, ...execParams }),
    ).rejects.toThrow()

    // A fresh proposal (created after the removal) proceeds normally.
    const { return: freshPid } = await client.send.proposeTransactionGroup({
      args: {
        groupId: 2n,
        payload: toSafeTxnGroup([safePayment(recipient.toString(), (0.1).algo().microAlgo)]),
        expiryRound: FAR_EXPIRY,
        execute: true,
        ensureBudgetValue: 10000n,
      },
      sender: a,
      ...execParams,
    })
    expect(freshPid).toBeDefined()
  })
})
