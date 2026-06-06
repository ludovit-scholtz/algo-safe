import type { SafeHoldingRow } from '../lib/onChainSafe'
import { Card } from './ui/Card'
import { Icon } from './ui/Icon'

export function SafeHoldingsTable({
  holdings,
  isLoading,
  error,
  emptyMessage,
}: {
  holdings?: SafeHoldingRow[]
  isLoading?: boolean
  error?: string | null
  emptyMessage?: string
}) {
  return (
    <Card>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-outline-variant font-mono text-xs uppercase text-on-surface-variant">
            <th className="py-2 text-left">Asset</th>
            <th className="py-2 text-left">Type</th>
            <th className="py-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {holdings?.map((holding) => (
            <tr key={holding.key} className="border-b border-outline-variant last:border-0">
              <td className="py-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-container-high text-primary">
                    <Icon name={holding.isNative ? 'paid' : 'token'} className="text-lg" />
                  </span>
                  <div>
                    <div className="font-medium text-on-surface">{holding.name}</div>
                    <div className="font-mono text-xs text-on-surface-variant">
                      {holding.symbol}
                      {holding.assetId ? ` · ${holding.assetId}` : ' · native'}
                    </div>
                  </div>
                </div>
              </td>
              <td className="py-3 text-on-surface-variant">{holding.isNative ? 'Native' : 'Opted-in ASA'}</td>
              <td className="py-3 text-right font-mono text-on-surface">{holding.balanceDisplay}</td>
            </tr>
          ))}
          {isLoading && (
            <tr>
              <td colSpan={3} className="py-8 text-center text-sm text-on-surface-variant">
                Loading on-chain balances…
              </td>
            </tr>
          )}
          {!isLoading && !!error && (
            <tr>
              <td colSpan={3} className="py-8 text-center text-sm text-error">
                {error}
              </td>
            </tr>
          )}
          {!isLoading && !error && !holdings?.length && (
            <tr>
              <td colSpan={3} className="py-8 text-center text-sm text-on-surface-variant">
                {emptyMessage ?? 'No holdings found.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  )
}
