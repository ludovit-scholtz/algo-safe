import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('treasury')
  return (
    <Card>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-outline-variant font-mono text-xs uppercase text-on-surface-variant">
            <th className="py-2 text-left">{t('table.asset')}</th>
            <th className="py-2 text-left">{t('table.type')}</th>
            <th className="py-2 text-right">{t('table.balance')}</th>
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
                      {holding.assetId ? ` · ${holding.assetId}` : ` · ${t('table.nativeLower')}`}
                    </div>
                  </div>
                </div>
              </td>
              <td className="py-3 text-on-surface-variant">{holding.isNative ? t('table.native') : t('table.optedInAsa')}</td>
              <td className="py-3 text-right font-mono text-on-surface">{holding.balanceDisplay}</td>
            </tr>
          ))}
          {isLoading && (
            <tr>
              <td colSpan={3} className="py-8 text-center text-sm text-on-surface-variant">
                {t('table.loading')}
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
                {emptyMessage ?? t('table.noHoldings')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  )
}
