import { DEFAULT_NETWORK_CONFIG, NetworkId as WalletNetworkId, WalletId } from '@txnlab/use-wallet-react'
import type { NetworkId } from '../services/types'

// CAIP-2 chain references for the Algorand `algorand:` namespace, matching the
// same values App.tsx feeds to the outbound use-wallet WalletConnect connector.
const CUSTOM_CAIP_CHAIN_IDS: Partial<Record<NetworkId, string>> = {
  voimain: 'r20fSQI8gWe_kFZziNonSPCXLwcQmH_n',
  aramidmain: 'PgeQVJJgx_LYKJfIEz7dbfNPuXmDyJ-O',
}

export function getCaipChainId(network: NetworkId): string {
  const custom = CUSTOM_CAIP_CHAIN_IDS[network]
  if (custom) return `algorand:${custom}`

  const walletNetwork =
    network === 'mainnet' ? WalletNetworkId.MAINNET : network === 'localnet' ? WalletNetworkId.LOCALNET : WalletNetworkId.TESTNET
  return `algorand:${DEFAULT_NETWORK_CONFIG[walletNetwork].caipChainId}`
}

export const chainOptions = [
  { id: 'mainnet', label: 'Algorand MainNet', hint: 'Production network for live treasury operations.' },
  { id: 'voimain', label: 'Voi MainNet', hint: 'Voi network for specialized operations.' },
  { id: 'aramidmain', label: 'Aramid MainNet', hint: 'Aramid network for specialized operations.' },
  { id: 'testnet', label: 'Algorand TestNet', hint: 'Public test network for wallet pairing and dry runs.' },
  { id: 'localnet', label: 'AlgoKit LocalNet', hint: 'Local development chain with KMD-backed wallets.' },
] as const

const browserWalletKeys = new Set([WalletId.PERA, WalletId.DEFLY, WalletId.WALLETCONNECT, 'walletconnect:biatec'])

export function getWalletKeysForChain(chainId: string) {
  return chainId === 'localnet' ? new Set<string>([WalletId.KMD]) : browserWalletKeys
}

export function getWalletSectionTitle(chainId: string) {
  return chainId === 'localnet' ? 'Choose a LocalNet wallet' : 'Choose an Algorand wallet'
}
