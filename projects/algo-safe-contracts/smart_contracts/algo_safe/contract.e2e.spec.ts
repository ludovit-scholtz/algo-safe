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
  ADM_ADD_REKEYED_ADDR,
  ADM_CHANGE_THRESHOLD,
  ADM_CREATE_GROUP,
  ADM_CREATE_CUSTODIAN,
  ADM_DISSOLVE_CUSTODIAN,
  ADM_REMOVE_MEMBER,
  ADM_REMOVE_REKEYED_ADDR,
  ADM_SET_ACTIVE,
  ADM_SET_GUARD,
  ADM_REMOVE_GUARD,
  ADM_SET_PAUSED,
  ADM_SET_POLICY,
  ADM_SET_PRIVILEGES,
  FAR_EXPIRY,
  GT_CUSTODIAN,
  GT_STANDARD,
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
  buildMigrationRekeyPayload,
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
  deployClonedSafe,
  deployValidator,
  fetchSafeCloneConfig,
  readAssetGuard,
  readIsMember,
  readProposal,
  readRekeyedAddress,
  readSafeConfig,
  readSignerGroup,
  readTransactionGroup,
  toSafeTxnGroup,
  type SafeTxn,
} from '../../src'
import { AdminChange, AlgoSafeClient, AlgoSafeFactory } from '../artifacts/algo_safe/AlgoSafeClient'
import { AlgoSafeTxnValidatorFactory } from '../artifacts/algo_safe_validator/AlgoSafeTxnValidatorClient'

function mkAdminChange(partial: Partial<AdminChange>): AdminChange {
  return createAdminChange(partial)
}

// ---------------------------------------------------------------------------
// v3.0.0 removed the read-only ABI getters from the contract; these shims read
// the same data straight from box / global state via the src readers, keeping
// the historical `{ return: ... }` shape at the call sites below.
// ---------------------------------------------------------------------------

const getConfig = async (client: AlgoSafeClient) => {
  const config = await readSafeConfig(client)
  return {
    return: [config.name, config.groupCount, config.nextGroupId, config.nextProposalId, config.paused, config.version] as const,
  }
}
const getSignerGroup = async (client: AlgoSafeClient, groupId: bigint) => ({
  return: await readSignerGroup(client, groupId),
})
const getProposal = async (client: AlgoSafeClient, proposalId: bigint) => ({
  return: await readProposal(client, proposalId),
})
const getTransactionGroup = async (client: AlgoSafeClient, proposalId: bigint, payloadIndex: bigint) => ({
  return: await readTransactionGroup(client, proposalId, payloadIndex),
})
const isMember = async (client: AlgoSafeClient, groupId: bigint, account: string) => ({
  return: await readIsMember(client, groupId, account),
})
const getActivePrivGroupCount = async (client: AlgoSafeClient) => ({
  return: (await readSafeConfig(client)).activePrivGroupCount,
})
const isRekeyedAddress = async (client: AlgoSafeClient, account: string) => ({
  return: (await readRekeyedAddress(client, account)) !== undefined,
})
const getRekeyedAddress = async (client: AlgoSafeClient, account: string) => ({
  return: await readRekeyedAddress(client, account),
})
const hasAssetGuard = async (client: AlgoSafeClient, custodianGroupId: bigint, assetId: bigint) => ({
  return: (await readAssetGuard(client, custodianGroupId, assetId)) !== undefined,
})
const getAssetGuard = async (client: AlgoSafeClient, custodianGroupId: bigint, assetId: bigint) => ({
  return: await readAssetGuard(client, custodianGroupId, assetId),
})

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

