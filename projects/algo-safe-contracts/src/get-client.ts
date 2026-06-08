import {
  DEFAULT_CLIENT_VERSION,
  getClientRegistry,
  LATEST_CONTRACT_HASH,
  type AlgoSafeClientConstructor,
  type ContractHash,
  type ContractVersion,
} from './versioned-clients.generated'

export { DEFAULT_CLIENT_VERSION, LATEST_CONTRACT_HASH }
export type { AlgoSafeClientConstructor, ContractHash, ContractVersion }

export function getClient(version: ContractVersion = DEFAULT_CLIENT_VERSION): AlgoSafeClientConstructor {
  const resolvedVersion = version === 'latest' ? LATEST_CONTRACT_HASH : version
  const clientRegistry = getClientRegistry()
  const client = clientRegistry[resolvedVersion as ContractHash]

  if (!client) {
    throw new Error(
      `Unknown Algo Safe client version \"${version}\". Supported versions: ${Object.keys(clientRegistry).join(', ')}`,
    )
  }

  return client
}
