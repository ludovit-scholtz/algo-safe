import { appExplorerUrl, assetExplorerUrl } from './explorer'
import type { NetworkId } from '../services/types'

describe('explorer link builders', () => {
  it('builds a Biatec Scan asset link for mainnet', () => {
    expect(assetExplorerUrl(452399768, 'mainnet')).toBe('https://algorand.scan.biatec.io/asset/452399768')
  })

  it('builds a Biatec Scan application link for mainnet', () => {
    expect(appExplorerUrl(3311293145, 'mainnet')).toBe('https://algorand.scan.biatec.io/application/3311293145')
  })

  it.each<NetworkId>(['testnet', 'localnet', 'voimain', 'aramidmain'])(
    'returns undefined for %s (no confirmed explorer host configured yet)',
    (network) => {
      expect(assetExplorerUrl(1, network)).toBeUndefined()
      expect(appExplorerUrl(1, network)).toBeUndefined()
    },
  )

  it('accepts bigint ids', () => {
    expect(assetExplorerUrl(452399768n, 'mainnet')).toBe('https://algorand.scan.biatec.io/asset/452399768')
  })

  it('refuses negative ids rather than building a malformed link', () => {
    expect(assetExplorerUrl(-1, 'mainnet')).toBeUndefined()
    expect(assetExplorerUrl(-1n, 'mainnet')).toBeUndefined()
  })
})
