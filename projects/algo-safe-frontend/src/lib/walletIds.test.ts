import { WALLET_ID, getWalletKeysForChain } from './walletIds'

describe('walletIds (use-wallet v5)', () => {
  it('uses plain v5 string ids, with Biatec as its own adapter (not a WalletConnect skin)', () => {
    expect(WALLET_ID).toEqual({
      PERA: 'pera',
      DEFLY: 'defly',
      WALLETCONNECT: 'walletconnect',
      KMD: 'kmd',
      BIATEC: 'biatec',
    })
  })

  it('offers only KMD on localnet', () => {
    expect([...getWalletKeysForChain('localnet')]).toEqual(['kmd'])
  })

  it.each(['mainnet', 'testnet', 'voimain', 'aramidmain'])('offers browser wallets incl. biatec on %s', (chain) => {
    const keys = getWalletKeysForChain(chain)
    expect(keys.has('pera')).toBe(true)
    expect(keys.has('defly')).toBe(true)
    expect(keys.has('walletconnect')).toBe(true)
    expect(keys.has('biatec')).toBe(true)
    expect(keys.has('kmd')).toBe(false)
  })

  it('no longer recognises the v4 walletconnect:biatec key', () => {
    expect(getWalletKeysForChain('mainnet').has('walletconnect:biatec')).toBe(false)
  })
})
