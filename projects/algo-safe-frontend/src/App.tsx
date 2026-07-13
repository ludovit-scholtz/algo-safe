// src/App.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DEFAULT_NETWORK_CONFIG, NetworkId, SupportedWallet, WalletId, WalletManager, WalletProvider } from '@txnlab/use-wallet-react'
import { SnackbarProvider } from 'notistack'
import { useMemo } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './routes'
import { ServiceProvider, services } from './services'
import { env } from './lib/env'
import { getAlgodConfigFromViteEnvironment, getKmdConfigFromViteEnvironment } from './utils/network/getAlgoClientConfigs'

const walletConnectProjectId = env.walletConnectProjectId

const walletConnectOptions = {
  projectId: walletConnectProjectId,
  enableExplorer: true,
  explorerRecommendedWalletIds: 'NONE' as const,
  privacyPolicyUrl: 'https://walletconnect.com/privacy',
  termsOfServiceUrl: 'https://walletconnect.com/terms',
  themeMode: 'dark' as const,
  themeVariables: {},
}

const browserWallets: SupportedWallet[] = [
  { id: WalletId.DEFLY },
  { id: WalletId.PERA },
  { id: WalletId.WALLETCONNECT, options: walletConnectOptions },
  { id: WalletId.WALLETCONNECT, options: { ...walletConnectOptions, skin: 'biatec' } },
]

const kmd = getKmdConfigFromViteEnvironment()
const supportedWallets: SupportedWallet[] = [
  { id: WalletId.KMD, options: { baseServer: kmd.server, token: String(kmd.token), port: String(kmd.port) } },
  ...browserWallets,
]

type SupportedChainId = NetworkId.MAINNET | NetworkId.TESTNET | NetworkId.LOCALNET | 'voimain' | 'aramidmain'

function toSupportedChainId(network: string): SupportedChainId {
  if (
    network === NetworkId.MAINNET ||
    network === NetworkId.TESTNET ||
    network === NetworkId.LOCALNET ||
    network === 'voimain' ||
    network === 'aramidmain'
  ) {
    return network
  }

  return NetworkId.MAINNET
}

function getWalletNetworks(algodConfig: ReturnType<typeof getAlgodConfigFromViteEnvironment>) {
  const selectedNetwork = toSupportedChainId(String(algodConfig.network).toLowerCase())
  const selectedDefaults = DEFAULT_NETWORK_CONFIG[selectedNetwork] ?? DEFAULT_NETWORK_CONFIG.testnet

  const networks: Record<SupportedChainId, typeof DEFAULT_NETWORK_CONFIG.mainnet> = {
    [NetworkId.MAINNET]: DEFAULT_NETWORK_CONFIG.mainnet,
    [NetworkId.TESTNET]: DEFAULT_NETWORK_CONFIG.testnet,
    [NetworkId.LOCALNET]: DEFAULT_NETWORK_CONFIG.localnet,
    ['voimain']: {
      algod: { baseServer: 'https://mainnet-api.voi.nodely.dev', port: '443', token: '' },
      caipChainId: 'r20fSQI8gWe_kFZziNonSPCXLwcQmH_n',
      genesisHash: 'r20fSQI8gWe/kFZziNonSPCXLwcQmH/nxROvnnueWOk=',
      genesisId: 'voimain-v1.0',
      isTestnet: false,
    },
    ['aramidmain']: {
      algod: { baseServer: 'https://aramidmain-algod-public.de.nodes.biatec.io', port: '443', token: '' },
      caipChainId: 'PgeQVJJgx_LYKJfIEz7dbfNPuXmDyJ-O',
      genesisHash: 'PgeQVJJgx/LYKJfIEz7dbfNPuXmDyJ+O7FwQ4XL9tE8=',
      genesisId: 'aramidmain-v1.0',
      isTestnet: false,
    },
  }

  networks[selectedNetwork] = {
    ...selectedDefaults,
    algod: {
      ...selectedDefaults.algod,
      baseServer: algodConfig.server,
      port: algodConfig.port,
      token: String(algodConfig.token),
    },
  }

  return networks
}

const queryClient = new QueryClient()

export default function App() {
  const algodConfig = getAlgodConfigFromViteEnvironment()
  const defaultNetwork = toSupportedChainId(String(algodConfig.network).toLowerCase())
  const walletManager = useMemo(
    () =>
      new WalletManager({
        wallets: supportedWallets,
        defaultNetwork,
        networks: getWalletNetworks(algodConfig),
        options: { resetNetwork: false },
      }),
    [algodConfig.network, algodConfig.port, algodConfig.server, algodConfig.token, defaultNetwork],
  )

  return (
    <QueryClientProvider client={queryClient}>
      <SnackbarProvider maxSnack={3}>
        <WalletProvider manager={walletManager}>
          <ServiceProvider value={services}>
            <RouterProvider router={router} />
          </ServiceProvider>
        </WalletProvider>
      </SnackbarProvider>
    </QueryClientProvider>
  )
}
