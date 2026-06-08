import { AlgoViteClientConfig, AlgoViteKMDConfig } from '../../interfaces/network'

const DEFAULT_ALGOD_NETWORK = 'testnet'

const ALGO_CLIENT_DEFAULTS: Record<string, AlgoViteClientConfig> = {
  localnet: {
    server: 'http://localhost',
    port: '4001',
    token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    network: 'localnet',
  },
  testnet: {
    server: 'https://testnet-api.algonode.cloud',
    port: '',
    token: '',
    network: 'testnet',
  },
  mainnet: {
    server: 'https://mainnet-api.algonode.cloud',
    port: '',
    token: '',
    network: 'mainnet',
  },
  voimain: {
    server: 'https://mainnet-api.voi.nodely.dev',
    port: '443',
    token: '',
    network: 'voimain',
  },
  aramidmain: {
    server: 'https://aramidmain-algod-public.de.nodes.biatec.io',
    port: '443',
    token: '',
    network: 'aramidmain',
  },
}

const INDEXER_DEFAULTS: Record<string, AlgoViteClientConfig> = {
  localnet: {
    server: 'http://localhost',
    port: '8980',
    token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    network: 'localnet',
  },
  testnet: {
    server: 'https://testnet-idx.algonode.cloud',
    port: '',
    token: '',
    network: 'testnet',
  },
  mainnet: {
    server: 'https://mainnet-idx.algonode.cloud',
    port: '',
    token: '',
    network: 'mainnet',
  },
}

const KMD_DEFAULTS: AlgoViteKMDConfig = {
  server: 'http://localhost',
  port: '4002',
  token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  wallet: 'unencrypted-default-wallet',
  password: '',
}

function getSelectedNetwork() {
  const selectedNetwork = String(import.meta.env.VITE_ALGOD_NETWORK ?? DEFAULT_ALGOD_NETWORK).toLowerCase()
  return selectedNetwork in ALGO_CLIENT_DEFAULTS ? selectedNetwork : DEFAULT_ALGOD_NETWORK
}

export function getAlgodConfigFromViteEnvironment(): AlgoViteClientConfig {
  const network = getSelectedNetwork()
  const fallback = ALGO_CLIENT_DEFAULTS[network]

  return {
    server: import.meta.env.VITE_ALGOD_SERVER || fallback.server,
    port: import.meta.env.VITE_ALGOD_PORT || fallback.port,
    token: import.meta.env.VITE_ALGOD_TOKEN || fallback.token,
    network,
  }
}

export function getIndexerConfigFromViteEnvironment(): AlgoViteClientConfig {
  const network = getSelectedNetwork()
  const fallback = INDEXER_DEFAULTS[network] ?? INDEXER_DEFAULTS[DEFAULT_ALGOD_NETWORK]

  return {
    server: import.meta.env.VITE_INDEXER_SERVER || fallback.server,
    port: import.meta.env.VITE_INDEXER_PORT || fallback.port,
    token: import.meta.env.VITE_INDEXER_TOKEN || fallback.token,
    network: fallback.network,
  }
}

export function getKmdConfigFromViteEnvironment(): AlgoViteKMDConfig {
  return {
    server: import.meta.env.VITE_KMD_SERVER || KMD_DEFAULTS.server,
    port: import.meta.env.VITE_KMD_PORT || KMD_DEFAULTS.port,
    token: import.meta.env.VITE_KMD_TOKEN || KMD_DEFAULTS.token,
    wallet: import.meta.env.VITE_KMD_WALLET || KMD_DEFAULTS.wallet,
    password: import.meta.env.VITE_KMD_PASSWORD || KMD_DEFAULTS.password,
  }
}
