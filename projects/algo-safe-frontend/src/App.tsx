// src/App.tsx
import { SupportedWallet, WalletId, WalletManager, WalletProvider } from '@txnlab/use-wallet-react'
import { SnackbarProvider } from 'notistack'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { getAlgodConfigFromViteEnvironment, getKmdConfigFromViteEnvironment } from './utils/network/getAlgoClientConfigs'
import { ServiceProvider, services } from './services'
import { router } from './routes'

let supportedWallets: SupportedWallet[]
if (import.meta.env.VITE_ALGOD_NETWORK === 'localnet') {
  const kmd = getKmdConfigFromViteEnvironment()
  supportedWallets = [{ id: WalletId.KMD, options: { baseServer: kmd.server, token: String(kmd.token), port: String(kmd.port) } }]
} else {
  supportedWallets = [{ id: WalletId.DEFLY }, { id: WalletId.PERA }, { id: WalletId.EXODUS }]
}
const queryClient = new QueryClient()

export default function App() {
  const algodConfig = getAlgodConfigFromViteEnvironment()
  const walletManager = new WalletManager({
    wallets: supportedWallets, defaultNetwork: algodConfig.network,
    networks: { [algodConfig.network]: { algod: { baseServer: algodConfig.server, port: algodConfig.port, token: String(algodConfig.token) } } },
    options: { resetNetwork: true },
  })
  return (
    <QueryClientProvider client={queryClient}>
      <SnackbarProvider maxSnack={3}>
        <WalletProvider manager={walletManager}>
          <ServiceProvider value={services}><RouterProvider router={router} /></ServiceProvider>
        </WalletProvider>
      </SnackbarProvider>
    </QueryClientProvider>
  )
}
