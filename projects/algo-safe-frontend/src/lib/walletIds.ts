// use-wallet v5 ids are plain strings (the v4 `WalletId` enum is gone). Kept in a
// dependency-free module so the chain -> wallet mapping is unit-testable.
export const WALLET_ID = {
  PERA: 'pera',
  DEFLY: 'defly',
  WALLETCONNECT: 'walletconnect',
  KMD: 'kmd',
  BIATEC: 'biatec',
} as const

const BROWSER_WALLET_IDS: ReadonlySet<string> = new Set([WALLET_ID.PERA, WALLET_ID.DEFLY, WALLET_ID.WALLETCONNECT, WALLET_ID.BIATEC])

export function getWalletKeysForChain(chainId: string): ReadonlySet<string> {
  return chainId === 'localnet' ? new Set<string>([WALLET_ID.KMD]) : BROWSER_WALLET_IDS
}
