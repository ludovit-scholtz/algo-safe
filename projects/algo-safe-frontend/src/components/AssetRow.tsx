import type { AssetHolding } from '../services/types'
import { Icon } from './ui/Icon'

const icon: Record<AssetHolding['type'], string> = { native: 'paid', stablecoin: 'euro', lending: 'savings' }
export function AssetRow({ a }: { a: AssetHolding }) {
  return (
    <tr className="border-b border-outline-variant last:border-0">
      <td className="py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-container-high text-primary">
            <Icon name={icon[a.type]} className="text-lg" />
          </span>
          <div>
            <div className="font-medium text-on-surface">{a.name}</div>
            <div className="font-mono text-xs text-on-surface-variant">
              {a.symbol}
              {a.assetId ? ` · ${a.assetId}` : ''}
              {a.apy ? ` · ${a.apy}% APY` : ''}
            </div>
          </div>
        </div>
      </td>
      <td className="py-3 text-right font-mono text-on-surface">{a.amount.toLocaleString()}</td>
      <td className="py-3 text-right font-semibold text-on-surface">€{a.valueEur.toLocaleString()}</td>
    </tr>
  )
}
