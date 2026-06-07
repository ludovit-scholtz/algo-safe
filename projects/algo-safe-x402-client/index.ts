import { config } from 'dotenv'
import { algo, AlgorandClient } from '@algorandfoundation/algokit-utils'
import { AlgoSafeClient, ZERO_ADDR, type AssetPayload, type PaymentPayload } from 'algo-safe'
import { ExactAvmScheme, ALGORAND_TESTNET_CAIP2, type ClientAvmSigner } from '@x402/avm'
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from '@x402/fetch'
import algosdk from 'algosdk'

config()

const safeAdminMnemonic = process.env.SAFE_ADMIN_MNEMONIC ?? process.env.AVM_MNEMONIC ?? ''
const url = 'https://x402.goplausible.xyz/examples/weather'

const SAFE_APP_ID = 764044668n
const SAFE_GROUP_ID = 1n
const TX_VALIDITY_WINDOW = 200
const PROPOSAL_CALL_FEE = algo(0.2)
const EXECUTION_CALL_MAX_FEE = algo(0.02)
const PROPOSAL_EXPIRY_ROUNDS = 20n

const UNSUPPORTED_EXACT_MESSAGE =
  'Algo Safe executed the equivalent transfer via propose+execute, but the x402 exact AVM scheme still requires a real signature over the original asset/payment transaction bytes. This demo bridges intent only.'

async function main(): Promise<void> {
  if (!safeAdminMnemonic.trim()) {
    throw new Error('Set SAFE_ADMIN_MNEMONIC or AVM_MNEMONIC to a signer that can propose and execute from Algo Safe admin group 1.')
  }

  const algorand = AlgorandClient.testNet().setDefaultValidityWindow(TX_VALIDITY_WINDOW)
  const safeAdminAccount = algorand.account.fromMnemonic(safeAdminMnemonic)
  const safeAdminAddress = safeAdminAccount.addr.toString()
  const safeAddress = algosdk.getApplicationAddress(Number(SAFE_APP_ID)).toString()

  const safeClient = algorand.client.getTypedAppClientById(AlgoSafeClient, {
    appId: SAFE_APP_ID,
    defaultSender: safeAdminAddress,
  })

  const avmSigner = createAlgoSafeBackedSigner({
    safeAddress,
    safeClient,
    adminAddress: safeAdminAddress,
  })

  // Initialize the x402 client.
  const client = new x402Client()

  // Register Algorand testnet scheme
  client.register(ALGORAND_TESTNET_CAIP2, new ExactAvmScheme(avmSigner))

  console.info(`Algo Safe demo signer address: ${avmSigner.address}`)
  console.info(`Algo Safe app id: ${SAFE_APP_ID.toString()}`)
  console.info(`Algo Safe app address: ${safeAddress}`)
  console.info(`Safe admin proposer/executor: ${safeAdminAddress}`)

  // Wrap fetch so 402 responses trigger payment handling automatically.
  const fetchWithPayment = wrapFetchWithPayment(fetch, client)

  // Make request
  const response = await fetchWithPayment(url, {
    method: 'GET',
  })

  if (response.ok) {
    // Read payment settlement headers
    const paymentResponse = new x402HTTPClient(client).getPaymentSettleResponse(name =>
      response.headers.get(name),
    )

    console.log('\nPayment response:')
    console.log(JSON.stringify(paymentResponse, null, 2))

    // Read the resource server response body
    const data = await response.json()

    console.log('\nWeather response:')
    console.log(JSON.stringify(data, null, 2))
  } else {
    console.log(`\nNo payment settled (response status: ${response.status})`)
  }
}

function createAlgoSafeBackedSigner(input: {
  safeAddress: string
  safeClient: InstanceType<typeof AlgoSafeClient>
  adminAddress: string
}): ClientAvmSigner {
  return {
    address: input.safeAddress,
    signTransactions: async (txns, indexesToSign) => {
      const requestedIndexes = new Set(indexesToSign ?? txns.map((_, index) => index))
      const results = txns.map(() => null) as (Uint8Array | null)[]
      let bridgedCount = 0

      console.log('\n[safe-signer] signTransactions request received')
      console.log(
        JSON.stringify(
          {
            signerAddress: input.safeAddress,
            indexesToSign: [...requestedIndexes],
            txnCount: txns.length,
          },
          null,
          2,
        ),
      )

      for (const [index, txnBytes] of txns.entries()) {
        const decodedTxn = algosdk.decodeUnsignedTransaction(txnBytes)
        logSignatureRequest(index, txnBytes, decodedTxn)

        if (!requestedIndexes.has(index)) continue
        if (decodedTxn.sender.toString() !== input.safeAddress) continue

        await bridgeRequestedTransactionThroughSafe({
          safeClient: input.safeClient,
          adminAddress: input.adminAddress,
          decodedTxn,
        })

        bridgedCount += 1
      }

      if (bridgedCount > 0) {
        throw new Error(UNSUPPORTED_EXACT_MESSAGE)
      }

      return results
    },
  }
}

