// src/pages/TreasuryAssetsPage.tsx
import { useState } from 'react'
import { useSafeId } from '../lib/SafeContext'
import { useAssets, useTreasury } from '../hooks'
import { AssetRow } from '../components/AssetRow'
import { Card } from '../components/ui/Card'
import { StatCard } from '../components/ui/StatCard'
import { Button } from '../components/ui/Button'
import { FormField, inputCls } from '../components/ui/FormField'

export function TreasuryAssetsPage() {
  const safeId = useSafeId()
  const { data: assets } = useAssets(safeId)
  const { data: t } = useTreasury(safeId)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(1000)

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
          <p className="mt-1 text-sm text-on-surface-variant">
            Treasury holdings and lending positions.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => setOpen(true)}>Buy EURD</Button>
          <Button onClick={() => setOpen(true)}>Add Funds</Button>
        </div>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          label="Total Value"
          value={`€${t?.totalValueEur.toLocaleString() ?? '—'}`}
          sub="Combined treasury holdings"
        />
        <StatCard
          label="Available ALGO"
          value={t?.availableAlgo.toLocaleString() ?? '—'}
          sub="Algorand native token"
        />
        <StatCard
          label="Available EURD"
          value={`€${t?.availableEurd.toLocaleString() ?? '—'}`}
          sub="Quantoz Euro stablecoin"
        />
      </div>

      {/* Assets table */}
      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-outline-variant font-mono text-xs uppercase text-on-surface-variant">
              <th className="py-2 text-left">Asset</th>
              <th className="py-2 text-right">Amount</th>
              <th className="py-2 text-right">Value (EUR)</th>
            </tr>
          </thead>
          <tbody>
            {assets?.map((a, i) => <AssetRow key={i} a={a} />)}
            {!assets?.length && (
              <tr>
                <td colSpan={3} className="py-8 text-center text-sm text-on-surface-variant">
                  Loading assets…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {/* Add Funds / Buy EURD modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-md border border-outline-variant bg-surface-container-high p-6"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="mb-1 text-lg font-semibold text-on-surface">Buy EURD</h3>
            <p className="mb-4 text-sm text-on-surface-variant">
              Purchase EURD via Quantoz bank transfer. Funds settle to this safe's treasury address.
            </p>

            <FormField label="Amount (EUR)">
              <input
                type="number"
                min={0}
                className={inputCls}
                value={amount}
                onChange={e => setAmount(+e.target.value)}
              />
            </FormField>

            <div className="mt-3 rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-2 font-mono text-xs text-on-surface-variant">
              Exchange rate: 1 EUR = 1 EURD · Quantoz platform
            </div>

            <div className="mt-4 flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleBuyEurd}>Continue to Bank</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
