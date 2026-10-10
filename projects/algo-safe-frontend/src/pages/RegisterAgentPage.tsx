// src/pages/RegisterAgentPage.tsx
import { algo, AlgorandClient } from '@algorandfoundation/algokit-utils'
import { useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@txnlab/use-wallet-react'
import { createAdminChange, getAlgoSafeContractVersion, getClient } from 'algo-safe'
import algosdk from 'algosdk'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { FormField, inputCls } from '../components/ui/FormField'
import { Icon } from '../components/ui/Icon'
import { useSafe } from '../hooks'
import { useOnChainSafeHoldings } from '../hooks/useOnChainSafeHoldings'
import { getKnownAssets } from '../lib/assetMetadata'
import { useSafeId } from '../lib/SafeContext'
import type { AssetSymbol } from '../services/types'

const TX_VALIDITY_WINDOW = 200
// Fee cap only — actual fee comes from simulation via `coverAppCallInnerTransactionFees`.
const PROPOSAL_MAX_FEE = algo(0.05)
const GOVERNANCE_GROUP_ID = 1n
const GOVERNED_CREATE_GROUP = 1n
const AGENT_MEMBER_TYPE = 4n
const AGENT_ALLOWED_ACTIONS = 7n

type SpendingAssetOption = {
  key: string
  symbol: AssetSymbol
  name: string
  assetId?: number
  decimals: number
  balanceDisplay: string
  isNative: boolean
}

// `value` is stored on-chain in the policy label (kept in English); `labelKey` is the localized display text.
const PURPOSES = [
  { value: 'Algorithmic Trading', labelKey: 'purposes.trading' },
  { value: 'Treasury Rebalancing', labelKey: 'purposes.rebalancing' },
  { value: 'Yield Farming', labelKey: 'purposes.yield' },
  { value: 'Payments', labelKey: 'purposes.payments' },
] as const

function parseBaseUnits(value: string, decimals: number) {
  const trimmed = value.trim()
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) return null

  const [wholePart, fractionPart = ''] = trimmed.split('.')
  if (fractionPart.length > decimals) return null

  const normalized = `${wholePart}${fractionPart.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '')
  return BigInt(normalized || '0')
}

function getCurrentRound(status: Record<string, unknown>) {
  const candidate = status.lastRound ?? status['last-round']
  if (typeof candidate === 'number') return BigInt(candidate)
  if (typeof candidate === 'bigint') return candidate
  if (typeof candidate === 'string' && candidate.trim()) return BigInt(candidate)
  return 0n
}

// Enhanced PolicyLogicBlock matching the reference design (icon + CONDITION/ACTION/SIGNERS rows)
function PolicyPreviewBlock({ condition, action, signers }: { condition: string; action: string; signers: string }) {
  const { t } = useTranslation('agents')
  const rows = [
    { icon: 'event_available', label: t('register.condition'), value: condition },
    { icon: 'bolt', label: t('register.action'), value: action },
    { icon: 'verified_user', label: t('register.signers'), value: signers },
  ]
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <div
          key={r.label}
          className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container-lowest p-3 transition-colors hover:border-primary/40 hover:bg-surface-container-low"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-primary/20 text-primary">
            <Icon name={r.icon} className="text-lg" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-mono text-xs uppercase tracking-wide text-on-surface-variant">{r.label}</p>
            <p className="mt-0.5 text-sm text-on-surface">{r.value}</p>
          </div>
          {i < rows.length - 1 && <Icon name="add" className="shrink-0 text-on-surface-variant" />}
        </div>
      ))}
    </div>
  )
}

export function RegisterAgentPage() {
  const { t } = useTranslation('agents')
  const safeId = useSafeId()
  const nav = useNavigate()
  const queryClient = useQueryClient()
  const { data: safe } = useSafe(safeId)
  const { data: holdings } = useOnChainSafeHoldings(safeId)
  const { activeAddress, algodClient, transactionSigner, isReady } = useWallet()

  const [alias, setAlias] = useState('')
  const [address, setAddress] = useState('')
  const [purpose, setPurpose] = useState('')
  const [dailyLimit, setDailyLimit] = useState('1000')
  const [spendingLimitAssetKey, setSpendingLimitAssetKey] = useState('native-algo')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const knownAssets = getKnownAssets(safe?.network)

  const spendingLimitAssets: SpendingAssetOption[] = [
    ...((holdings ?? [])
      .filter((holding) => holding.isNative || holding.assetId !== undefined)
      .map((holding) => ({
        key: holding.isNative ? 'native-algo' : `asa-${holding.assetId}`,
        symbol: holding.symbol,
        name: holding.name,
        assetId: holding.assetId,
        decimals: holding.decimals,
        balanceDisplay: holding.balanceDisplay,
        isNative: holding.isNative,
      })) as SpendingAssetOption[]),
    ...knownAssets
      .filter((asset) => asset.assetId !== 0)
      .filter((asset) => !(holdings ?? []).some((holding) => Number(holding.assetId ?? 0) === asset.assetId))
      .map((asset) => ({
        key: `asa-${asset.assetId}`,
        symbol: asset.symbol,
        name: asset.name,
        assetId: asset.assetId,
        decimals: asset.decimals,
        balanceDisplay: t('register.notHeld'),
        isNative: false,
      })),
  ]

  const selectedSpendingAsset = spendingLimitAssets.find((asset) => asset.key === spendingLimitAssetKey) ??
    spendingLimitAssets[0] ?? {
      key: 'native-algo',
      symbol: 'ALGO',
      assetId: 0,
      decimals: 6,
      balanceDisplay: '—',
      isNative: true,
    }

  const valid = alias.trim() !== '' && address.trim() !== '' && purpose !== ''

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    setError(null)

    if (!safe) {
      setError(t('register.errSafe'))
      return
    }

    if (!isReady || !activeAddress || !transactionSigner) {
      setError(t('register.errWallet'))
      return
    }

    if (!algosdk.isValidAddress(address.trim())) {
      setError(t('register.errAddress'))
      return
    }

    const rawLimit = parseBaseUnits(dailyLimit, selectedSpendingAsset.decimals)
    if (rawLimit === null || rawLimit < 0n) {
      setError(t('register.errLimit', { symbol: selectedSpendingAsset.symbol }))
      return
    }

    try {
      setIsSubmitting(true)

      const senderAddress = algosdk.Address.fromString(activeAddress)
      const algorand = AlgorandClient.fromClients({ algod: algodClient }).setDefaultValidityWindow(TX_VALIDITY_WINDOW)
      algorand.setSigner(senderAddress, transactionSigner)

      const clientVersion = await getAlgoSafeContractVersion(algodClient, BigInt(safe.appId))
      const appClient = algorand.client.getTypedAppClientById(getClient(clientVersion ?? 'latest'), {
        appId: BigInt(safe.appId),
        defaultSender: senderAddress,
      })

      const status = (await algodClient.status().do()) as unknown as Record<string, unknown>
      const expiryRound = getCurrentRound(status) + 2000n
      const policyLabel = `${purpose} · limit ${dailyLimit.trim() || '0'} ${selectedSpendingAsset.symbol}`
      const limitAssetId = BigInt(selectedSpendingAsset.assetId ?? 0)

      const result = await appClient.send.proposeAdminChange({
        args: {
          groupId: GOVERNANCE_GROUP_ID,
          change: createAdminChange({
            changeType: GOVERNED_CREATE_GROUP,
            targetGroupId: 0n,
            groupName: `${alias.trim()} Agent`,
            memberAddr: address.trim(),
            memberType: AGENT_MEMBER_TYPE,
            memberLabel: policyLabel,
            threshold: 1n,
            adminPrivileges: 0n,
            allowedActions: AGENT_ALLOWED_ACTIONS,
            limitAssetId,
            dailyLimit: rawLimit,
            monthlyLimit: 0n,
            cooldownRounds: 0n,
            activeFlag: 1n,
          }),
          expiryRound,
          ensureBudgetValue: 0n,
          // The versioned-client union types the args as the intersection of every
          // contract version's shape, which no single value satisfies — narrow cast.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        maxFee: PROPOSAL_MAX_FEE,
        coverAppCallInnerTransactionFees: true,
        populateAppCallResources: true,
        suppressLog: true,
      })

      const proposalId = result.return?.toString() ?? ''
      const txId = result.txIds[0] ?? ''

      await queryClient.invalidateQueries({ queryKey: ['proposals', safeId] })
      await queryClient.invalidateQueries({ queryKey: ['proposal', safeId, proposalId] })
      nav(`/safe/${safeId}/proposals/${proposalId}`, { state: { txId } })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('register.errFailed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const purposeLabel = PURPOSES.find((p) => p.value === purpose)
  const conditionText = t('register.conditionText', { limit: dailyLimit || '0', symbol: selectedSpendingAsset.symbol })
  const actionText = t('register.actionText')
  const signersText =
    purpose !== ''
      ? t('register.signersWithPurpose', { purpose: purposeLabel ? t(purposeLabel.labelKey) : purpose })
      : t('register.signersDefault')

  return (
    <div className="space-y-6">
      {/* Breadcrumb + Header */}
      <div className="flex items-end justify-between">
        <div>
          <nav className="mb-2 flex items-center gap-1 font-mono text-xs text-on-surface-variant">
            <span>{t('register.breadcrumbTreasury')}</span>
            <Icon name="chevron_right" className="text-sm" />
            <span>{t('register.breadcrumbAgents')}</span>
            <Icon name="chevron_right" className="text-sm" />
            <span className="text-primary">{t('register.breadcrumbNew')}</span>
          </nav>
          <h1 className="text-3xl font-bold text-on-surface">{t('register.title')}</h1>
          <p className="mt-1 text-sm text-on-surface-variant">{t('register.subtitle')}</p>
        </div>
        {/* Treasury balance context */}
        <div className="hidden lg:flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container px-5 py-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icon name="account_balance_wallet" className="text-xl" />
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-wide text-on-surface-variant">{t('register.balanceLabel')}</p>
            <p className="text-lg font-bold text-on-surface">
              {selectedSpendingAsset.balanceDisplay}{' '}
              <span className="text-sm font-medium text-primary">{selectedSpendingAsset.symbol}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 rounded-md border border-error-container bg-error-container/30 px-4 py-3 text-sm text-on-error-container">
          <Icon name="error" className="shrink-0 text-error" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left column — Form */}
          <div className="lg:col-span-7 space-y-6">
            {/* Agent Identity & Parameters card */}
            <Card className="p-0 overflow-hidden">
              <div className="border-b border-outline-variant bg-surface-container-high px-6 py-4">
                <h3 className="text-base font-semibold text-on-surface">{t('register.identityTitle')}</h3>
              </div>
              <div className="space-y-6 px-6 py-6">
                {/* Agent Name */}
                <FormField label={t('register.nameLabel')} hint={t('register.required')}>
                  <input
                    className={inputCls}
                    type="text"
                    placeholder={t('register.namePlaceholder')}
                    value={alias}
                    onChange={(e) => setAlias(e.target.value)}
                    required
                    aria-required="true"
                  />
                </FormField>

                {/* Agent Algorand Address */}
                <FormField label={t('register.addressLabel')} hint={t('register.addressHint')}>
                  <div className="relative">
                    <input
                      className={`${inputCls} font-mono pr-10`}
                      type="text"
                      placeholder="A7RX..."
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      required
                      aria-required="true"
                    />
                    <Icon
                      name="qr_code_scanner"
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
                    />
                  </div>
                </FormField>

                {/* Purpose */}
                <FormField label={t('register.purposeLabel')} hint={t('register.required')}>
                  <select required className={inputCls} value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-required="true">
                    <option value="" disabled>
                      {t('register.selectPurpose')}
                    </option>
                    {PURPOSES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {t(p.labelKey)}
                      </option>
                    ))}
                  </select>
                </FormField>

                {/* Daily Spending Limit + Spending Limit Asset */}
                <div className="grid grid-cols-2 gap-4">
                  <FormField label={t('register.dailyLimitLabel')}>
                    <input
                      type="text"
                      min={0}
                      className={inputCls}
                      value={dailyLimit}
                      onChange={(e) => setDailyLimit(e.target.value)}
                      inputMode="decimal"
                    />
                  </FormField>
                  <FormField label={t('register.limitAssetLabel')} hint={t('register.limitAssetHint')}>
                    <select
                      className={inputCls}
                      value={selectedSpendingAsset.key}
                      onChange={(e) => setSpendingLimitAssetKey(e.target.value)}
                    >
                      {spendingLimitAssets.map((asset) => (
                        <option key={asset.key} value={asset.key}>
                          {t('register.assetOption', { symbol: asset.symbol, balance: asset.balanceDisplay })}
                        </option>
                      ))}
                    </select>
                  </FormField>
                </div>
              </div>
            </Card>

            {/* Policy Preview inline (below form on mobile, shown here on all widths) */}
            <div className="lg:hidden">
              <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-on-surface-variant">{t('register.previewTitle')}</h2>
              <PolicyPreviewBlock condition={conditionText} action={actionText} signers={signersText} />
            </div>

            {/* Action row */}
            <div className="flex items-center justify-end gap-3">
              <Button type="button" variant="ghost" onClick={() => nav(`/safe/${safeId}`)}>
                {t('register.cancel')}
              </Button>
              <Button type="submit" disabled={!valid || isSubmitting || !safe}>
                <Icon name="send" className="text-lg" />
                {isSubmitting ? t('register.submitting') : t('register.submit')}
              </Button>
            </div>

            {/* Gas note */}
            <p className="text-center font-mono text-xs text-on-surface-variant">{t('register.feeNote')}</p>
          </div>

          {/* Right column — Policy preview + Proposal workflow */}
          <div className="lg:col-span-5 space-y-6">
            {/* Policy Preview (desktop) */}
            <div className="hidden lg:block">
              <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-on-surface-variant">{t('register.previewTitle')}</h2>
              <PolicyPreviewBlock condition={conditionText} action={actionText} signers={signersText} />
            </div>

            {/* Proposal Workflow card */}
            <Card>
              <div className="mb-5 flex items-center gap-3">
                <Icon name="gavel" className="text-primary" />
                <h4 className="text-base font-semibold text-on-surface">{t('register.workflowTitle')}</h4>
              </div>
              <ul className="relative space-y-5">
                {/* connector line */}
                <div className="absolute left-[15px] top-6 bottom-6 w-0.5 bg-outline-variant" />
                {[
                  {
                    n: 1,
                    title: t('register.step1Title'),
                    desc: t('register.step1Desc'),
                    active: true,
                  },
                  {
                    n: 2,
                    title: t('register.step2Title'),
                    desc: t('register.step2Desc'),
                    active: false,
                  },
                  {
                    n: 3,
                    title: t('register.step3Title'),
                    desc: t('register.step3Desc'),
                    active: false,
                  },
                ].map((step) => (
                  <li key={step.n} className="relative z-10 flex gap-3">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        step.active
                          ? 'bg-primary text-on-primary'
                          : 'border border-outline-variant bg-surface-container-high text-on-surface-variant'
                      }`}
                    >
                      {step.n}
                    </div>
                    <div>
                      <p className={`text-sm font-semibold ${step.active ? 'text-on-surface' : 'text-on-surface-variant'}`}>{step.title}</p>
                      <p className="mt-0.5 text-xs text-on-surface-variant">{step.desc}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>

            {/* Security note */}
            <div className="rounded-md border border-outline-variant bg-surface-container-lowest px-4 py-3">
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded border border-primary/30 bg-primary/20 px-2 py-0.5 font-mono text-xs text-primary">
                  {t('register.enclave')}
                </span>
              </div>
              <p className="text-sm font-semibold text-on-surface">{t('register.secured')}</p>
              <p className="mt-1 text-xs text-on-surface-variant">{t('register.x402')}</p>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
