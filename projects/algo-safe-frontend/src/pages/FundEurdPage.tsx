// src/pages/FundEurdPage.tsx
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useSnackbar } from 'notistack'
import { useServices } from '../services'
import { Button, Card, DemoDataChip, FormField, Icon, Stepper, inputCls } from '../components/ui'
import { fmtEur } from '../lib/format'

const STEPS = ['Amount', 'Bank', 'Confirm']

export const FundEurdPage = () => {
  const { quantoz, quantozLive } = useServices()
  const { enqueueSnackbar } = useSnackbar()
  const [searchParams] = useSearchParams()

  const [step, setStep] = useState(0)
  const [amount, setAmount] = useState('')
  const [country, setCountry] = useState('')
  const [bankId, setBankId] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [sessionRef, setSessionRef] = useState('')

  // If returning from bank redirect
  const returnStatus = searchParams.get('status')

  const { data: countries = [], isLoading: countriesLoading } = useQuery({
    queryKey: ['fbb-countries'],
    queryFn: () => quantoz.getFundByBankCountries(),
  })

  const { data: banks = [], isLoading: banksLoading } = useQuery({
    queryKey: ['fbb-banks', country],
    queryFn: () => quantoz.getFundByBankBanks(country),
    enabled: !!country,
  })

  const amountNum = parseFloat(amount)
  const amountValid = !isNaN(amountNum) && amountNum >= 5
  const selectedCountry = countries.find(c => c.countryCode === country)
  const selectedBank = banks.find(b => b.bankId === bankId)

  const handleGenerate = async () => {
    if (!selectedBank || !selectedCountry) return
    setLoading(true)
    try {
      const session = await quantoz.createFundByBankSession({
        countryCode: country,
        bankId,
        amount: amountNum,
        redirectUrl: window.location.origin + '/fund?status=return',
      })
      setSessionRef(session.sessionReference)

      // If live and redirectUrl looks real (not a demo marker URL)
      if (
        quantozLive &&
        session.redirectUrl.startsWith('http') &&
        !session.redirectUrl.includes('?demo=1')
      ) {
        window.location.href = session.redirectUrl
        return
      }

      // Otherwise show demo confirmation
      setConfirmed(true)
    } catch {
      enqueueSnackbar('Failed to create funding session', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  // ── Return state (bank redirect came back) ────────────────────────────────
  if (returnStatus === 'return') {
    return (
      <div className="max-w-[640px] mx-auto pt-8 pb-16">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4 border border-green-200">
            <Icon name="check_circle" className="text-ok text-[28px]" />
          </div>
          <h2 className="text-2xl font-bold text-ink-900 tracking-tight mb-2">Funding Initiated</h2>
          <p className="text-sm text-ink-500 max-w-sm mx-auto">
            Your SEPA transfer has been submitted. EURD will appear in your treasury balance after settlement
            (typically within 1 business day).
          </p>
        </div>

        <Card className="text-center">
          <div className="flex items-center justify-center gap-2 text-ink-500 text-sm">
            <Icon name="schedule" className="text-[16px]" />
            Settlement pending — check back shortly
          </div>
          <div className="mt-4">
            <a href="/" className="text-sm font-semibold text-brand-600 hover:text-brand-700 flex items-center justify-center gap-1">
              <Icon name="arrow_back" className="text-[16px]" />
              Back to Dashboard
            </a>
          </div>
        </Card>
      </div>
    )
  }

  // ── Demo confirmation panel ───────────────────────────────────────────────
  if (confirmed) {
    return (
      <div className="max-w-[640px] mx-auto pt-8 pb-16">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-full bg-brand-100 flex items-center justify-center mx-auto mb-4">
            <Icon name="account_balance" className="text-brand-600 text-[28px]" />
          </div>
          <h2 className="text-2xl font-bold text-ink-900 tracking-tight mb-1">Instructions Generated</h2>
          <p className="text-sm text-ink-500">Session reference: <span className="font-mono text-ink-700">{sessionRef}</span></p>
        </div>

        <Card>
          {/* Demo chip header */}
          <div className="flex items-center justify-between mb-5 pb-4 border-b border-surface-border">
            <span className="text-sm font-semibold text-ink-900">Funding Session Details</span>
            <DemoDataChip />
          </div>

          {/* Summary rows */}
          <div className="flex flex-col gap-3 mb-6">
            <div className="flex justify-between items-center text-sm">
              <span className="text-ink-500">Amount</span>
              <span className="font-semibold text-ink-900">{fmtEur(amountNum)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-ink-500">Yields</span>
              <span className="font-semibold text-ink-900">{fmtEur(amountNum)} EURD</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-ink-500">Country</span>
              <span className="font-medium text-ink-900">{selectedCountry?.name ?? country}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-ink-500">Bank</span>
              <span className="font-medium text-ink-900">{selectedBank?.name ?? bankId}</span>
            </div>
          </div>

          {/* Demo info box */}
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 flex gap-3">
            <Icon name="info" className="text-warn text-[18px] flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 leading-relaxed">
              In production this redirects to your bank via iDEAL / open-banking and mints 1:1 EURD on settlement. Regulated issuance by <span className="font-semibold">Quantoz Payments B.V.</span>
            </p>
          </div>

          <div className="mt-5 text-center">
            <a href="/" className="text-sm font-semibold text-brand-600 hover:text-brand-700 flex items-center justify-center gap-1">
              <Icon name="arrow_back" className="text-[16px]" />
              Back to Dashboard
            </a>
          </div>
        </Card>
      </div>
    )
  }

  // ── Wizard ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-[640px] mx-auto pt-4 pb-16">
      {/* Page header */}
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-ink-900 tracking-tight mb-1">Fund with EURD</h2>
        <p className="text-sm text-ink-500">Deposit via SEPA · Regulated issuance by Quantoz Payments B.V.</p>
      </div>

      {/* Wizard card */}
      <Card className="shadow-sm">
        {/* Stepper */}
        <div className="mb-8">
          <Stepper steps={STEPS} current={step} />
        </div>

        {/* ── Step 0: Amount ─────────────────────────────────────────────── */}
        {step === 0 && (
          <div className="flex flex-col gap-6">
            <FormField
              label="Amount (EUR)"
              hint="Minimum €5.00 · 1 EUR = 1 EURD"
            >
              <div className="relative mt-1">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-ink-400 font-medium text-sm">€</span>
                <input
                  type="number"
                  min={5}
                  step={0.01}
                  className={`${inputCls} pl-7 text-lg font-semibold`}
                  placeholder="0.00"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                />
              </div>
            </FormField>

            {/* Live yield preview */}
            {amountValid && (
              <div className="rounded-lg bg-brand-50 border border-brand-100 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-brand-700">
                  <Icon name="euro" className="text-[16px]" />
                  <span>Yields</span>
                </div>
                <span className="text-base font-bold text-brand-600">{fmtEur(amountNum)} EURD</span>
              </div>
            )}

            {/* Regulated footer */}
            <div className="flex items-center gap-2 text-xs text-ink-400 pt-1">
              <Icon name="verified" className="text-[14px] text-ok" />
              Regulated issuance by Quantoz Payments B.V. · SEPA instant transfer
            </div>

            <div className="flex justify-end pt-2">
              <Button
                variant="primary"
                disabled={!amountValid}
                onClick={() => setStep(1)}
              >
                Next
                <Icon name="arrow_forward" className="text-[16px]" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 1: Bank ───────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="flex flex-col gap-6">
            <FormField label="Country">
              <select
                className={`${inputCls} mt-1 appearance-none`}
                value={country}
                onChange={e => { setCountry(e.target.value); setBankId('') }}
                disabled={countriesLoading}
              >
                <option value="" disabled>
                  {countriesLoading ? 'Loading countries…' : 'Select your country…'}
                </option>
                {countries.map(c => (
                  <option key={c.countryCode} value={c.countryCode}>{c.name}</option>
                ))}
              </select>
            </FormField>

            <FormField label="Bank">
              <select
                className={`${inputCls} mt-1 appearance-none`}
                value={bankId}
                onChange={e => setBankId(e.target.value)}
                disabled={!country || banksLoading}
              >
                <option value="" disabled>
                  {!country ? 'Select a country first…' : banksLoading ? 'Loading banks…' : 'Select your bank…'}
                </option>
                {banks.map(b => (
                  <option key={b.bankId} value={b.bankId}>{b.name}</option>
                ))}
              </select>
            </FormField>

            {!quantozLive && (
              <div className="flex items-center gap-2">
                <DemoDataChip />
                <span className="text-xs text-ink-400">Mock bank list — not connected to Quantoz API</span>
              </div>
            )}

            <div className="flex justify-between pt-2">
              <Button variant="secondary" onClick={() => setStep(0)}>
                <Icon name="arrow_back" className="text-[16px]" />
                Back
              </Button>
              <Button
                variant="primary"
                disabled={!country || !bankId}
                onClick={() => setStep(2)}
              >
                Next
                <Icon name="arrow_forward" className="text-[16px]" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Confirm ────────────────────────────────────────────── */}
        {step === 2 && (
          <div className="flex flex-col gap-6">
            <div>
              <h3 className="text-sm font-semibold text-ink-900 mb-3">Summary</h3>
              <div className="rounded-lg border border-surface-border divide-y divide-surface-border">
                <div className="flex justify-between items-center px-4 py-3 text-sm">
                  <span className="text-ink-500">Amount</span>
                  <span className="font-semibold text-ink-900">{fmtEur(amountNum)}</span>
                </div>
                <div className="flex justify-between items-center px-4 py-3 text-sm">
                  <span className="text-ink-500">Yields</span>
                  <span className="font-semibold text-brand-600">{fmtEur(amountNum)} EURD</span>
                </div>
                <div className="flex justify-between items-center px-4 py-3 text-sm">
                  <span className="text-ink-500">Country</span>
                  <span className="font-medium text-ink-900">{selectedCountry?.name ?? country}</span>
                </div>
                <div className="flex justify-between items-center px-4 py-3 text-sm">
                  <span className="text-ink-500">Bank</span>
                  <span className="font-medium text-ink-900">{selectedBank?.name ?? bankId}</span>
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-brand-50 border border-brand-100 px-4 py-3 flex gap-3">
              <Icon name="account_balance" className="text-brand-600 text-[18px] flex-shrink-0 mt-0.5" />
              <p className="text-xs text-brand-800 leading-relaxed">
                Clicking "Generate Instructions" will initiate a SEPA transfer session via iDEAL / open-banking.
                EURD is minted 1:1 on settlement. Regulated by <span className="font-semibold">Quantoz Payments B.V.</span>
              </p>
            </div>

            <div className="flex justify-between pt-2">
              <Button variant="secondary" onClick={() => setStep(1)}>
                <Icon name="arrow_back" className="text-[16px]" />
                Back
              </Button>
              <Button
                variant="primary"
                disabled={loading}
                onClick={handleGenerate}
              >
                {loading ? (
                  <>
                    <Icon name="hourglass_empty" className="text-[16px]" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Icon name="launch" className="text-[16px]" />
                    Generate Instructions
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
