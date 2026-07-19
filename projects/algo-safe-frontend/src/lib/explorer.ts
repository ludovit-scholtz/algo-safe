// src/lib/explorer.ts
import type { NetworkId } from '../services/types'

// Per-network Biatec Scan explorer host. Only networks with a confirmed host
// are listed — an unlisted network deliberately renders no link (plain ID
// only) rather than guessing at an unconfirmed URL scheme. Fill in testnet/
// voimain/aramidmain here once their hosts are confirmed.
const EXPLORER_HOSTS: Partial<Record<NetworkId, string>> = {
  mainnet: 'algorand.scan.biatec.io',
}

function explorerUrl(kind: 'asset' | 'application', id: number | bigint, network: NetworkId): string | undefined {
  const host = EXPLORER_HOSTS[network]
  if (!host) return undefined
  if (typeof id === 'bigint' ? id < 0n : !Number.isFinite(id) || id < 0) return undefined
  return `https://${host}/${kind}/${id.toString()}`
}

export function assetExplorerUrl(assetId: number | bigint, network: NetworkId): string | undefined {
  return explorerUrl('asset', assetId, network)
}

export function appExplorerUrl(appId: number | bigint, network: NetworkId): string | undefined {
  return explorerUrl('application', appId, network)
}
