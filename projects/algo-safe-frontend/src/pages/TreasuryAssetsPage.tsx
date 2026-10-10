// src/pages/TreasuryAssetsPage.tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AddressDisplay } from '../components/AddressDisplay'
import { SafeHoldingsTable } from '../components/SafeHoldingsTable'
import { Button } from '../components/ui/Button'
import { FormField, inputCls } from '../components/ui/FormField'
import { StatCard } from '../components/ui/StatCard'
import { useSafe } from '../hooks'
import { useOnChainSafeHoldings } from '../hooks/useOnChainSafeHoldings'
import { fmtNum } from '../lib/format'
import { useSafeId } from '../lib/SafeContext'

export function TreasuryAssetsPage() {
  const { t } = useTranslation('treasury')
  const safeId = useSafeId()
  const { data: safe } = useSafe(safeId)
  const { data: holdings, isLoading, error } = useOnChainSafeHoldings(safeId)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(1000)

  const nativeHolding = holdings?.find((holding) => holding.isNative)
  const optedInAssets = holdings?.filter((holding) => !holding.isNative) ?? []

  function handleBuyEurd() {
    setOpen(false)
    // Quantoz QuantozService has no direct fund-by-bank method exposed via hooks;
    // wire to demo confirmation (plan fallback: simple alert/toast)
    alert(t('fundingStarted', { amount: fmtNum(amount) }))
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-on-surface">{t('title')}</h1>
          <p className="mt-1 text-sm text-on-surface-variant">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => setOpen(true)}>
            {t('buyEurd')}
          </Button>
          <Button onClick={() => setOpen(true)}>{t('addFunds')}</Button>
        </div>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          label={t('stats.nativeBalance')}
          value={nativeHolding ? `${nativeHolding.balanceDisplay} ALGO` : '—'}
          sub={t('stats.nativeBalanceSub')}
        />
        <StatCard label={t('stats.optedInAssets')} value={optedInAssets.length} sub={t('stats.optedInAssetsSub')} />
        <StatCard
          label={t('stats.safeAddress')}
          value={<AddressDisplay address={safe?.address} textClassName="text-xl md:text-2xl text-on-surface" buttonClassName="h-7 w-7" />}
          sub={t('stats.app', { appId: String(safe?.appId ?? '—') })}
        />
      </div>

      {/* Assets table */}
      <SafeHoldingsTable
        holdings={holdings}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        emptyMessage={t('empty')}
      />

      {/* Add Funds / Buy EURD modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-md rounded-md border border-outline-variant bg-surface-container-high p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-lg font-semibold text-on-surface">{t('modal.title')}</h3>
            <p className="mb-4 text-sm text-on-surface-variant">{t('modal.description')}</p>

            <div className="mb-4 rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-3">
              <div className="mb-1 font-mono text-xs uppercase tracking-wide text-on-surface-variant">{t('stats.safeAddress')}</div>
              <AddressDisplay
                address={safe?.address}
                textClassName="text-sm text-on-surface"
                buttonClassName="h-5 w-5"
                fallback={t('modal.addressUnavailable')}
              />
            </div>

            <FormField label={t('modal.amountLabel')}>
              <input type="number" min={0} className={inputCls} value={amount} onChange={(e) => setAmount(+e.target.value)} />
            </FormField>

            <div className="mt-3 rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-2 font-mono text-xs text-on-surface-variant">
              {t('modal.exchangeRate')}
            </div>

            <div className="mt-4 flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t('modal.cancel')}
              </Button>
              <Button onClick={handleBuyEurd}>{t('modal.continue')}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
