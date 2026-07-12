import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import algosdk, { type TransactionSigner } from 'algosdk'
import { AlgoSafeTxnValidatorFactory } from '../smart_contracts/artifacts/algo_safe_validator/AlgoSafeTxnValidatorClient'
import { VALIDATOR_APPROVAL_SHA256_HEX } from '../smart_contracts/algo_safe/validator-hash.generated'
import { hashApprovalProgram } from './version'

// ---------------------------------------------------------------------------
// AlgoSafeTxnValidator — registry and resolver.
//
// The validator is a tiny (~420 byte), stateless, immutable library contract
// that AlgoSafe calls via inner app call to validate transaction payloads.
// AlgoSafe.createApplication(name, validatorAppId) verifies the given app's
// approval program hashes to VALIDATOR_APPROVAL_SHA256_HEX, so the registry
// below is pure convenience — a wrong or malicious entry cannot be pinned.
// ---------------------------------------------------------------------------

export { VALIDATOR_APPROVAL_SHA256_HEX }

/**
 * Known AlgoSafeTxnValidator deployments per network, keyed by the network's
 * base64 genesis hash. Extend this table after deploying the validator to a
 * new network (`deployValidator`) — entries are verified by bytecode hash at
 * resolve time AND on-chain at safe creation, so the registry is trust-minimised.
 */
export const VALIDATOR_DEPLOYMENTS: Record<string, bigint> = {
  // TestNet
  'SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=': 0n, // TODO: fill after first TestNet deployment
  // MainNet
  'wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=': 0n, // TODO: fill after first MainNet deployment
}

// Browser-safe base64 (the package is consumed by the frontend — no Buffer).
function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

async function fetchApprovalProgram(algodClient: algosdk.Algodv2, appId: bigint) {
  const application = (await algodClient.getApplicationByID(appId).do()) as {
    params?: { approvalProgram?: string | Uint8Array | number[]; 'approval-program'?: string | Uint8Array | number[] }
  }
  return application.params?.approvalProgram ?? application.params?.['approval-program']
}

/**
 * Verify that `appId` hosts the exact compiled AlgoSafeTxnValidator bytecode
 * this package was built against. Throws when it does not.
 */
export async function verifyValidatorApp(algodClient: algosdk.Algodv2, appId: bigint | number): Promise<bigint> {
  const approvalProgram = await fetchApprovalProgram(algodClient, BigInt(appId))
  if (!approvalProgram) {
    throw new Error(`Validator app ${appId} not found or has no approval program.`)
  }
  const hash = await hashApprovalProgram(approvalProgram)
  if (hash !== VALIDATOR_APPROVAL_SHA256_HEX) {
    throw new Error(
      `App ${appId} is not the pinned AlgoSafeTxnValidator: approval program hashes to ${hash}, expected ${VALIDATOR_APPROVAL_SHA256_HEX}.`,
    )
  }
  return BigInt(appId)
}

/**
 * Resolve the AlgoSafeTxnValidator app ID for the connected network.
 * Uses `appId` when given, otherwise looks the network up in
 * VALIDATOR_DEPLOYMENTS by genesis hash. The resolved app's bytecode is always
 * verified against the pinned hash before it is returned.
 */
export async function resolveValidatorAppId(
  algodClient: algosdk.Algodv2,
  options?: { appId?: bigint | number },
): Promise<bigint> {
  if (options?.appId !== undefined) {
    return verifyValidatorApp(algodClient, options.appId)
  }

  const params = await algodClient.getTransactionParams().do()
  const genesisHashBase64 = bytesToBase64(params.genesisHash)
  const registered = VALIDATOR_DEPLOYMENTS[genesisHashBase64]
  if (!registered) {
    throw new Error(
      `No AlgoSafeTxnValidator registered for network ${genesisHashBase64}. ` +
        `Deploy one with deployValidator() and pass its app ID explicitly (or add it to VALIDATOR_DEPLOYMENTS).`,
    )
  }
  return verifyValidatorApp(algodClient, registered)
}

export type DeployValidatorParams = {
  algodClient: algosdk.Algodv2
  sender: string
  signer: TransactionSigner
}

/**
 * Deploy a fresh AlgoSafeTxnValidator (bare create — the contract is stateless
 * and needs no funding). The deployed app rejects update and delete forever,
 * so one deployment per network serves every safe on that network.
 */
export async function deployValidator(params: DeployValidatorParams): Promise<bigint> {
  const algorand = AlgorandClient.fromClients({ algod: params.algodClient })
  algorand.setSigner(params.sender, params.signer)
  const factory = algorand.client.getTypedAppFactory(AlgoSafeTxnValidatorFactory, { defaultSender: params.sender })
  const { appClient } = await factory.send.create.bare({ suppressLog: true })
  return verifyValidatorApp(params.algodClient, appClient.appId)
}
