import { WalletId } from '@txnlab/use-wallet-react'

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
