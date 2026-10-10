import { DEFAULT_NETWORK_CONFIG, NetworkId as WalletNetworkId } from '@txnlab/use-wallet-react'
import i18n from '../i18n/instance'
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
  {
    id: 'mainnet',
    label: 'Algorand MainNet',
    get hint() {
      return i18n.t('layout:network.hints.mainnet')
    },
  },
  {
    id: 'voimain',
    label: 'Voi MainNet',
    get hint() {
      return i18n.t('layout:network.hints.voimain')
    },
  },
  {
    id: 'aramidmain',
    label: 'Aramid MainNet',
    get hint() {
      return i18n.t('layout:network.hints.aramidmain')
    },
  },
  {
    id: 'testnet',
    label: 'Algorand TestNet',
    get hint() {
      return i18n.t('layout:network.hints.testnet')
    },
  },
  {
    id: 'localnet',
    label: 'AlgoKit LocalNet',
    get hint() {
      return i18n.t('layout:network.hints.localnet')
    },
  },
]

export function getWalletSectionTitle(chainId: string) {
  return chainId === 'localnet' ? i18n.t('layout:network.chooseLocalnetWallet') : i18n.t('layout:network.chooseAlgorandWallet')
}