function logSignatureRequest(index: number, txnBytes: Uint8Array, txn: algosdk.Transaction) {
  const note = txn.note.length > 0 ? new TextDecoder().decode(txn.note) : ''
  const printable = {
    index,
    sender: txn.sender.toString(),
    type: txn.type,
    note,
    rawUnsignedTxnBase64: Buffer.from(txnBytes).toString('base64'),
    payment:
      txn.payment && {
        receiver: txn.payment.receiver.toString(),
        amount: txn.payment.amount.toString(),
        closeRemainderTo: txn.payment.closeRemainderTo?.toString() ?? null,
      },
    assetTransfer:
      txn.assetTransfer && {
        assetIndex: txn.assetTransfer.assetIndex.toString(),
        receiver: txn.assetTransfer.receiver.toString(),
        amount: txn.assetTransfer.amount.toString(),
        closeRemainderTo: txn.assetTransfer.closeRemainderTo?.toString() ?? null,
        assetSender: txn.assetTransfer.assetSender?.toString() ?? null,
      },
  }

  console.log('[safe-signer] unsigned transaction observed:')
  console.log(JSON.stringify(printable, null, 2))
}

async function bridgeRequestedTransactionThroughSafe(input: {
  safeClient: InstanceType<typeof AlgoSafeClient>
  adminAddress: string
  decodedTxn: algosdk.Transaction
}) {
  const nextProposalId = await getNextProposalId(input.safeClient)
  const expiryRound = await getExpiryRound(input.safeClient)

  console.log(
    `[safe-signer] bridging ${input.decodedTxn.type} transaction through Algo Safe proposal ${nextProposalId.toString()} and execute group`,
  )

  const proposalCall = await buildProposalCall({
    safeClient: input.safeClient,
    adminAddress: input.adminAddress,
    decodedTxn: input.decodedTxn,
    expiryRound,
  })

  const executeCall = await input.safeClient.params.executeProposal({
    sender: input.adminAddress,
    args: { proposalId: nextProposalId },
    maxFee: EXECUTION_CALL_MAX_FEE,
  })

  const result = await input.safeClient.algorand
    .newGroup()
    .addAppCallMethodCall(proposalCall)
    .addAppCallMethodCall(executeCall)
    .send()

  console.log('[safe-signer] Algo Safe bridge group submitted:')
  console.log(
    JSON.stringify(
      {
        txIds: result.txIds,
        proposalId: nextProposalId.toString(),
      },
      null,
      2,
    ),
  )
}

async function getNextProposalId(safeClient: InstanceType<typeof AlgoSafeClient>) {
  const configResult = await safeClient.send.getConfig({ args: {}, suppressLog: true })
  const nextProposalId = configResult.return?.[3]

  if (nextProposalId == null) {
    throw new Error('Unable to read next proposal id from Algo Safe config.')
  }

  return nextProposalId
}

async function getExpiryRound(safeClient: InstanceType<typeof AlgoSafeClient>) {
  const status = await safeClient.algorand.client.algod.status()
  const lastRound = BigInt(status.lastRound ?? 0)
  return lastRound + PROPOSAL_EXPIRY_ROUNDS
}

async function buildProposalCall(input: {
  safeClient: InstanceType<typeof AlgoSafeClient>
  adminAddress: string
  decodedTxn: algosdk.Transaction
  expiryRound: bigint
}) {
  if (input.decodedTxn.type === 'pay') {
    const payment = input.decodedTxn.payment
    if (!payment) throw new Error('Decoded payment transaction did not contain payment fields.')

    const payload: PaymentPayload = {
      receiver: payment.receiver.toString(),
      amount: payment.amount,
      hasClose: payment.closeRemainderTo ? 1n : 0n,
      closeRemainderTo: payment.closeRemainderTo?.toString() ?? ZERO_ADDR,
      note: decodeTxnNote(input.decodedTxn),
    }

    return input.safeClient.params.proposePayment({
      sender: input.adminAddress,
      args: {
        groupId: SAFE_GROUP_ID,
        payload,
        expiryRound: input.expiryRound,
      },
      staticFee: PROPOSAL_CALL_FEE,
    })
  }

  if (input.decodedTxn.type === 'axfer') {
    const assetTransfer = input.decodedTxn.assetTransfer
    if (!assetTransfer) throw new Error('Decoded asset transfer transaction did not contain asset-transfer fields.')
    if (assetTransfer.assetSender) {
      throw new Error('Algo Safe demo signer does not support clawback-style asset sender overrides.')
    }

    const payload: AssetPayload = {
      xferAsset: assetTransfer.assetIndex,
      assetReceiver: assetTransfer.receiver.toString(),
      assetAmount: assetTransfer.amount,
      hasClose: assetTransfer.closeRemainderTo ? 1n : 0n,
      assetCloseTo: assetTransfer.closeRemainderTo?.toString() ?? ZERO_ADDR,
      note: decodeTxnNote(input.decodedTxn),
    }

    return input.safeClient.params.proposeAssetTransfer({
      sender: input.adminAddress,
      args: {
        groupId: SAFE_GROUP_ID,
        payload,
        expiryRound: input.expiryRound,
      },
      staticFee: PROPOSAL_CALL_FEE,
    })
  }

  throw new Error(`Algo Safe demo signer only supports payment and asset-transfer requests, received ${input.decodedTxn.type}.`)
}

function decodeTxnNote(txn: algosdk.Transaction) {
  return txn.note.length > 0 ? new TextDecoder().decode(txn.note) : ''
}

main().catch(error => {
  console.error(error?.response?.data?.error ?? error)
  process.exit(1)
})