import algosdk from 'algosdk'
import type { NetworkId } from '../services/types'
import { resolveAssetMetadata } from './assetMetadata'

export type SafeHoldingRow = {
  key: string
  name: string
  symbol: string
  assetId?: number
  rawAmount: bigint
  decimals: number
  balanceDisplay: string
  isNative: boolean
}

export function getZeroAddress() {
  return algosdk.encodeAddress(new Uint8Array(32))
}

export function formatUnits(amount: bigint, decimals: number) {
  if (decimals === 0) return amount.toString()

  const sign = amount < 0n ? '-' : ''
  const absolute = amount < 0n ? -amount : amount
  const padded = absolute.toString().padStart(decimals + 1, '0')
  const whole = padded.slice(0, -decimals)
  const fraction = padded.slice(-decimals).replace(/0+$/, '')
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`
}

export async function fetchSafeHoldings(algodClient: algosdk.Algodv2, address: string, network?: NetworkId): Promise<SafeHoldingRow[]> {
  const account = await algodClient.accountInformation(address).do()
  const amount = BigInt(account.amount ?? 0)
  const assets = Array.isArray(account.assets)
    ? (account.assets as unknown as Array<{ 'asset-id'?: number; assetId?: number; amount?: number }>)
    : []

  const nativeHolding: SafeHoldingRow = {
    key: 'native-algo',
    name: 'Algorand Native',
    symbol: 'ALGO',
    assetId: 0,
    rawAmount: amount,
    decimals: 6,
    balanceDisplay: formatUnits(amount, 6),
    isNative: true,
  }

  const assetHoldings = await Promise.all(
    assets.map(async (asset) => {
      const assetId = Number(asset['asset-id'] ?? asset.assetId ?? 0)
      const rawAmount = BigInt(asset.amount ?? 0)
      const metadata = await resolveAssetMetadata(algodClient, assetId, network)

      return {
        key: `asa-${assetId}`,
        name: metadata.name,
        symbol: metadata.symbol,
        assetId,
        rawAmount,
        decimals: metadata.decimals,
        balanceDisplay: formatUnits(rawAmount, metadata.decimals),
        isNative: false,
      } satisfies SafeHoldingRow
    }),
  )

  return [nativeHolding, ...assetHoldings]
}
