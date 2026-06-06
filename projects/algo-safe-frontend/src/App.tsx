// src/App.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DEFAULT_NETWORK_CONFIG, NetworkId, SupportedWallet, WalletId, WalletManager, WalletProvider } from '@txnlab/use-wallet-react'
import { SnackbarProvider } from 'notistack'
import { RouterProvider } from 'react-router-dom'
import { router } from './routes'
import { ServiceProvider, services } from './services'
import { getAlgodConfigFromViteEnvironment, getKmdConfigFromViteEnvironment } from './utils/network/getAlgoClientConfigs'

const walletConnectProjectId = 'f9c05e3d8e653a4781700744c3537424'

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

type SupportedChainId = NetworkId.MAINNET | NetworkId.TESTNET | NetworkId.LOCALNET

function toSupportedChainId(network: string): SupportedChainId {
  if (network === NetworkId.MAINNET || network === NetworkId.TESTNET || network === NetworkId.LOCALNET) {
    return network
  }

  return NetworkId.TESTNET
}

function getWalletNetworks(algodConfig: ReturnType<typeof getAlgodConfigFromViteEnvironment>) {
  const selectedNetwork = toSupportedChainId(String(algodConfig.network).toLowerCase())
  const selectedDefaults = DEFAULT_NETWORK_CONFIG[selectedNetwork] ?? DEFAULT_NETWORK_CONFIG.testnet

  const networks: Record<SupportedChainId, typeof DEFAULT_NETWORK_CONFIG.mainnet> = {
    [NetworkId.MAINNET]: DEFAULT_NETWORK_CONFIG.mainnet,
    [NetworkId.TESTNET]: DEFAULT_NETWORK_CONFIG.testnet,
    [NetworkId.LOCALNET]: DEFAULT_NETWORK_CONFIG.localnet,
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

let supportedWallets: SupportedWallet[]
if (import.meta.env.VITE_ALGOD_NETWORK === 'localnet') {
  const kmd = getKmdConfigFromViteEnvironment()
  supportedWallets = [
    { id: WalletId.KMD, options: { baseServer: kmd.server, token: String(kmd.token), port: String(kmd.port) } },
    ...browserWallets,
  ]
} else {
  supportedWallets = browserWallets
}
const queryClient = new QueryClient()

export default function App() {
  const algodConfig = getAlgodConfigFromViteEnvironment()
  const walletManager = new WalletManager({
    wallets: supportedWallets,
    defaultNetwork: algodConfig.network,
    networks: getWalletNetworks(algodConfig),
    options: { resetNetwork: true },
  })
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
