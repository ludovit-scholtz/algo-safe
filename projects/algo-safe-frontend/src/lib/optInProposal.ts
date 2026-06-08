import { algo, AlgorandClient } from '@algorandfoundation/algokit-utils'
import { getAlgoSafeContractVersion, getClient } from 'algo-safe'
import algosdk from 'algosdk'
import { getZeroAddress } from './onChainSafe'

// Mirrors CreateProposalPage's opt-in branch so the dashboard shortcut produces
// an identical on-chain opt-in proposal (ASA transfer of amount 0 to the safe).
const TX_VALIDITY_WINDOW = 200
const PROPOSAL_CALL_FEE = algo(0.2)

function getCurrentRound(status: Record<string, unknown>) {
  const candidate = status.lastRound ?? status['last-round']
  if (typeof candidate === 'number') return BigInt(candidate)
  if (typeof candidate === 'bigint') return candidate
  if (typeof candidate === 'string' && candidate.trim()) return BigInt(candidate)
  return 0n
}

export async function proposeAssetOptIn(params: {
  algodClient: algosdk.Algodv2
  activeAddress: string
  transactionSigner: algosdk.TransactionSigner
  appId: number
  safeAddress: string
  assetId: number
  groupId?: bigint
  expiryRounds?: bigint
  note?: string
}): Promise<{ proposalId: string; txId: string }> {
  const { algodClient, activeAddress, transactionSigner, appId, safeAddress, assetId } = params
  const groupId = params.groupId ?? 1n
  const expiryRounds = params.expiryRounds ?? 2000n

  const senderAddress = algosdk.Address.fromString(activeAddress)
  const algorand = AlgorandClient.fromClients({ algod: algodClient }).setDefaultValidityWindow(TX_VALIDITY_WINDOW)
  algorand.setSigner(senderAddress, transactionSigner)

  const clientVersion = await getAlgoSafeContractVersion(algodClient, BigInt(appId))
  const appClient = algorand.client.getTypedAppClientById(getClient(clientVersion ?? 'latest'), {
    appId: BigInt(appId),
    defaultSender: senderAddress,
  })

  const status = (await algodClient.status().do()) as unknown as Record<string, unknown>
  const expiryRound = getCurrentRound(status) + expiryRounds

  const result = await appClient.send.proposeAssetTransfer({
    args: {
      groupId,
      payload: {
        xferAsset: BigInt(assetId),
        assetReceiver: safeAddress,
        assetAmount: 0n,
        hasClose: 0n,
        assetCloseTo: getZeroAddress(),
        note: params.note ?? 'Opt in to EURD',
      },
      expiryRound,
    },
    staticFee: PROPOSAL_CALL_FEE,
    suppressLog: true,
  })

  return { proposalId: result.return?.toString() ?? '', txId: result.txIds[0] ?? '' }
}
