import { AlgorandClient, microAlgo } from '@algorandfoundation/algokit-utils'
import algosdk, { type TransactionSigner } from 'algosdk'
import { buildAlgoSafeAppClient, readMember, readSafeConfig, readSignerGroup, type AlgoSafeOnChainRef } from './on-chain'
import { resolveValidatorAppId } from './validator'
import { AlgoSafeFactory } from './latest-client'
import { LATEST_CONTRACT_HASH } from './get-client'
import { getAlgoSafeContractVersion } from './version'
import { createRekeySafeTxn, toSafeTxnGroup, ZERO_ADDR, type SafeTxnTuple } from './safe-tx'

// ---------------------------------------------------------------------------
// Safe migration / upgrade helpers.
//
// A safe is upgraded by (1) deploying a fresh safe on the latest contract,
// (2) cloning the old safe's configuration into it through the clone-friendly
// bootstrap path (`bootstrapGroup` / `bootstrapRekeyedAddress` /
// `finalizeBootstrap`), and (3) executing a governed rekey proposal on the old
// safe that rekeys every registered external address — and finally the old
// safe's application account itself — to the new safe's application address.
// After step 3 the new contract controls all funds; the old app remains only
// as an on-chain record.
// ---------------------------------------------------------------------------

const REKEYED_BOX_PREFIX = 'r'.charCodeAt(0)
const MEMBER_BOX_PREFIX = 'm'.charCodeAt(0)
const BOX_PAGE_SIZE = 10_000
// ARC4 encoding of the RekeyedAddress struct: (label, addedRound).
const REKEYED_ADDRESS_CODEC = algosdk.ABIType.from('(string,uint64)')

export type RekeyedAddressRecord = {
  address: string
  label: string
  addedRound: bigint
}

export type SafeGroupSeedRecord = {
  name: string
  threshold: bigint
  adminPrivileges: bigint
  allowedActions: bigint
  limitAssetId: bigint
  dailyLimit: bigint
  monthlyLimit: bigint
  cooldownRounds: bigint
  groupType: bigint // GT_STANDARD=0n, GT_CUSTODIAN=1n
}

export type SafeMemberSeedRecord = {
  addr: string
  accountType: bigint
  label: string
}

export type SafeGroupCloneRecord = {
  seed: SafeGroupSeedRecord
  members: SafeMemberSeedRecord[]
}

export type SafeCloneConfig = {
  name: string
  groups: SafeGroupCloneRecord[]
  rekeyedAddresses: RekeyedAddressRecord[]
}

export type SafeVersionStatus = {
  versionHash: string | undefined
  versionLabel: string
  isLatest: boolean
}

function readUint64BigEndian(bytes: Uint8Array) {
  let value = 0n
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte)
  }
  return value
}

async function listBoxNames(algodClient: algosdk.Algodv2, appId: bigint | number) {
  const response = (await algodClient.getApplicationBoxes(BigInt(appId)).max(BOX_PAGE_SIZE).do()) as {
    boxes?: Array<{ name?: Uint8Array }>
  }
  return (response.boxes ?? []).map((box) => box.name).filter((name): name is Uint8Array => name instanceof Uint8Array)
}

/** Detect the deployed contract version of a safe and whether it is the latest. */
export async function fetchSafeVersionStatus(
  algodClient: algosdk.Algodv2,
  appId: bigint | number,
): Promise<SafeVersionStatus> {
  const versionHash = await getAlgoSafeContractVersion(algodClient, BigInt(appId))
  return {
    versionHash,
    versionLabel: versionHash ? versionHash.slice(0, 12) : 'unknown',
    isLatest: versionHash === LATEST_CONTRACT_HASH,
  }
}

/**
 * List the admin-governed registry of external addresses rekeyed to the safe.
 * Reads the `r`-prefixed boxes directly from algod, so it works without a
 * typed client (and simply returns an empty list on contract versions that
 * predate the registry).
 */
export async function listRekeyedAddresses(
  algodClient: algosdk.Algodv2,
  appId: bigint | number,
): Promise<RekeyedAddressRecord[]> {
  const names = await listBoxNames(algodClient, appId)
  const rekeyedNames = names.filter((name) => name.length === 33 && name[0] === REKEYED_BOX_PREFIX)

  const records = await Promise.all(
    rekeyedNames.map(async (name) => {
      const box = await algodClient.getApplicationBoxByName(BigInt(appId), name).do()
      const [label, addedRound] = REKEYED_ADDRESS_CODEC.decode(box.value) as [string, bigint]
      return {
        address: algosdk.encodeAddress(name.slice(1, 33)),
        label,
        addedRound,
      }
    }),
  )

  return records.sort((left, right) => left.address.localeCompare(right.address))
}

/**
 * Read everything needed to clone a safe's configuration onto a fresh
 * deployment: name, every *active* signer group (threshold, policy,
 * privileges, and members), and the rekeyed-address registry. Usage counters,
 * pending proposals, and inactive groups are intentionally not cloned.
 */