// Box key for a composite {uint64, Account}-keyed BoxMap: ASCII prefix + 8-byte
// big-endian id + 32-byte account public key.
function boxKeyComposite(prefix: string, n: bigint, addr: string): Uint8Array {
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
    // The safe pins the AlgoSafeTxnValidator library by bytecode hash at
    // createApplication, so deploy the validator first (stateless bare create).
    const validatorFactory = localnet.algorand.client.getTypedAppFactory(AlgoSafeTxnValidatorFactory, {
      defaultSender: deployer,
    })
    const { appClient: validatorClient } = await validatorFactory.send.create.bare({ suppressLog: true })
    const factory = localnet.algorand.client.getTypedAppFactory(AlgoSafeFactory, {
      defaultSender: deployer,
    })
    const { appClient } = await factory.send.create.createApplication({
      args: { name: 'Test Safe', validatorAppId: validatorClient.appId },
      suppressLog: true,
    })
    // Fund the app account for box MBR and inner-transaction payments.
    await localnet.algorand.send.payment({
      amount: (5).algo(),
      sender: deployer,
      receiver: appClient.appAddress,
      suppressLog: true,
    })
    return { client: appClient, deployer, validatorAppId: validatorClient.appId }
  }

  const deployAndBootstrap = async () => {
    const { client, deployer, validatorAppId } = await deploy()
    await client.send.bootstrap({ args: { groupName: 'Admins' }, suppressLog: true })
    return { client, deployer, validatorAppId }
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

    const config = await getConfig(client)
    const [name, groupCount, nextGroupId, nextProposalId, paused, version] = config.return!
    expect(name).toBe('Test Safe')
    expect(groupCount).toBe(1n)
    expect(nextGroupId).toBe(2n)
    expect(nextProposalId).toBe(1n)
    expect(paused).toBe(0n)
    expect(typeof version).toBe('string')
    expect(version.length).toBeGreaterThan(0)

    const group = await getSignerGroup(client, 1n)
    expect(group.return!.threshold).toBe(1n)
    expect(group.return!.memberCount).toBe(1n)
    expect(group.return!.adminPrivileges).toBe(PRIV_ALL)
    expect(group.return!.allowedActions).toBe(ACT_ALL)

    const memberCheck = await isMember(client, 1n, deployer.toString())
    expect(memberCheck.return).toBe(true)
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
    const proposal = await getProposal(client, pid!)
    expect(proposal.return!.approvalsCount).toBe(1n)
    expect(proposal.return!.status).toBe(2n) // READY

    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })

    const recipInfo = await localnet.algorand.account.getInformation(recipient)
    expect(recipInfo.balance.microAlgo).toBe((1).algo().microAlgo)

    const after = await getProposal(client, pid!)
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

    const after = await getProposal(client, pid!)
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

    const stored = await getTransactionGroup(client, pid!, 1n)
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

    const stored = await getTransactionGroup(client, pid!, 1n)
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

    const stored = await getTransactionGroup(client, pid!, 1n)
    expect(stored.return!.length).toBe(3)
    expect(stored.return![0][0]).toBe(TX_APP)
    expect(decodeAppTxn(stored.return![0][1]).appId).toBe(targetAppId) // tx0 appId
    expect(decodeAppTxn(stored.return![1][1]).appId).toBe(targetAppId) // tx1 appId
    expect(decodeAppTxn(stored.return![2][1]).appId).toBe(targetAppId) // tx2 appId

    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })

    const after = await getProposal(client, pid!)
    expect(after.return!.status).toBe(3n) // EXECUTED
  })

  test('splits a 6-payment group across two payload slots and executes them atomically', async () => {
    // populateAppCallResources simulation doesn't discover proposals(1) because the ABI
    // routing validation loop consumes the 700-opcode initial budget before the method
    // body (and ensureBudget) fires for multi-element payloads. We bypass resource
    // population for all three calls and supply exact box references manually.
    const { client, deployer, validatorAppId } = await deployAndBootstrap()
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

    const stored1 = await getTransactionGroup(client, pid, 1n)
    expect(stored1.return!.length).toBe(3)
    expect(stored1.return![0][0]).toBe(TX_PAYMENT)
    const stored2 = await getTransactionGroup(client, pid, 2n)
    expect(stored2.return!.length).toBe(3)
    expect(stored2.return![0][0]).toBe(TX_PAYMENT)

    // execute: accesses proposals(1), groups(1), transactionGroups(8), transactionGroups(9),
    //   the recipient account (inner payment Receiver field), and the validator
    //   app (payload validation C2C calls)
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
      appReferences: [validatorAppId],
    })

    const after = await getProposal(client, pid)
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

    const group = await getSignerGroup(client, 2n)
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
    await client.send.approveProposal({ args: { proposalId: pid!, expectedPayloadVersion: 1n, ensureBudgetValue: 0n }, sender: b, suppressLog: true })
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
      client.send.approveProposal({ args: { proposalId: pid!, expectedPayloadVersion: 1n, ensureBudgetValue: 0n }, sender: stranger, suppressLog: true }),
    ).rejects.toThrow()

    // Proposer already auto-approved, so approving again must fail.
    await expect(client.send.approveProposal({ args: { proposalId: pid!, expectedPayloadVersion: 1n, ensureBudgetValue: 0n }, suppressLog: true })).rejects.toThrow()
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

    const stored = await getTransactionGroup(client, xferPid!, 1n)
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

    const group = await getSignerGroup(client, 2n)
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

    let group = await getSignerGroup(client, 2n)
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

    group = await getSignerGroup(client, 2n)
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

    group = await getSignerGroup(client, 2n)
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

    group = await getSignerGroup(client, 2n)
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

    let group = await getSignerGroup(client, 2n)
    expect(group.return!.memberCount).toBe(2n)

    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_REMOVE_MEMBER, targetGroupId: 2n, memberAddr: b.toString() }),
    )
    group = await getSignerGroup(client, 2n)
    expect(group.return!.memberCount).toBe(1n)

    const stillMember = await isMember(client, 2n, b.toString())
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

    const proposal = await getProposal(client, pid!)
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

    const stored = await getTransactionGroup(client, pid!, 1n)
    expect(decodeAppTxn(stored.return![0][1]).appArgs.length).toBe(6)

    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })
    const after = await getProposal(client, pid!)
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

    const stored = await getTransactionGroup(client, pid!, 1n)
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

    const after = await getProposal(client, pid!)
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

    const stored = await getTransactionGroup(client, pid!, 1n)
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

    const stored = await getTransactionGroup(client, pid!, 1n)
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
    await client.send.approveProposal({ args: { proposalId: pid!, expectedPayloadVersion: 1n, ensureBudgetValue: 0n }, sender: honestMember, suppressLog: true })
    const ready = await getProposal(client, pid!)
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
    const ready = await getProposal(client, pid!)
    expect(ready.return!.status).toBe(2n) // READY

    // Governance removes the attacker from the group.
    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_REMOVE_MEMBER, targetGroupId: treasuryGroupId, memberAddr: attacker.toString() }),
    )
    const stillMember = await isMember(client, treasuryGroupId, attacker.toString())
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

    const initialCount = await getActivePrivGroupCount(client)
    expect(initialCount.return).toBe(1n)

    // Proposal-time validation deferred; lockout guard is enforced at execution.
    const { return: pid } = await client.send.proposeAdminChange({
      args: {
        groupId: 1n,
        change: mkAdminChange({ changeType: ADM_SET_PRIVILEGES, targetGroupId: 1n, adminPrivileges: 0n }),
        expiryRound: FAR_EXPIRY,
        ensureBudgetValue: 0n,
      },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await expect(
      client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams }),
    ).rejects.toThrow()

    const countAfter = await getActivePrivGroupCount(client)
    expect(countAfter.return).toBe(1n)
  })

  test('rejects deactivating the sole active PRIV_GROUP holder (M-01 lockout guard)', async () => {
    const { client } = await deployAndBootstrap()

    // Proposal-time validation deferred; lockout guard is enforced at execution.
    const { return: pid } = await client.send.proposeAdminChange({
      args: {
        groupId: 1n,
        change: mkAdminChange({ changeType: ADM_SET_ACTIVE, targetGroupId: 1n, activeFlag: 0n }),
        expiryRound: FAR_EXPIRY,
        ensureBudgetValue: 0n,
      },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await expect(
      client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams }),
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
    let count = await getActivePrivGroupCount(client)
    expect(count.return).toBe(2n)

    // Group 1 revokes its own PRIV_GROUP — allowed, since group 2 still holds it.
    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_SET_PRIVILEGES, targetGroupId: 1n, adminPrivileges: 0n }),
    )
    count = await getActivePrivGroupCount(client)
    expect(count.return).toBe(1n)

    // Group 2 is now the sole holder — it cannot strip its own PRIV_GROUP either (blocked at execution).
    const { return: pid } = await client.send.proposeAdminChange({
      args: {
        groupId: 2n,
        change: mkAdminChange({ changeType: ADM_SET_PRIVILEGES, targetGroupId: 2n, adminPrivileges: 0n }),
        expiryRound: FAR_EXPIRY,
        ensureBudgetValue: 0n,
      },
      sender: b,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await expect(
      client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams }),
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
    const ready = await getProposal(client, pid!)
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
    await client.send.approveProposal({ args: { proposalId: pid!, expectedPayloadVersion: 1n, ensureBudgetValue: 0n }, sender: b, suppressLog: true })
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

    // Pruned boxes are gone — the state readers resolve undefined for them.
    expect((await getProposal(client, pid!)).return).toBeUndefined()
    expect((await getTransactionGroup(client, pid!, 1n)).return).toBeUndefined()
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

    const stored = await getTransactionGroup(client, pid!, 1n)
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
    await client.send.approveProposal({ args: { proposalId: pid!, expectedPayloadVersion: 1n, ensureBudgetValue: 0n }, sender: secondAdmin, suppressLog: true })
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
    const group = await getSignerGroup(client, 2n)
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
    await client.send.approveProposal({ args: { proposalId: pid!, expectedPayloadVersion: 1n, ensureBudgetValue: 0n }, sender: b, suppressLog: true })

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

  test('clones configuration through bootstrapGroup and blocks proposals until finalizeBootstrap', async () => {
    const { client, deployer } = await deploy()
    const second = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const ops = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    const seed = {
      name: 'Admins',
      threshold: 2n,
      adminPrivileges: PRIV_ALL,
      allowedActions: ACT_ALL,
      limitAssetId: 0n,
      dailyLimit: 0n,
      monthlyLimit: 0n,
      cooldownRounds: 0n,
      groupType: 0n,
    }
    const { return: gid } = await client.send.bootstrapGroup({
      args: {
        seed,
        members: [
          [deployer.toString(), 1n, 'first admin'],
          [second.toString(), 1n, 'second admin'],
        ],
        ensureBudgetValue: 0n,
      },
      suppressLog: true,
    })
    expect(gid).toBe(1n)

    // Members of seeded groups cannot act before the bootstrap phase closes.
    await expect(
      client.send.proposeTransactionGroup({
        args: {
          groupId: 1n,
          payload: toSafeTxnGroup([safePayment(ops.toString(), 1000n)]),
          expiryRound: FAR_EXPIRY,
          execute: false,
          ensureBudgetValue: 10000n,
        },
        suppressLog: true,
        staticFee: (0.2).algo(),
      }),
    ).rejects.toThrow()

    await client.send.bootstrapRekeyedAddress({ args: { addr: ops.toString(), label: 'ops account' }, suppressLog: true })
    await client.send.finalizeBootstrap({ args: {}, suppressLog: true })

    const group = await getSignerGroup(client, 1n)
    expect(group.return!.threshold).toBe(2n)
    expect(group.return!.memberCount).toBe(2n)
    expect(group.return!.adminPrivileges).toBe(PRIV_ALL)
    const isSecondMember = await isMember(client, 1n, second.toString())
    expect(isSecondMember.return).toBe(true)

    const isRekeyed = await isRekeyedAddress(client, ops.toString())
    expect(isRekeyed.return).toBe(true)
    const rekeyedEntry = await getRekeyedAddress(client, ops.toString())
    expect(rekeyedEntry.return!.label).toBe('ops account')

    // Seeding is closed after finalize.
    await expect(
      client.send.bootstrapGroup({ args: { seed, members: [[ops.toString(), 1n, 'late']], ensureBudgetValue: 0n }, suppressLog: true }),
    ).rejects.toThrow()
    await expect(client.send.finalizeBootstrap({ args: {}, suppressLog: true })).rejects.toThrow()

    // Governance now works: a proposal collects 1 of 2 approvals and stays ACTIVE.
    const { return: pid } = await client.send.proposeTransactionGroup({
      args: {
        groupId: 1n,
        payload: toSafeTxnGroup([safePayment(ops.toString(), 1000n)]),
        expiryRound: FAR_EXPIRY,
        execute: false,
        ensureBudgetValue: 10000n,
      },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    const proposal = await getProposal(client, pid!)
    expect(proposal.return!.approvalsCount).toBe(1n)
    expect(proposal.return!.status).toBe(1n) // ACTIVE — threshold of 2 not yet met
  })

  test('finalizeBootstrap requires at least one active group with admin privileges', async () => {
    const { client, deployer } = await deploy()
    const seed = {
      name: 'Agents',
      threshold: 1n,
      adminPrivileges: 0n,
      allowedActions: ACT_PAY,
      limitAssetId: 0n,
      dailyLimit: 0n,
      monthlyLimit: 0n,
      cooldownRounds: 0n,
      groupType: 0n,
    }
    await client.send.bootstrapGroup({
      args: { seed, members: [[deployer.toString(), 1n, 'agent']], ensureBudgetValue: 0n },
      suppressLog: true,
    })
    await expect(client.send.finalizeBootstrap({ args: {}, suppressLog: true })).rejects.toThrow()
  })

  test('manages the rekeyed-address registry through governed admin proposals', async () => {
    const { client } = await deployAndBootstrap()
    const external = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const agent = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_ADD_REKEYED_ADDR, memberAddr: external.toString(), memberLabel: 'treasury ops' }),
    )
    const isRekeyed = await isRekeyedAddress(client, external.toString())
    expect(isRekeyed.return).toBe(true)
    const entry = await getRekeyedAddress(client, external.toString())
    expect(entry.return!.label).toBe('treasury ops')

    // Duplicate registration is rejected at execution (not proposal) time.
    const { return: dupPid } = await client.send.proposeAdminChange({
      args: {
        groupId: 1n,
        change: mkAdminChange({ changeType: ADM_ADD_REKEYED_ADDR, memberAddr: external.toString() }),
        expiryRound: FAR_EXPIRY,
        ensureBudgetValue: 0n,
      },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await expect(
      client.send.executeProposal({ args: { proposalId: dupPid!, ensureBudgetValue: 6000n }, ...execParams }),
    ).rejects.toThrow()

    // A group without admin privileges cannot manage the registry.
    await governAdminChange(
      client,
      1n,
      mkAdminChange({
        changeType: ADM_CREATE_GROUP,
        groupName: 'NoAdmin',
        threshold: 1n,
        memberAddr: agent.toString(),
        allowedActions: ACT_PAY,
        adminPrivileges: 0n,
      }),
    )
    await expect(
      client.send.proposeAdminChange({
        args: {
          groupId: 2n,
          change: mkAdminChange({ changeType: ADM_REMOVE_REKEYED_ADDR, memberAddr: external.toString() }),
          expiryRound: FAR_EXPIRY,
          ensureBudgetValue: 0n,
        },
        sender: agent,
        suppressLog: true,
        staticFee: (0.2).algo(),
      }),
    ).rejects.toThrow()

    await governAdminChange(client, 1n, mkAdminChange({ changeType: ADM_REMOVE_REKEYED_ADDR, memberAddr: external.toString() }))
    const afterRemove = await isRekeyedAddress(client, external.toString())
    expect(afterRemove.return).toBe(false)
  })

  test('migrates a safe to a freshly deployed clone (config, rekeyed accounts, self-rekey)', async () => {
    const { client, deployer } = await deployAndBootstrap()
    const second = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const external = await localnet.context.generateAccount({ initialFunds: (2).algo() })
    const algod = localnet.algorand.client.algod

    // Old safe: two admins, a registered + actually rekeyed external account.
    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_ADD_MEMBER, targetGroupId: 1n, memberAddr: second.toString(), memberType: 1n, memberLabel: 'second' }),
    )
    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_ADD_REKEYED_ADDR, memberAddr: external.toString(), memberLabel: 'ops' }),
    )
    await localnet.algorand.send.payment({
      sender: external,
      receiver: external,
      amount: (0).algo(),
      rekeyTo: client.appAddress,
      suppressLog: true,
    })

    // Clone the configuration onto a fresh deployment via the library helpers.
    const config = await fetchSafeCloneConfig(algod, { appId: client.appId, address: client.appAddress.toString() })
    expect(config.groups).toHaveLength(1)
    expect(config.groups[0].members.map((member) => member.addr).sort()).toEqual(
      [deployer.toString(), second.toString()].sort(),
    )
    expect(config.rekeyedAddresses.map((record) => record.address)).toEqual([external.toString()])

    const cloned = await deployClonedSafe({
      algodClient: algod,
      sender: deployer.toString(),
      signer: algosdk.makeBasicAccountTransactionSigner(deployer),
      validatorAppId: (await deployValidator({
        algodClient: algod,
        sender: deployer.toString(),
        signer: algosdk.makeBasicAccountTransactionSigner(deployer),
      })),
      config,
    })

    const newClient = localnet.algorand.client.getTypedAppClientById(AlgoSafeClient, {
      appId: cloned.appId,
      defaultSender: deployer,
    })
    const newGroup = await getSignerGroup(newClient, 1n)
    expect(newGroup.return!.memberCount).toBe(2n)
    expect(newGroup.return!.adminPrivileges).toBe(PRIV_ALL)
    const clonedRekeyed = await isRekeyedAddress(newClient, external.toString())
    expect(clonedRekeyed.return).toBe(true)

    // Migration rekey on the old safe: external account first, the safe last.
    const payload = buildMigrationRekeyPayload([external.toString()], cloned.appAddress)
    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 1n, payload, expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })

    const oldSafeInfo = await localnet.algorand.account.getInformation(client.appAddress)
    expect(oldSafeInfo.authAddr?.toString()).toBe(cloned.appAddress)
    const externalInfo = await localnet.algorand.account.getInformation(external)
    expect(externalInfo.authAddr?.toString()).toBe(cloned.appAddress)
  })

  test('rejects a stale approval when a multi-chunk payload is edited after review but before confirmation (H-01 regression)', async () => {
    const { client } = await deployAndBootstrap()
    const proposer = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const approver = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const honestRecipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })
    const attackerRecipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    // 2-of-2 Treasury group: proposer + an independent approver.
    await governAdminChange(
      client,
      1n,
      mkAdminChange({
        changeType: ADM_CREATE_GROUP,
        groupName: 'Treasury',
        threshold: 1n,
        memberAddr: proposer.toString(),
        allowedActions: ACT_PAY,
        adminPrivileges: 0n,
      }),
    )
    const groupId = 2n
    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_ADD_MEMBER, targetGroupId: groupId, memberAddr: approver.toString() }),
    )
    await governAdminChange(
      client,
      1n,
      mkAdminChange({ changeType: ADM_CHANGE_THRESHOLD, targetGroupId: groupId, threshold: 2n }),
    )

    // Proposer creates a 2-chunk proposal; chunk 1 is fixed forever, chunk 2 starts benign.
    const { return: pid } = await client.send.proposeTransactionGroup({
      args: {
        groupId,
        payload: toSafeTxnGroup([safePayment(honestRecipient.toString(), (0.1).algo().microAlgo)]),
        expiryRound: FAR_EXPIRY,
        execute: false,
        ensureBudgetValue: 10000n,
      },
      sender: proposer,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await client.send.appendTransactionGroupPayload({
      args: {
        proposalId: pid!,
        payloadIndex: 2n,
        payload: toSafeTxnGroup([safePayment(honestRecipient.toString(), (0.1).algo().microAlgo)]),
        ensureBudgetValue: 10000n,
      },
      sender: proposer,
      suppressLog: true,
      staticFee: (0.1).algo(),
    })

    // Approver reviews the current (honest) content and records the payload version it applies to.
    const reviewed = await getProposal(client, pid!)
    const reviewedVersion = reviewed.return!.payloadVersion
    expect(reviewedVersion).toBe(2n) // 1 at creation + 1 for the append

    // Proposer front-runs the approver's decision: edits chunk 2 to redirect funds — still
    // legal on its own, since approvalsCount is still 1 (only the proposer's auto-approval).
    await client.send.appendTransactionGroupPayload({
      args: {
        proposalId: pid!,
        payloadIndex: 2n,
        payload: toSafeTxnGroup([safePayment(attackerRecipient.toString(), (0.1).algo().microAlgo)]),
        ensureBudgetValue: 10000n,
      },
      sender: proposer,
      suppressLog: true,
      staticFee: (0.1).algo(),
    })

    // The approver's approval, bound to the version they actually reviewed, must fail rather
    // than silently applying to the swapped (attacker) content.
    await expect(
      client.send.approveProposal({
        args: { proposalId: pid!, expectedPayloadVersion: reviewedVersion, ensureBudgetValue: 0n },
        sender: approver,
        suppressLog: true,
      }),
    ).rejects.toThrow()

    // Threshold was never met on the swapped content — nothing executed.
    const afterStaleAttempt = await getProposal(client, pid!)
    expect(afterStaleAttempt.return!.approvalsCount).toBe(1n)
    expect(afterStaleAttempt.return!.status).toBe(1n) // ACTIVE
  })

  test('pause blocks fund-moving transaction-group actions but never blocks governance, including unpausing (M-01 regression)', async () => {
    const { client } = await deployAndBootstrap()
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    // A pending, already-READY (1-of-1) transaction-group proposal exists before pausing.
    const { return: pid } = await client.send.proposeTransactionGroup({
      args: {
        groupId: 1n,
        payload: toSafeTxnGroup([safePayment(recipient.toString(), (0.1).algo().microAlgo)]),
        expiryRound: FAR_EXPIRY,
        execute: false,
        ensureBudgetValue: 10000n,
      },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    // Pause the safe through governance.
    await governAdminChange(client, 1n, mkAdminChange({ changeType: ADM_SET_PAUSED, activeFlag: 1n }))
    const pausedConfig = await getConfig(client)
    expect(pausedConfig.return![4]).toBe(1n)

    // New transaction-group proposals are blocked.
    await expect(
      client.send.proposeTransactionGroup({
        args: {
          groupId: 1n,
          payload: toSafeTxnGroup([safePayment(recipient.toString(), (0.1).algo().microAlgo)]),
          expiryRound: FAR_EXPIRY,
          execute: false,
          ensureBudgetValue: 10000n,
        },
        suppressLog: true,
        staticFee: (0.2).algo(),
      }),
    ).rejects.toThrow()

    // Appending to the existing pending transaction-group proposal is blocked.
    await expect(
      client.send.appendTransactionGroupPayload({
        args: {
          proposalId: pid!,
          payloadIndex: 2n,
          payload: toSafeTxnGroup([safePayment(recipient.toString(), (0.1).algo().microAlgo)]),
          ensureBudgetValue: 10000n,
        },
        suppressLog: true,
        staticFee: (0.1).algo(),
      }),
    ).rejects.toThrow()

    // Executing the pending transaction-group proposal is blocked.
    await expect(
      client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams }),
    ).rejects.toThrow()

    // Governance — including the unpause itself — is never blocked by pause.
    await governAdminChange(client, 1n, mkAdminChange({ changeType: ADM_SET_PAUSED, activeFlag: 0n }))
    const unpausedConfig = await getConfig(client)
    expect(unpausedConfig.return![4]).toBe(0n)

    // The previously blocked proposal now executes normally.
    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })
    const recipInfo = await localnet.algorand.account.getInformation(recipient)
    expect(recipInfo.balance.microAlgo).toBe((0.1).algo().microAlgo)
  })

  test('rejects appending a payload chunk that would push the aggregate transaction count past MAX_GROUP_TXNS (M-02 regression)', async () => {
    // Payload chunks are kept to <= 3 elements throughout (matching the "splits a
    // 6-payment group" test above): populateAppCallResources' resource-discovery
    // simulation exceeds the 700-opcode initial budget for larger multi-element
    // payloads, so every call here bypasses it and supplies box references manually.
    const { client, deployer } = await deployAndBootstrap()
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })
    const appId = BigInt(client.appId)
    const deployerAddr = deployer.toString()
    const pid = 1n // first proposal in a fresh test scope
    const TXG_KEY_MULT = 7n
    const pays = (n: number) => Array.from({ length: n }, (_, i) => safePayment(recipient.toString(), BigInt(i + 1) * 1000n))
    const appendBoxRefs = (slot: bigint) => [
      { appId, name: boxKeyU64('p', pid) },
      { appId, name: boxKeyU64('g', 1n) },
      { appId, name: boxKeyComposite('m', 1n, deployerAddr) },
      { appId, name: boxKeyU64('txg', pid * TXG_KEY_MULT + slot) },
    ]
    const appendChunk = (slot: bigint, count: number) =>
      client.send.appendTransactionGroupPayload({
        args: { proposalId: pid, payloadIndex: slot, payload: toSafeTxnGroup(pays(count)), ensureBudgetValue: 10000n },
        suppressLog: true,
        staticFee: (0.1).algo(),
        populateAppCallResources: false,
        boxReferences: appendBoxRefs(slot),
      })

    // Slot 1 (propose) + slots 2-5 (append) each carry 3 transactions = 15 total.
    await client.send.proposeTransactionGroup({
      args: { groupId: 1n, payload: toSafeTxnGroup(pays(3)), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      suppressLog: true,
      staticFee: (0.2).algo(),
      populateAppCallResources: false,
      boxReferences: [
        { appId, name: boxKeyU64('g', 1n) },
        { appId, name: boxKeyComposite('m', 1n, deployerAddr) },
        { appId, name: boxKeyU64('p', pid) },
        { appId, name: boxKeyComposite('a', pid, deployerAddr) },
        { appId, name: boxKeyU64('txg', pid * TXG_KEY_MULT + 1n) },
      ],
    })
    for (const slot of [2n, 3n, 4n, 5n]) {
      await appendChunk(slot, 3)
    }

    // Slot 6 with 1 more transaction reaches exactly MAX_GROUP_TXNS (16) — succeeds.
    await appendChunk(6n, 1)

    // Re-editing slot 6 with a different single transaction (an overwrite, not an
    // addition) must not falsely inflate the running total — still succeeds.
    await appendChunk(6n, 1)

    // Growing slot 6 to 2 transactions would push the aggregate to 17 — rejected.
    await expect(appendChunk(6n, 2)).rejects.toThrow()
  })

  test('rejects mixing bootstrap() after bootstrapGroup() (M-03 regression)', async () => {
    const { client } = await deploy()
    const solo = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const seed = {
      name: 'Seeded',
      threshold: 1n,
      adminPrivileges: PRIV_ALL,
      allowedActions: ACT_ALL,
      limitAssetId: 0n,
      dailyLimit: 0n,
      monthlyLimit: 0n,
      cooldownRounds: 0n,
      groupType: 0n,
    }
    await client.send.bootstrapGroup({
      args: { seed, members: [[solo.toString(), 1n, 'solo']], ensureBudgetValue: 0n },
      suppressLog: true,
    })

    await expect(client.send.bootstrap({ args: { groupName: 'Admins' }, suppressLog: true })).rejects.toThrow()
  })

  test('rejects appending a payload chunk to an expired proposal (2026-07-07-v2 L-01 regression)', async () => {
    const { client } = await deployAndBootstrap()
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })
    const funder = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    // Expiry only a couple of rounds out, so a few follow-up transactions push past it.
    const expiryRound = (await currentRound()) + 2n
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

    // Advance the chain past the expiry round (0-amount self-payments mint rounds
    // on the dev-mode localnet without tripping any min-balance rule).
    while ((await currentRound()) <= expiryRound) {
      await localnet.algorand.send.payment({
        amount: (0).algo(),
        sender: funder,
        receiver: funder,
        suppressLog: true,
      })
    }

    // Appending to the expired proposal must fail, matching approve/execute behaviour.
    await expect(
      client.send.appendTransactionGroupPayload({
        args: {
          proposalId: pid!,
          payloadIndex: 2n,
          payload: toSafeTxnGroup([safePayment(recipient.toString(), (0.1).algo().microAlgo)]),
          ensureBudgetValue: 10000n,
        },
        suppressLog: true,
        staticFee: (0.1).algo(),
      }),
    ).rejects.toThrow()
  })

  test('maps a standard keys-omitted "go offline" keyreg to online=0 (2026-07-07-v2 L-02 regression)', async () => {
    const { deployer } = await deployAndBootstrap()
    const sp = await localnet.algorand.client.algod.getTransactionParams().do()

    // Conventional offline registration: participation keys omitted, nonParticipation unset.
    const goOffline = algosdk.makeKeyRegistrationTxnWithSuggestedParamsFromObject({
      sender: deployer.addr,
      suggestedParams: sp,
    })
    const offlineTuples = algosdkTxnsToSafeTxnGroup([goOffline])
    expect(offlineTuples[0][0]).toBe(TX_KEYREG)
    expect(decodeKeyRegTxn(offlineTuples[0][1]).online).toBe(0n)

    // Permanent opt-out (nonParticipation: true) is also offline.
    const optOut = algosdk.makeKeyRegistrationTxnWithSuggestedParamsFromObject({
      sender: deployer.addr,
      nonParticipation: true,
      suggestedParams: sp,
    })
    expect(decodeKeyRegTxn(algosdkTxnsToSafeTxnGroup([optOut])[0][1]).online).toBe(0n)

    // A keys-supplied registration still maps to online.
    const goOnline = algosdk.makeKeyRegistrationTxnWithSuggestedParamsFromObject({
      sender: deployer.addr,
      voteKey: new Uint8Array(32).fill(1),
      selectionKey: new Uint8Array(32).fill(2),
      stateProofKey: new Uint8Array(64).fill(3),
      voteFirst: 1n,
      voteLast: 1000n,
      voteKeyDilution: 50n,
      suggestedParams: sp,
    })
    expect(decodeKeyRegTxn(algosdkTxnsToSafeTxnGroup([goOnline])[0][1]).online).toBe(1n)
  })

  test("rejects a transaction-group entry that targets the safe's own appId (L-01 regression)", async () => {
    const { client } = await deployAndBootstrap()
    const selfCall = safeAppCall(BigInt(client.appId), [])
    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 1n, payload: toSafeTxnGroup([selfCall]), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    await expect(
      client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams }),
    ).rejects.toThrow()
  })

  // ---------------------------------------------------------------------------
  // Custodian Group tests
  // ---------------------------------------------------------------------------

  test('admin creates a custodian group via ADM_CREATE_CUSTODIAN proposal', async () => {
    const { client } = await deployAndBootstrap()
    const protocol = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_CREATE_CUSTODIAN,
      groupName: 'Lending Protocol',
      threshold: 1n,
      allowedActions: ACT_PAY | ACT_AXFER,
      memberAddr: protocol.toString(),
      memberType: 4n,
      memberLabel: 'lending-contract',
      cooldownRounds: 0n,
    }))

    const config = await getConfig(client)
    expect(config.return![1]).toBe(2n) // groupCount = 2

    const custGroup = await getSignerGroup(client, 2n)
    expect(custGroup.return!.groupType).toBe(GT_CUSTODIAN)
    expect(custGroup.return!.adminPrivileges).toBe(0n)
    expect(custGroup.return!.guardCount).toBe(0n)
    expect(custGroup.return!.active).toBe(1n)

    const memberCheck = await isMember(client, 2n, protocol.toString())
    expect(memberCheck.return).toBe(true)
  })

  test('custodian group cannot be created with admin privileges (_createGroup forces adminPrivileges=0)', async () => {
    const { client } = await deployAndBootstrap()
    const protocol = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    // _createGroup hard-codes adminPrivileges=0 for GT_CUSTODIAN groups even if the field is set.
    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_CREATE_CUSTODIAN,
      groupName: 'Safe Lending',
      threshold: 1n,
      allowedActions: ACT_PAY,
      adminPrivileges: PRIV_ALL, // silently zeroed in _createGroup
      memberAddr: protocol.toString(),
      memberType: 4n,
      memberLabel: 'contract',
    }))

    const custGroup = await getSignerGroup(client, 2n)
    expect(custGroup.return!.adminPrivileges).toBe(0n)
    expect(custGroup.return!.groupType).toBe(GT_CUSTODIAN)
  })

  test('cannot set admin privileges on a custodian group', async () => {
    const { client } = await deployAndBootstrap()
    const protocol = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_CREATE_CUSTODIAN,
      groupName: 'Stream',
      threshold: 1n,
      allowedActions: ACT_PAY,
      memberAddr: protocol.toString(),
      memberType: 4n,
      memberLabel: 'streaming-contract',
    }))

    // proposeAdminChange succeeds (validation deferred to execution), but execute fails.
    const { return: pid } = await client.send.proposeAdminChange({
      args: {
        groupId: 1n,
        change: mkAdminChange({ changeType: ADM_SET_PRIVILEGES, targetGroupId: 2n, adminPrivileges: PRIV_GROUP }),
        expiryRound: FAR_EXPIRY,
        ensureBudgetValue: 0n,
      },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await expect(
      client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams }),
    ).rejects.toThrow()
  })

  test('admin creates an asset guard for a custodian group via ADM_SET_GUARD', async () => {
    const { client } = await deployAndBootstrap()
    const protocol = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    // Create custodian group (group 2).
    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_CREATE_CUSTODIAN,
      groupName: 'Lending',
      threshold: 1n,
      allowedActions: ACT_PAY | ACT_AXFER,
      memberAddr: protocol.toString(),
      memberType: 4n,
      memberLabel: 'lending',
    }))

    // Admin proposes ADM_SET_GUARD for custodian group 2, ALGO guard (limitAssetId=0).
    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_SET_GUARD,
      targetGroupId: 2n,
      limitAssetId: 0n,      // assetId=0 means ALGO
      guardAmount: 500_000n,  // 0.5 ALGO
    }))

    // Guard should now exist.
    const hasGuard = await hasAssetGuard(client, 2n, 0n)
    expect(hasGuard.return).toBe(true)

    const guard = await getAssetGuard(client, 2n, 0n)
    expect(guard.return!.lockedAmount).toBe(500_000n)

    // Group guardCount incremented.
    const custGroup = await getSignerGroup(client, 2n)
    expect(custGroup.return!.guardCount).toBe(1n)

    // A second ADM_SET_GUARD on the same slot updates lockedAmount.
    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_SET_GUARD,
      targetGroupId: 2n,
      limitAssetId: 0n,
      guardAmount: 1_000_000n, // increase to 1 ALGO
    }))

    const updatedGuard = await getAssetGuard(client, 2n, 0n)
    expect(updatedGuard.return!.lockedAmount).toBe(1_000_000n)

    // guardCount should still be 1 (slot reused, not added).
    const updatedCustGroup = await getSignerGroup(client, 2n)
    expect(updatedCustGroup.return!.guardCount).toBe(1n)
  })

  test('admin removes a guard via ADM_REMOVE_GUARD', async () => {
    const { client } = await deployAndBootstrap()
    const protocol = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_CREATE_CUSTODIAN, groupName: 'Stream', threshold: 1n,
      allowedActions: ACT_PAY, memberAddr: protocol.toString(), memberType: 4n, memberLabel: 'stream',
    }))

    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_SET_GUARD, targetGroupId: 2n, limitAssetId: 0n, guardAmount: 200_000n,
    }))

    // Verify guard exists.
    let hasGuard = await hasAssetGuard(client, 2n, 0n)
    expect(hasGuard.return).toBe(true)

    // Admin removes the guard.
    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_REMOVE_GUARD, targetGroupId: 2n, limitAssetId: 0n,
    }))

    hasGuard = await hasAssetGuard(client, 2n, 0n)
    expect(hasGuard.return).toBe(false)

    // guardCount decremented.
    const custGroup = await getSignerGroup(client, 2n)
    expect(custGroup.return!.guardCount).toBe(0n)
  })

  test('custodian can execute a payment within its ALGO guard allocation', async () => {
    const { client } = await deployAndBootstrap()
    const protocol = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_CREATE_CUSTODIAN, groupName: 'Lending', threshold: 1n,
      allowedActions: ACT_PAY, memberAddr: protocol.toString(), memberType: 4n, memberLabel: 'lending',
    }))

    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_SET_GUARD, targetGroupId: 2n, limitAssetId: 0n, guardAmount: 500_000n,
    }))

    // Custodian proposes and executes a payment of 100_000 microalgo.
    const payment = safePayment(recipient.toString(), 100_000n)
    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 2n, payload: toSafeTxnGroup([payment]), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      sender: protocol,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })

    // Guard lockedAmount should decrease by 100_000.
    const guardAfter = await getAssetGuard(client, 2n, 0n)
    expect(guardAfter.return!.lockedAmount).toBe(400_000n)
  })

  test('custodian payment is rejected when it exceeds the guard allocation', async () => {
    const { client } = await deployAndBootstrap()
    const protocol = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const recipient = await localnet.context.generateAccount({ initialFunds: (0).algo() })

    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_CREATE_CUSTODIAN, groupName: 'Lending', threshold: 1n,
      allowedActions: ACT_PAY, memberAddr: protocol.toString(), memberType: 4n, memberLabel: 'lending',
    }))

    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_SET_GUARD, targetGroupId: 2n, limitAssetId: 0n, guardAmount: 100_000n,
    }))

    // Payment larger than guard.
    const payment = safePayment(recipient.toString(), 200_000n)
    const { return: pid } = await client.send.proposeTransactionGroup({
      args: { groupId: 2n, payload: toSafeTxnGroup([payment]), expiryRound: FAR_EXPIRY, execute: false, ensureBudgetValue: 10000n },
      sender: protocol,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await expect(
      client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams }),
    ).rejects.toThrow()
  })

  test('custodian self-dissolves via ADM_DISSOLVE_CUSTODIAN (requires zero guards first)', async () => {
    const { client } = await deployAndBootstrap()
    const protocol = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_CREATE_CUSTODIAN, groupName: 'Dissolve-Me', threshold: 1n,
      allowedActions: ACT_PAY, memberAddr: protocol.toString(), memberType: 4n, memberLabel: 'protocol',
    }))

    // Dissolution is self-proposed by the custodian group itself. memberAddr
    // names the last remaining member so its box is deleted too (M-01).
    const { return: pid } = await client.send.proposeAdminChange({
      args: {
        groupId: 2n,
        change: mkAdminChange({ changeType: ADM_DISSOLVE_CUSTODIAN, targetGroupId: 2n, memberAddr: protocol.toString() }),
        expiryRound: FAR_EXPIRY,
        ensureBudgetValue: 0n,
      },
      sender: protocol,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })

    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })

    // groupCount decremented.
    const config = await getConfig(client)
    expect(config.return![1]).toBe(1n)

    // M-01 regression: the dissolved group's member box was deleted with the
    // group — no MBR is orphaned by dissolution.
    expect((await isMember(client, 2n, protocol.toString())).return).toBe(false)
    expect((await getSignerGroup(client, 2n)).return).toBeUndefined()
  })

  test('dissolution is blocked when custodian still has active guards', async () => {
    const { client } = await deployAndBootstrap()
    const protocol = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_CREATE_CUSTODIAN, groupName: 'Guarded', threshold: 1n,
      allowedActions: ACT_PAY, memberAddr: protocol.toString(), memberType: 4n, memberLabel: 'p',
    }))

    // Admin creates a guard (admin-only, no dual-key).
    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_SET_GUARD, targetGroupId: 2n, limitAssetId: 0n, guardAmount: 100_000n,
    }))

    // Dissolution attempt should fail because guardCount > 0.
    const { return: dpid } = await client.send.proposeAdminChange({
      args: { groupId: 2n, change: mkAdminChange({ changeType: ADM_DISSOLVE_CUSTODIAN, targetGroupId: 2n }), expiryRound: FAR_EXPIRY, ensureBudgetValue: 0n },
      sender: protocol, suppressLog: true, staticFee: (0.2).algo(),
    })
    await expect(
      client.send.executeProposal({ args: { proposalId: dpid!, ensureBudgetValue: 6000n }, ...execParams }),
    ).rejects.toThrow()
  })

  test('admin cannot dissolve a custodian group', async () => {
    const { client } = await deployAndBootstrap()
    const protocol = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_CREATE_CUSTODIAN, groupName: 'Guarded', threshold: 1n,
      allowedActions: ACT_PAY, memberAddr: protocol.toString(), memberType: 4n, memberLabel: 'p',
    }))

    // Admin group (GT_STANDARD) cannot propose ADM_DISSOLVE_CUSTODIAN.
    await expect(
      client.send.proposeAdminChange({
        args: {
          groupId: 1n,
          change: mkAdminChange({ changeType: ADM_DISSOLVE_CUSTODIAN, targetGroupId: 2n }),
          expiryRound: FAR_EXPIRY,
          ensureBudgetValue: 0n,
        },
        suppressLog: true,
        staticFee: (0.2).algo(),
      }),
    ).rejects.toThrow()
  })

  test('deactivating a custodian group via ADM_SET_ACTIVE marks it inactive', async () => {
    const { client } = await deployAndBootstrap()
    const protocol = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_CREATE_CUSTODIAN, groupName: 'Protocol', threshold: 1n,
      allowedActions: ACT_PAY, memberAddr: protocol.toString(), memberType: 4n, memberLabel: 'protocol',
    }))

    let custGroup = await getSignerGroup(client, 2n)
    expect(custGroup.return!.active).toBe(1n)

    await governAdminChange(client, 1n, mkAdminChange({ changeType: ADM_SET_ACTIVE, targetGroupId: 2n, activeFlag: 0n }))

    custGroup = await getSignerGroup(client, 2n)
    expect(custGroup.return!.active).toBe(0n)

    // Re-activate.
    await governAdminChange(client, 1n, mkAdminChange({ changeType: ADM_SET_ACTIVE, targetGroupId: 2n, activeFlag: 1n }))
    custGroup = await getSignerGroup(client, 2n)
    expect(custGroup.return!.active).toBe(1n)
  })

  test('standard groups have groupType GT_STANDARD=0 by default', async () => {
    const { client } = await deployAndBootstrap()
    const adminGroup = await getSignerGroup(client, 1n)
    expect(adminGroup.return!.groupType).toBe(GT_STANDARD)
  })

  // ---------------------------------------------------------------------------
  // 2026-07-12 audit remediation coverage (I-01 test gaps + finding regressions)
  // ---------------------------------------------------------------------------

  // Box key for the assetGuards map: 'ag' + custodianGroupId (8B BE) + assetId (8B BE).
  function guardBoxKey(custodianGroupId: bigint, assetId: bigint): Uint8Array {
    const prefix = new TextEncoder().encode('ag')
    const key = new Uint8Array(prefix.length + 16)
    key.set(prefix)
    const view = new DataView(key.buffer)
    view.setBigUint64(prefix.length, custodianGroupId, false)
    view.setBigUint64(prefix.length + 8, assetId, false)
    return key
  }

  test('custodian ASA transfer deducts from the asset guard; close-out debits the live balance (I-01)', async () => {
    const { client, deployer, validatorAppId } = await deployAndBootstrap()
    const protocol = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    // ASA held by the safe: create, opt the safe in via governance, fund 500.
    const createAsset = await localnet.algorand.send.assetCreate({
      sender: deployer,
      total: 1_000_000n,
      decimals: 0,
      unitName: 'GRD',
      assetName: 'Guarded ASA',
      suppressLog: true,
    })
    const assetId = createAsset.assetId
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

    const recipient = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    await localnet.algorand.send.assetOptIn({ sender: recipient, assetId, suppressLog: true })

    // Custodian group (group 2) with an ASA guard of 100 units.
    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_CREATE_CUSTODIAN, groupName: 'AsaCustodian', threshold: 1n,
      allowedActions: ACT_AXFER, memberAddr: protocol.toString(), memberType: 4n, memberLabel: 'protocol',
    }))
    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_SET_GUARD, targetGroupId: 2n, limitAssetId: assetId, guardAmount: 100n,
    }))

    const custodianXfer = async (amount: bigint, hasClose: 0n | 1n = 0n) => {
      const { return: pid } = await client.send.proposeTransactionGroup({
        args: {
          groupId: 2n,
          payload: toSafeTxnGroup([
            createAssetSafeTxn({
              sender: ZERO_ADDR,
              xferAsset: assetId,
              assetReceiver: recipient.toString(),
              assetAmount: amount,
              hasClose,
              assetCloseTo: hasClose ? recipient.toString() : ZERO_ADDR,
              note: '',
            }),
          ]),
          expiryRound: FAR_EXPIRY,
          execute: false,
          ensureBudgetValue: 0n,
        },
        sender: protocol,
        suppressLog: true,
        staticFee: (0.2).algo(),
      })
      // The execution's reference set (4 boxes + asset + recipient + validator
      // app) exceeds what the auto-populator can fit into this single app
      // call, so supply the exact resources explicitly.
      const appId = BigInt(client.appId)
      await client.send.executeProposal({
        args: { proposalId: pid!, ensureBudgetValue: 6000n },
        ...execParams,
        populateAppCallResources: false,
        boxReferences: [
          { appId, name: boxKeyU64('p', pid!) },
          { appId, name: boxKeyU64('g', 2n) },
          { appId, name: boxKeyU64('txg', pid! * 7n + 1n) },
          { appId, name: guardBoxKey(2n, assetId) },
        ],
        assetReferences: [assetId],
        accountReferences: [recipient.toString()],
        appReferences: [validatorAppId],
      })
    }

    // Transfer of 50 units within the guard succeeds; guard decrements to 50.
    await custodianXfer(50n)
    let guard = await getAssetGuard(client, 2n, assetId)
    expect(guard.return!.lockedAmount).toBe(50n)

    // 51 > remaining guard — rejected.
    await expect(custodianXfer(51n)).rejects.toThrow()

    // ADM_SET_GUARD on an existing guard UPDATES lockedAmount without touching guardCount.
    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_SET_GUARD, targetGroupId: 2n, limitAssetId: assetId, guardAmount: 450n,
    }))
    guard = await getAssetGuard(client, 2n, assetId)
    expect(guard.return!.lockedAmount).toBe(450n)
    const custGroup = await getSignerGroup(client, 2n)
    expect(custGroup.return!.guardCount).toBe(1n)

    // ASA close-out (declared amount 0) must debit the LIVE holding (450), not 0.
    await custodianXfer(0n, 1n)
    guard = await getAssetGuard(client, 2n, assetId)
    expect(guard.return!.lockedAmount).toBe(0n)
    const safeHolding = await localnet.algorand.client.algod
      .accountAssetInformation(client.appAddress, assetId)
      .do()
      .catch(() => undefined)
    expect(safeHolding?.assetHolding?.amount ?? 0n).toBe(0n)
  })

  test('custodian ALGO close-out from a rekeyed sender debits the full live balance, not the declared amount (I-01)', async () => {
    const { client } = await deployAndBootstrap()
    const protocol = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const external = await localnet.context.generateAccount({ initialFunds: (0.2).algo() })
    const recipient = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    // Hand the external account to the safe (the rekey txn fee comes out of
    // its balance, so read the live balance afterwards).
    await localnet.algorand.send.payment({
      sender: external,
      receiver: external,
      amount: (0).algo(),
      rekeyTo: client.appAddress,
      suppressLog: true,
    })
    const liveBalance = (await localnet.algorand.account.getInformation(external)).balance.microAlgo

    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_CREATE_CUSTODIAN, groupName: 'CloseCustodian', threshold: 1n,
      allowedActions: ACT_PAY, memberAddr: protocol.toString(), memberType: 4n, memberLabel: 'protocol',
    }))
    // Guard 1 µALGO short of the live balance — the 0-amount close-out must be
    // accounted at the swept balance and therefore rejected.
    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_SET_GUARD, targetGroupId: 2n, limitAssetId: 0n, guardAmount: liveBalance - 1n,
    }))

    const { return: pid } = await client.send.proposeTransactionGroup({
      args: {
        groupId: 2n,
        payload: toSafeTxnGroup([
          createPaymentSafeTxn({
            sender: external.toString(),
            receiver: recipient.toString(),
            amount: 0n, // declared amount 0 — the sweep is what must be charged
            hasClose: 1n,
            closeRemainderTo: recipient.toString(),
            note: '',
          }),
        ]),
        expiryRound: FAR_EXPIRY,
        execute: false,
        ensureBudgetValue: 0n,
      },
      sender: protocol,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await expect(
      client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams }),
    ).rejects.toThrow()

    // Raise the guard to exactly the live balance — now the close-out executes
    // and the guard is fully consumed.
    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_SET_GUARD, targetGroupId: 2n, limitAssetId: 0n, guardAmount: liveBalance,
    }))
    await client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams })

    const guard = await getAssetGuard(client, 2n, 0n)
    expect(guard.return!.lockedAmount).toBe(0n)
    const closed = await localnet.algorand.account.getInformation(external)
    expect(closed.balance.microAlgo).toBe(0n)
  })

  test('multiple payments in one custodian proposal compound against the guard (I-01)', async () => {
    const { client } = await deployAndBootstrap()
    const protocol = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const recipient = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_CREATE_CUSTODIAN, groupName: 'MultiPay', threshold: 1n,
      allowedActions: ACT_PAY, memberAddr: protocol.toString(), memberType: 4n, memberLabel: 'protocol',
    }))
    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_SET_GUARD, targetGroupId: 2n, limitAssetId: 0n, guardAmount: 400_000n,
    }))

    const custodianPay = (amounts: bigint[]) =>
      client.send.proposeTransactionGroup({
        args: {
          groupId: 2n,
          payload: toSafeTxnGroup(amounts.map((amount) => safePayment(recipient.toString(), amount))),
          expiryRound: FAR_EXPIRY,
          execute: true,
          ensureBudgetValue: 8000n,
        },
        sender: protocol,
        ...execParams,
        maxFee: (0.05).algo(),
      })

    // 150k + 200k = 350k deducted in one execution.
    await custodianPay([150_000n, 200_000n])
    let guard = await getAssetGuard(client, 2n, 0n)
    expect(guard.return!.lockedAmount).toBe(50_000n)

    // 100k > remaining 50k — the whole group is rejected, nothing is deducted.
    await expect(custodianPay([100_000n])).rejects.toThrow()
    guard = await getAssetGuard(client, 2n, 0n)
    expect(guard.return!.lockedAmount).toBe(50_000n)
  })

  test('dissolution requires pruning to a single named member; two-member custodian groups are rejected (M-01)', async () => {
    const { client } = await deployAndBootstrap()
    const protocol = await localnet.context.generateAccount({ initialFunds: (1).algo() })
    const secondSigner = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_CREATE_CUSTODIAN, groupName: 'TwoMember', threshold: 1n,
      allowedActions: ACT_PAY, memberAddr: protocol.toString(), memberType: 4n, memberLabel: 'protocol',
    }))
    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_ADD_MEMBER, targetGroupId: 2n, memberAddr: secondSigner.toString(), memberLabel: 'second',
    }))

    // Dissolve with 2 members must fail at execution.
    const { return: pid } = await client.send.proposeAdminChange({
      args: {
        groupId: 2n,
        change: mkAdminChange({ changeType: ADM_DISSOLVE_CUSTODIAN, targetGroupId: 2n, memberAddr: protocol.toString() }),
        expiryRound: FAR_EXPIRY,
        ensureBudgetValue: 0n,
      },
      sender: protocol,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await expect(
      client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams }),
    ).rejects.toThrow()

    // Admin removes the extra member (reclaiming its box), then dissolve succeeds
    // and the last member box is deleted with the group.
    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_REMOVE_MEMBER, targetGroupId: 2n, memberAddr: secondSigner.toString(),
    }))
    const { return: pid2 } = await client.send.proposeAdminChange({
      args: {
        groupId: 2n,
        change: mkAdminChange({ changeType: ADM_DISSOLVE_CUSTODIAN, targetGroupId: 2n, memberAddr: protocol.toString() }),
        expiryRound: FAR_EXPIRY,
        ensureBudgetValue: 0n,
      },
      sender: protocol,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await client.send.executeProposal({ args: { proposalId: pid2!, ensureBudgetValue: 6000n }, ...execParams })
    expect((await isMember(client, 2n, protocol.toString())).return).toBe(false)
    expect((await isMember(client, 2n, secondSigner.toString())).return).toBe(false)
  })

  test('terminal proposals of a dissolved custodian group can still be pruned (M-02)', async () => {
    const { client, deployer } = await deployAndBootstrap()
    const protocol = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    await governAdminChange(client, 1n, mkAdminChange({
      changeType: ADM_CREATE_CUSTODIAN, groupName: 'PruneMe', threshold: 1n,
      allowedActions: ACT_PAY, memberAddr: protocol.toString(), memberType: 4n, memberLabel: 'protocol',
    }))

    // A short-lived custodian transaction proposal, cancelled → terminal.
    const expiry = BigInt(await currentRound()) + 10n
    const { return: pid } = await client.send.proposeTransactionGroup({
      args: {
        groupId: 2n,
        payload: toSafeTxnGroup([safePayment(deployer.toString(), 1_000n)]),
        expiryRound: expiry,
        execute: false,
        ensureBudgetValue: 0n,
      },
      sender: protocol,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await client.send.cancelProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, sender: protocol, suppressLog: true })

    // Dissolve the group (single member, named for box cleanup).
    const { return: dpid } = await client.send.proposeAdminChange({
      args: {
        groupId: 2n,
        change: mkAdminChange({ changeType: ADM_DISSOLVE_CUSTODIAN, targetGroupId: 2n, memberAddr: protocol.toString() }),
        expiryRound: FAR_EXPIRY,
        ensureBudgetValue: 0n,
      },
      sender: protocol,
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await client.send.executeProposal({ args: { proposalId: dpid!, ensureBudgetValue: 6000n }, ...execParams })

    // Advance past the cancelled proposal's expiry.
    for (let i = 0; i < 12; i += 1) {
      await localnet.algorand.send.payment({ amount: (0).algo(), sender: deployer, receiver: deployer, suppressLog: true })
    }

    // The group box is gone, so anyone may reclaim the terminal proposal's MBR.
    await client.send.pruneProposal({ args: { proposalId: pid!, ensureBudgetValue: 0n }, suppressLog: true })
    expect((await getProposal(client, pid!)).return).toBeUndefined()
  })

  test('threshold 0 is rejected by ADM_CHANGE_THRESHOLD and group creation (L-01)', async () => {
    const { client } = await deployAndBootstrap()
    const agent = await localnet.context.generateAccount({ initialFunds: (1).algo() })

    // ADM_CHANGE_THRESHOLD to 0 on the admin group fails at execution.
    const { return: pid } = await client.send.proposeAdminChange({
      args: {
        groupId: 1n,
        change: mkAdminChange({ changeType: ADM_CHANGE_THRESHOLD, targetGroupId: 1n, threshold: 0n }),
        expiryRound: FAR_EXPIRY,
        ensureBudgetValue: 0n,
      },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await expect(
      client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams }),
    ).rejects.toThrow()

    // ADM_CREATE_GROUP with threshold 0 fails at execution.
    const { return: pid2 } = await client.send.proposeAdminChange({
      args: {
        groupId: 1n,
        change: mkAdminChange({
          changeType: ADM_CREATE_GROUP, groupName: 'ZeroThreshold', threshold: 0n,
          memberAddr: agent.toString(), allowedActions: ACT_PAY, adminPrivileges: 0n,
        }),
        expiryRound: FAR_EXPIRY,
        ensureBudgetValue: 0n,
      },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await expect(
      client.send.executeProposal({ args: { proposalId: pid2!, ensureBudgetValue: 6000n }, ...execParams }),
    ).rejects.toThrow()

    // Sanity: the admin group's threshold is unchanged.
    const adminGroup = await getSignerGroup(client, 1n)
    expect(adminGroup.return!.threshold).toBe(1n)
  })

  test('adding the zero address as a member is rejected (L-02)', async () => {
    const { client } = await deployAndBootstrap()

    const { return: pid } = await client.send.proposeAdminChange({
      args: {
        groupId: 1n,
        change: mkAdminChange({ changeType: ADM_ADD_MEMBER, targetGroupId: 1n, memberAddr: ZERO_ADDR, memberLabel: 'ghost' }),
        expiryRound: FAR_EXPIRY,
        ensureBudgetValue: 0n,
      },
      suppressLog: true,
      staticFee: (0.2).algo(),
    })
    await expect(
      client.send.executeProposal({ args: { proposalId: pid!, ensureBudgetValue: 6000n }, ...execParams }),
    ).rejects.toThrow()

    const adminGroup = await getSignerGroup(client, 1n)
    expect(adminGroup.return!.memberCount).toBe(1n)
  })
})
