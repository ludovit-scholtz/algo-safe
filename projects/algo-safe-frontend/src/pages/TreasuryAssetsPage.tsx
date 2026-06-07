// src/pages/TreasuryAssetsPage.tsx
import { useState } from 'react'
import { AddressDisplay } from '../components/AddressDisplay'
import { SafeHoldingsTable } from '../components/SafeHoldingsTable'
import { Button } from '../components/ui/Button'
import { FormField, inputCls } from '../components/ui/FormField'
import { StatCard } from '../components/ui/StatCard'
import { useSafe } from '../hooks'
import { useOnChainSafeHoldings } from '../hooks/useOnChainSafeHoldings'
import { useSafeId } from '../lib/SafeContext'

export function TreasuryAssetsPage() {
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
    alert(`Funding session for €${amount.toLocaleString()} started (demo / Quantoz fallback).`)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-on-surface">Assets</h1>
          <p className="mt-1 text-sm text-on-surface-variant">Treasury holdings and lending positions.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Buy EURD
          </Button>
          <Button onClick={() => setOpen(true)}>Add Funds</Button>
        </div>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          label="Native Balance"
          value={nativeHolding ? `${nativeHolding.balanceDisplay} ALGO` : '—'}
          sub="Loaded directly from the safe address"
        />
        <StatCard label="Opted-In Assets" value={optedInAssets.length} sub="Algod account holdings excluding ALGO" />
        <StatCard
          label="Safe Address"
          value={<AddressDisplay address={safe?.address} textClassName="text-xl md:text-2xl text-on-surface" buttonClassName="h-7 w-7" />}
          sub={`App ${safe?.appId ?? '—'}`}
        />
      </div>

      {/* Assets table */}
      <SafeHoldingsTable
        holdings={holdings}
        isLoading={isLoading}
        error={error instanceof Error ? error.message : null}
        emptyMessage="This smart account has no native balance or opted-in assets yet."
      />

      {/* Add Funds / Buy EURD modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-md rounded-md border border-outline-variant bg-surface-container-high p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-lg font-semibold text-on-surface">Buy EURD</h3>
            <p className="mb-4 text-sm text-on-surface-variant">
              Purchase EURD via Quantoz bank transfer. Funds settle to this safe's treasury address.
            </p>

            <FormField label="Amount (EUR)">
              <input type="number" min={0} className={inputCls} value={amount} onChange={(e) => setAmount(+e.target.value)} />
            </FormField>

            <div className="mt-3 rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-2 font-mono text-xs text-on-surface-variant">
              Exchange rate: 1 EUR = 1 EURD · Quantoz platform
            </div>

            <div className="mt-4 flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleBuyEurd}>Continue to Bank</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