export async function fetchSafeCloneConfig(
  algodClient: algosdk.Algodv2,
  safe: AlgoSafeOnChainRef,
): Promise<SafeCloneConfig> {
  const client = await buildAlgoSafeAppClient(algodClient, safe)
  const config = await readSafeConfig(client)
  const name = config.name || 'Algo Safe'
  const nextGroupId = config.nextGroupId

  const boxNames = await listBoxNames(algodClient, safe.appId)
  const memberBoxNames = boxNames.filter((boxName) => boxName.length === 41 && boxName[0] === MEMBER_BOX_PREFIX)

  const groups: SafeGroupCloneRecord[] = []
  for (let groupId = 1n; groupId < nextGroupId; groupId += 1n) {
    const group = await readSignerGroup(client, groupId)
    if (!group || group.active === 0n) continue

    const memberAddresses = memberBoxNames
      .filter((boxName) => readUint64BigEndian(boxName.slice(1, 9)) === groupId)
      .map((boxName) => algosdk.encodeAddress(boxName.slice(9, 41)))

    const members = await Promise.all(
      memberAddresses.map(async (account) => {
        const member = await readMember(client, groupId, account)
        return {
          addr: String(member?.addr ?? account),
          accountType: BigInt(member?.accountType ?? 1n),
          label: String(member?.label ?? ''),
        } satisfies SafeMemberSeedRecord
      }),
    )
    members.sort((left, right) => left.addr.localeCompare(right.addr))

    groups.push({
      seed: {
        name: String(group.name),
        threshold: BigInt(group.threshold),
        adminPrivileges: BigInt(group.adminPrivileges),
        allowedActions: BigInt(group.allowedActions),
        limitAssetId: BigInt(group.limitAssetId ?? 0n),
        dailyLimit: BigInt(group.dailyLimit),
        monthlyLimit: BigInt(group.monthlyLimit),
        cooldownRounds: BigInt(group.cooldownRounds),
        groupType: BigInt(group.groupType ?? 0n),
      },
      members,
    })
  }

  const rekeyedAddresses = await listRekeyedAddresses(algodClient, safe.appId)
  return { name, groups, rekeyedAddresses }
}

export type DeployClonedSafeParams = {
  algodClient: algosdk.Algodv2
  sender: string
  signer: TransactionSigner
  config: SafeCloneConfig
  /** Override the cloned safe's name (defaults to the source safe's name). */
  name?: string
  /** Initial funding for box MBR and future inner transactions. Default 2 ALGO. */
  fundMicroAlgo?: bigint
  /**
   * AlgoSafeTxnValidator app ID to pin at createApplication. When omitted it is
   * resolved from VALIDATOR_DEPLOYMENTS for the connected network. Either way
   * the bytecode hash is verified off-chain here and on-chain by the contract.
   */
  validatorAppId?: bigint | number
}

export type DeployClonedSafeResult = {
  appId: bigint
  appAddress: string
}

/**
 * Deploy a fresh safe on the latest contract and seed it with `config` via the
 * clone-friendly bootstrap path. The caller (creator) signs the deployment,
 * funding payment, one `bootstrapGroup` call per group, one
 * `bootstrapRekeyedAddress` call per registry entry, and the closing
 * `finalizeBootstrap`. Until that final call the new safe accepts no proposals.
 */
export async function deployClonedSafe(params: DeployClonedSafeParams): Promise<DeployClonedSafeResult> {
  const { algodClient, sender, signer, config } = params
  if (config.groups.length === 0) {
    throw new Error('Cannot clone a safe with no active signer groups.')
  }

  const algorand = AlgorandClient.fromClients({ algod: algodClient })
  algorand.setSigner(sender, signer)
  const factory = algorand.client.getTypedAppFactory(AlgoSafeFactory, { defaultSender: sender })

  const validatorAppId = await resolveValidatorAppId(algodClient, {
    appId: params.validatorAppId,
  })
  const { appClient } = await factory.send.create.createApplication({
    args: { name: params.name ?? config.name, validatorAppId },
    suppressLog: true,
  })

  await algorand.send.payment({
    sender,
    receiver: appClient.appAddress,
    amount: microAlgo(params.fundMicroAlgo ?? 2_000_000n),
    suppressLog: true,
  })

  for (const group of config.groups) {
    await appClient.send.bootstrapGroup({
      args: {
        seed: group.seed,
        members: group.members.map((member) => [member.addr, member.accountType, member.label] as const),
        ensureBudgetValue: 0n,
      },
      populateAppCallResources: true,
      suppressLog: true,
    })
  }

  for (const record of config.rekeyedAddresses) {
    await appClient.send.bootstrapRekeyedAddress({
      args: { addr: record.address, label: record.label },
      populateAppCallResources: true,
      suppressLog: true,
    })
  }

  await appClient.send.finalizeBootstrap({ args: {}, suppressLog: true })

  return { appId: appClient.appId, appAddress: appClient.appAddress.toString() }
}

/**
 * Build the transaction-group payload that migrates custody to a successor
 * safe: one rekey per registered external address, then the old safe's own
 * application account last. Submit it via `proposeTransactionGroup` on the
 * old safe; the executing group needs ACT_REKEY, PRIV_GROUP, and its M-of-N
 * threshold, and after execution the old safe can no longer move funds.
 */
export function buildMigrationRekeyPayload(rekeyedAddresses: string[], newSafeAddress: string): SafeTxnTuple[] {
  if (rekeyedAddresses.length > 15) {
    throw new Error('A migration rekey group supports at most 15 external addresses (16 transactions incl. the safe itself).')
  }
  const txns = rekeyedAddresses.map((address) => {
    // A zero-address sender means "rekey the safe itself" — a zero registry
    // entry here would self-rekey the safe before the group's final entry and
    // fail the whole migration group (2026-07-12 Fable-5 audit, L-02).
    if (address === ZERO_ADDR) {
      throw new Error('Rekeyed-address list must not contain the zero address.')
    }
    return createRekeySafeTxn({ sender: address, rekeyTo: newSafeAddress, note: 'algo-safe migration' })
  })
  txns.push(createRekeySafeTxn({ sender: ZERO_ADDR, rekeyTo: newSafeAddress, note: 'algo-safe migration' }))
  return toSafeTxnGroup(txns)
}
