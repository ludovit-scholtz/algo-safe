import type algosdk from 'algosdk'
import i18n from '../i18n/instance'
import type { NetworkId } from '../services/types'

export type AssetMetadata = {
  assetId: number
  symbol: string
  name: string
  decimals: number
  isNative: boolean
}

const getNativeAlgoMetadata = (): AssetMetadata => ({
  assetId: 0,
  symbol: 'ALGO',
  name: i18n.t('proposals:asset.nativeName'),
  decimals: 6,
  isNative: true,
})

const KNOWN_ASSETS: Record<NetworkId, AssetMetadata[]> = {
  mainnet: [
    { assetId: 31566704, symbol: 'USDC', name: 'USD Coin', decimals: 6, isNative: false },
    { assetId: 1221682136, symbol: 'EURD', name: 'Quantoz EURD', decimals: 6, isNative: false },
    { assetId: 764036623, symbol: 'AsaGold', name: 'AsaGold', decimals: 6, isNative: false },
    { assetId: 386192725, symbol: 'GoBTC', name: 'GoBTC', decimals: 8, isNative: false },
  ],
  voimain: [],
  aramidmain: [],
  testnet: [{ assetId: 10458941, symbol: 'USDC', name: 'USD Coin', decimals: 6, isNative: false }],
  localnet: [],
}

export function getNativeAssetMetadata(): AssetMetadata {
  return getNativeAlgoMetadata()
}

export function getKnownAssets(network?: NetworkId): AssetMetadata[] {
  return network ? (KNOWN_ASSETS[network] ?? []) : []
}

export function getKnownAssetMetadata(assetId: number, network?: NetworkId): AssetMetadata | undefined {
  return getKnownAssets(network).find((asset) => asset.assetId === assetId)
}

export async function resolveAssetMetadata(algodClient: algosdk.Algodv2, assetId: number, network?: NetworkId): Promise<AssetMetadata> {
  if (assetId === 0) {
    return getNativeAssetMetadata()
  }

  const knownAsset = getKnownAssetMetadata(assetId, network)

  try {
    const response = await algodClient.getAssetByID(assetId).do()
    const params = response.params as {
      'unit-name'?: string
      name?: string
      decimals?: number
    }

    return {
      assetId,
      symbol: params['unit-name'] || knownAsset?.symbol || i18n.t('proposals:asset.unknownSymbol', { id: assetId }),
      name: params.name || knownAsset?.name || i18n.t('proposals:asset.unknownName', { id: assetId }),
      decimals: params.decimals ?? knownAsset?.decimals ?? 0,
      isNative: false,
    }
  } catch {
    return (
      knownAsset ?? {
        assetId,
        symbol: i18n.t('proposals:asset.unknownSymbol', { id: assetId }),
        name: i18n.t('proposals:asset.unknownName', { id: assetId }),
        decimals: 0,
        isNative: false,
      }
    )
  }
}
