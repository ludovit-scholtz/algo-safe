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

// Statically the latest constructor type (the registry's `satisfies` keeps a
// precise per-key type, so indexing by the latest hash yields just that one
// version — not the full union). Returning the union here made every
// `getTypedAppClientById(getClient(...), ...)` call site instantiate a
// too-complex union that grew and eventually exceeded TS's limit with each new
// client version (TS2590). At runtime getClient still returns the correct
// versioned constructor; consumers already narrow behavior via version
// detection and cast version-specific args, so the narrowed static type is safe.
export type LatestAlgoSafeClientConstructor = ReturnType<typeof getClientRegistry>[typeof LATEST_CONTRACT_HASH]

export function getClient(version: ContractVersion = DEFAULT_CLIENT_VERSION): LatestAlgoSafeClientConstructor {
  const resolvedVersion = version === 'latest' ? LATEST_CONTRACT_HASH : version
  const clientRegistry = getClientRegistry()
  const client = clientRegistry[resolvedVersion as ContractHash]

  if (!client) {
    throw new Error(
      `Unknown Algo Safe client version \"${version}\". Supported versions: ${Object.keys(clientRegistry).join(', ')}`,
    )
  }

  return client as LatestAlgoSafeClientConstructor
}
