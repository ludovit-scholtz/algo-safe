import { algo, AlgorandClient } from '@algorandfoundation/algokit-utils'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@txnlab/use-wallet-react'
import {
  ACT_ACFG,
  ACT_APPL,
  ACT_AXFER,
  ACT_KEYREG,
  ACT_PAY,
  ACT_REKEY,
  ADM_ADD_MEMBER,
  ADM_CHANGE_THRESHOLD,
  ADM_DISSOLVE_CUSTODIAN,
  ADM_REMOVE_GUARD,
  ADM_REMOVE_MEMBER,
  ADM_SET_ACTIVE,
  ADM_SET_GUARD,
  ADM_SET_POLICY,
  ADM_SET_PRIVILEGES,
  PRIV_GROUP,
  PRIV_POLICY,
  createAdminChange,
  getAlgoSafeContractVersion,
  getClient,
  listAssetGuards,
  type AdminChange,
} from 'algo-safe'
import algosdk from 'algosdk'
import { useSnackbar } from 'notistack'
import { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { AddressDisplay } from '../components/AddressDisplay'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { FormField, inputCls } from '../components/ui/FormField'
import { Icon } from '../components/ui/Icon'
import { useSafe, useSignerGroup } from '../hooks'
import { useOnChainSafeHoldings } from '../hooks/useOnChainSafeHoldings'
import { getKnownAssets } from '../lib/assetMetadata'
import { formatUnits, getZeroAddress } from '../lib/onChainSafe'
import { useSafeId } from '../lib/SafeContext'
import type { TFunction } from 'i18next'
import type { AssetSymbol } from '../services/types'

const TX_VALIDITY_WINDOW = 200
// Fee cap only — actual fee comes from simulation via `coverAppCallInnerTransactionFees`.
const PROPOSAL_MAX_FEE = algo(0.05)

const MEMBER_TYPE_OPTIONS = [
  { value: 1, labelKey: 'memberTypes.standard' },
  { value: 2, labelKey: 'memberTypes.multisig' },
  { value: 3, labelKey: 'memberTypes.rekeyed' },
  { value: 4, labelKey: 'memberTypes.agent' },
  { value: 5, labelKey: 'memberTypes.quantum' },
]

const ZERO_ADDRESS = getZeroAddress()

type SpendingAssetOption = {
  key: string
  symbol: AssetSymbol
  name: string
  assetId?: number
  decimals: number
  balanceDisplay: string
  isNative: boolean
}

type AdminChangeTuple = [
  bigint,
  bigint,
  string,
  string,
  bigint,
  string,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
]

function getCurrentRound(status: Record<string, unknown>) {
  const candidate = status.lastRound ?? status['last-round']
  if (typeof candidate === 'number') return BigInt(candidate)
  if (typeof candidate === 'bigint') return candidate
  if (typeof candidate === 'string' && candidate.trim()) return BigInt(candidate)
  return 0n
}

function parseBaseUnits(value: string, decimals: number) {
  const trimmed = value.trim()
  if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) return null

  const [wholePart, fractionPart = ''] = trimmed.split('.')
  if (fractionPart.length > decimals) return null

  const normalized = `${wholePart}${fractionPart.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '')
  return BigInt(normalized || '0')
}

function accountTypeLabel(accountType: number, t: TFunction<'signers'>) {
  const option = MEMBER_TYPE_OPTIONS.find((candidate) => candidate.value === accountType)
  return option ? t(option.labelKey) : t('memberTypes.unknown', { type: accountType })
}

function flagSet(mask: number, flag: bigint) {
  return (mask & Number(flag)) !== 0
}

function toAdminChangeTuple(change: AdminChange): AdminChangeTuple {
  return [
    change.changeType,
    change.targetGroupId,
    change.groupName,
    change.memberAddr,
    change.memberType,
    change.memberLabel,
    change.threshold,
    change.adminPrivileges,
    change.allowedActions,
    change.limitAssetId,
    change.dailyLimit,
    change.monthlyLimit,
    change.cooldownRounds,
    change.activeFlag,
    change.guardAmount,
  ]
}

export function SignerGroupManagementPage() {
  const { t } = useTranslation('signers')
  const safeId = useSafeId()
  const { groupId = '' } = useParams<{ groupId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const { data: safe } = useSafe(safeId)
  const { data: detail, isLoading, isFetching, error: detailError } = useSignerGroup(groupId)
  const { data: holdings } = useOnChainSafeHoldings(safeId)
  const { activeAddress, algodClient, transactionSigner, isReady } = useWallet()

  const [selectedAdminGroupId, setSelectedAdminGroupId] = useState('')
  const [memberAddress, setMemberAddress] = useState('')
  const [memberLabel, setMemberLabel] = useState('')
  const [memberType, setMemberType] = useState('1')
  const [threshold, setThreshold] = useState('1')
  const [dailyLimit, setDailyLimit] = useState('0')
  const [monthlyLimit, setMonthlyLimit] = useState('0')
  const [spendingLimitAssetKey, setSpendingLimitAssetKey] = useState('native-algo')
  const [cooldownRounds, setCooldownRounds] = useState('0')
  const [allowAlgo, setAllowAlgo] = useState(false)
  const [allowAsa, setAllowAsa] = useState(false)
  const [allowApp, setAllowApp] = useState(false)
  const [allowKeyreg, setAllowKeyreg] = useState(false)
  const [allowAcfg, setAllowAcfg] = useState(false)
  const [allowRekey, setAllowRekey] = useState(false)
  const [guardAssetKey, setGuardAssetKey] = useState('native-algo')
  const [guardAmount, setGuardAmount] = useState('0')
  const [groupAdmin, setGroupAdmin] = useState(false)
  const [policyAdmin, setPolicyAdmin] = useState(false)
  const [isActive, setIsActive] = useState(true)
  const [submittingSection, setSubmittingSection] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reportError = (message: string) => {
    setError(message)
  }
  const knownAssets = useMemo(() => getKnownAssets(safe?.network), [safe?.network])

  useEffect(() => {
    if (!(detailError instanceof Error)) return
  }, [detailError, groupId, safeId])

  const spendingLimitAssets: SpendingAssetOption[] = useMemo(() => {
    const assetMap = new Map<string, SpendingAssetOption>()

    const upsert = (asset: SpendingAssetOption) => {
      assetMap.set(asset.key, asset)
    }

    for (const holding of holdings ?? []) {
      if (!holding.isNative && holding.assetId === undefined) continue

      upsert({
        key: holding.isNative ? 'native-algo' : `asa-${holding.assetId}`,
        symbol: holding.symbol,
        name: holding.name,
        assetId: holding.assetId,
        decimals: holding.decimals,
        balanceDisplay: holding.balanceDisplay,
        isNative: holding.isNative,
      })
    }

    for (const asset of knownAssets) {
      if (asset.isNative) continue

      const key = `asa-${asset.assetId}`
      if (assetMap.has(key)) continue

      upsert({
        key,
        symbol: asset.symbol,
        name: asset.name,
        assetId: asset.assetId,
        decimals: asset.decimals,
        balanceDisplay: t('manage.policy.notHeld'),
        isNative: false,
      })
    }

    if (!assetMap.has('native-algo')) {
      upsert({
        key: 'native-algo',
        symbol: 'ALGO',
        name: 'Algorand Native',
        assetId: 0,
        decimals: 6,
        balanceDisplay: '0',
        isNative: true,
      })
    }

    if (detail) {
      const trackedAsset = detail.group.limitAsset
      const trackedKey = trackedAsset.isNative ? 'native-algo' : `asa-${trackedAsset.assetId}`
      if (!assetMap.has(trackedKey)) {
        upsert({
          key: trackedKey,
          symbol: trackedAsset.symbol,
          name: trackedAsset.name,
          assetId: trackedAsset.assetId,
          decimals: trackedAsset.decimals,
          balanceDisplay: t('manage.policy.notHeld'),
          isNative: trackedAsset.isNative,
        })
      }
    }

    return Array.from(assetMap.values()).sort((left, right) => {
      if (left.isNative !== right.isNative) return left.isNative ? -1 : 1
      return left.symbol.localeCompare(right.symbol) || (left.assetId ?? 0) - (right.assetId ?? 0)
    })
  }, [detail, holdings, knownAssets, t])

  const selectedSpendingAsset = spendingLimitAssets.find((asset) => asset.key === spendingLimitAssetKey) ??
    spendingLimitAssets[0] ?? {
      key: 'native-algo',
      symbol: 'ALGO',
      name: 'Algorand Native',
      assetId: 0,
      decimals: 6,
      balanceDisplay: '—',
      isNative: true,
    }

  useEffect(() => {
    if (!detail) return
    const preferredAdminGroup = detail.adminGroupOptions.find((option) => option.isMember)?.id ?? detail.adminGroupOptions[0]?.id ?? ''
    setSelectedAdminGroupId(preferredAdminGroup)
    setThreshold(detail.group.threshold.toString())
    setCooldownRounds(detail.group.cooldownRounds.toString())
    setAllowAlgo(flagSet(detail.group.allowedActions, ACT_PAY))
    setAllowAsa(flagSet(detail.group.allowedActions, ACT_AXFER))
    setAllowApp(flagSet(detail.group.allowedActions, ACT_APPL))
    setAllowKeyreg(flagSet(detail.group.allowedActions, ACT_KEYREG))
    setAllowAcfg(flagSet(detail.group.allowedActions, ACT_ACFG))
    setAllowRekey(flagSet(detail.group.allowedActions, ACT_REKEY))
    setGroupAdmin(flagSet(detail.group.adminPrivileges, PRIV_GROUP))
    setPolicyAdmin(flagSet(detail.group.adminPrivileges, PRIV_POLICY))
    setIsActive(detail.group.active)
  }, [detail])

  useEffect(() => {
    if (!detail) return

    const nextAssetKey = detail.group.limitAsset.isNative ? 'native-algo' : `asa-${detail.group.limitAsset.assetId}`
    setSpendingLimitAssetKey(nextAssetKey)
    setDailyLimit(formatUnits(detail.group.dailyLimit, detail.group.limitAsset.decimals))
    setMonthlyLimit(formatUnits(detail.group.monthlyLimit, detail.group.limitAsset.decimals))
  }, [
    detail?.group.id,
    detail?.group.limitAsset.assetId,
    detail?.group.limitAsset.decimals,
    detail?.group.limitAsset.isNative,
    detail?.group.dailyLimit,
    detail?.group.monthlyLimit,
  ])

  const canSubmit = !!safe && !!isReady && !!activeAddress && !!transactionSigner && !!selectedAdminGroupId
  const currentMembers = detail?.members ?? []
  const maxThreshold = detail?.group.memberCount ?? 1
  const selectedAdminGroup = detail?.adminGroupOptions.find((option) => option.id === selectedAdminGroupId)
  const actionMask = useMemo(() => {
    let mask = 0n
    if (allowAlgo) mask |= ACT_PAY
    if (allowAsa) mask |= ACT_AXFER
    if (allowApp) mask |= ACT_APPL
    if (allowKeyreg) mask |= ACT_KEYREG
    if (allowAcfg) mask |= ACT_ACFG
    if (allowRekey) mask |= ACT_REKEY
    return mask
  }, [allowAlgo, allowApp, allowAsa, allowKeyreg, allowAcfg, allowRekey])

  // Live asset-guard list for custodian groups ('ag' box scan; no on-chain index).
  const { data: assetGuards } = useQuery({
    queryKey: ['asset-guards', safeId, groupId],
    enabled: !!safe && !!detail?.group.isCustodian,
    queryFn: () => listAssetGuards(algodClient, BigInt(safe!.appId), BigInt(groupId)),
  })

  const guardAssetMetadata = (assetId: bigint) => {
    if (assetId === 0n) return { symbol: 'ALGO', decimals: 6 }
    const known = spendingLimitAssets.find((asset) => BigInt(asset.assetId ?? 0) === assetId)
    return { symbol: known?.symbol ?? `ASA ${assetId}`, decimals: known?.decimals ?? 0 }
  }
  const adminMask = useMemo(() => {
    let mask = 0n
    if (groupAdmin) mask |= PRIV_GROUP
    if (policyAdmin) mask |= PRIV_POLICY
    return mask
  }, [groupAdmin, policyAdmin])

  async function submitChange(section: string, change: AdminChange, successMessage: string) {
    setError(null)

    if (!safe) {
      reportError(t('shared.safeNotLoaded'))
      return
    }

    if (!canSubmit) {
      reportError(t('manage.connectWallet'))
      return
    }

    try {
      setSubmittingSection(section)

      const senderAddress = algosdk.Address.fromString(activeAddress!)
      const algorand = AlgorandClient.fromClients({ algod: algodClient }).setDefaultValidityWindow(TX_VALIDITY_WINDOW)
      algorand.setSigner(senderAddress, transactionSigner!)

      const clientVersion = await getAlgoSafeContractVersion(algodClient, BigInt(safe.appId))
      const appClient = algorand.client.getTypedAppClientById(getClient(clientVersion ?? 'latest'), {
        appId: BigInt(safe.appId),
        defaultSender: senderAddress,
      })

      const status = (await algodClient.status().do()) as unknown as Record<string, unknown>
      const expiryRound = getCurrentRound(status) + 2000n
      const result = await appClient.send.proposeAdminChange({
        // The versioned-client union types the args as the intersection of every
        // contract version's shape, which no single value satisfies — narrow cast.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        args: [BigInt(selectedAdminGroupId), toAdminChangeTuple(change) as unknown as AdminChange, expiryRound, 0n] as any,
        maxFee: PROPOSAL_MAX_FEE,
        coverAppCallInnerTransactionFees: true,
        populateAppCallResources: true,
        suppressLog: true,
      })

      const proposalId = result.return?.toString() ?? ''
      const txId = result.txIds[0] ?? ''

      await queryClient.invalidateQueries({ queryKey: ['proposals', safeId] })
      await queryClient.invalidateQueries({ queryKey: ['proposal', safeId, proposalId] })
      await queryClient.invalidateQueries({ queryKey: ['signer-groups', safeId] })
      await queryClient.invalidateQueries({ queryKey: ['signer-group', safeId, groupId] })

      enqueueSnackbar(successMessage, { variant: 'success' })
      navigate(`/safe/${safeId}/proposals/${proposalId}`, { state: { txId } })
    } catch (submitError) {
      reportError(submitError instanceof Error ? submitError.message : t('manage.submitFailed'))
    } finally {
      setSubmittingSection(null)
    }
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault()

    if (!algosdk.isValidAddress(memberAddress.trim())) {
      reportError(t('manage.members.invalidAddress'))
      return
    }

    await submitChange(
      'member',
      createAdminChange({
        changeType: ADM_ADD_MEMBER,
        targetGroupId: BigInt(groupId),
        groupName: '',
        memberAddr: memberAddress.trim(),
        memberType: BigInt(memberType),
        memberLabel: memberLabel.trim() || 'member',
        threshold: 0n,
        adminPrivileges: 0n,
        allowedActions: 0n,
        limitAssetId: 0n,
        dailyLimit: 0n,
        monthlyLimit: 0n,
        cooldownRounds: 0n,
        activeFlag: 1n,
      }),
      t('manage.members.addCreated'),
    )
  }

  async function handleRemoveMember(address: string) {
    const remaining = (detail?.group.memberCount ?? 1) - 1
    if (remaining < (detail?.group.threshold ?? 1)) {
      reportError(t('manage.members.belowThreshold'))
      return
    }

    await submitChange(
      `remove-${address}`,
      createAdminChange({
        changeType: ADM_REMOVE_MEMBER,
        targetGroupId: BigInt(groupId),
        memberAddr: address,
      }),
      t('manage.members.removeCreated'),
    )
  }

  async function handleSetGuard(e: React.FormEvent) {
    e.preventDefault()
    const guardAsset = spendingLimitAssets.find((asset) => asset.key === guardAssetKey) ?? selectedSpendingAsset
    const parsedGuardAmount = parseBaseUnits(guardAmount, guardAsset.decimals)
    if (parsedGuardAmount === null) {
      reportError(t('manage.guards.amountInvalid', { symbol: guardAsset.symbol }))
      return
    }

    await submitChange(
      'set-guard',
      createAdminChange({
        changeType: ADM_SET_GUARD,
        targetGroupId: BigInt(groupId),
        limitAssetId: BigInt(guardAsset.assetId ?? 0),
        guardAmount: parsedGuardAmount,
      }),
      t('manage.guards.setCreated'),
    )
  }

  async function handleRemoveGuard(assetId: bigint) {
    await submitChange(
      `remove-guard-${assetId}`,
      createAdminChange({
        changeType: ADM_REMOVE_GUARD,
        targetGroupId: BigInt(groupId),
        limitAssetId: assetId,
      }),
      t('manage.guards.removeCreated'),
    )
  }

  async function handleThresholdUpdate(e: React.FormEvent) {
    e.preventDefault()
    const parsedThreshold = Number(threshold)

    if (!Number.isInteger(parsedThreshold) || parsedThreshold < 1 || parsedThreshold > maxThreshold) {
      reportError(t('manage.threshold.invalid', { max: maxThreshold }))
      return
    }

    await submitChange(
      'threshold',
      createAdminChange({
        changeType: ADM_CHANGE_THRESHOLD,
        targetGroupId: BigInt(groupId),
        groupName: '',
        memberAddr: ZERO_ADDRESS,
        memberType: 0n,
        memberLabel: '',
        threshold: BigInt(parsedThreshold),
        adminPrivileges: 0n,
        allowedActions: 0n,
        limitAssetId: 0n,
        dailyLimit: 0n,
        monthlyLimit: 0n,
        cooldownRounds: 0n,
        activeFlag: 1n,
      }),
      t('manage.threshold.created'),
    )
  }

  async function handlePolicyUpdate(e: React.FormEvent) {
    e.preventDefault()
    const parsedDailyLimit = parseBaseUnits(dailyLimit, selectedSpendingAsset.decimals)
    const parsedMonthlyLimit = parseBaseUnits(monthlyLimit, selectedSpendingAsset.decimals)
    if (!/^\d+$/.test(cooldownRounds || '0')) {
      reportError(t('manage.policy.cooldownInvalid'))
      return
    }
    const parsedCooldown = BigInt(cooldownRounds || '0')
    const limitAssetId = BigInt(selectedSpendingAsset.assetId ?? 0)

    if (parsedDailyLimit === null || parsedMonthlyLimit === null) {
      reportError(t('manage.policy.limitsInvalid', { symbol: selectedSpendingAsset.symbol }))
      return
    }

    const hasSpendingLimit = parsedDailyLimit > 0n || parsedMonthlyLimit > 0n
    if (hasSpendingLimit && limitAssetId === 0n && !allowAlgo) {
      reportError(t('manage.policy.enableAlgo'))
      return
    }

    if (hasSpendingLimit && limitAssetId !== 0n && !allowAsa) {
      reportError(t('manage.policy.enableAsa'))
      return
    }

    await submitChange(
      'policy',
      createAdminChange({
        changeType: ADM_SET_POLICY,
        targetGroupId: BigInt(groupId),
        groupName: '',
        memberAddr: ZERO_ADDRESS,
        memberType: 0n,
        memberLabel: '',
        threshold: 0n,
        adminPrivileges: 0n,
        allowedActions: actionMask,
        limitAssetId,
        dailyLimit: parsedDailyLimit,
        monthlyLimit: parsedMonthlyLimit,
        cooldownRounds: parsedCooldown,
        activeFlag: 1n,
      }),
      t('manage.policy.created'),
    )
  }

  async function handlePrivilegesUpdate(e: React.FormEvent) {
    e.preventDefault()
    await submitChange(
      'privileges',
      createAdminChange({
        changeType: ADM_SET_PRIVILEGES,
        targetGroupId: BigInt(groupId),
        groupName: '',
        memberAddr: ZERO_ADDRESS,
        memberType: 0n,
        memberLabel: '',
        threshold: 0n,
        adminPrivileges: adminMask,
        allowedActions: 0n,
        limitAssetId: 0n,
        dailyLimit: 0n,
        monthlyLimit: 0n,
        cooldownRounds: 0n,
        activeFlag: 1n,
      }),
      t('manage.admin.privilegesCreated'),
    )
  }

  async function handleActiveUpdate(e: React.FormEvent) {
    e.preventDefault()
    await submitChange(
      'status',
      createAdminChange({
        changeType: ADM_SET_ACTIVE,
        targetGroupId: BigInt(groupId),
        groupName: '',
        memberAddr: ZERO_ADDRESS,
        memberType: 0n,
        memberLabel: '',
        threshold: 0n,
        adminPrivileges: 0n,
        allowedActions: 0n,
        limitAssetId: 0n,
        dailyLimit: 0n,
        monthlyLimit: 0n,
        cooldownRounds: 0n,
        activeFlag: isActive ? 1n : 0n,
      }),
      t('manage.admin.statusCreated'),
    )
  }

  async function handleDissolveCustodian(e: React.FormEvent) {
    e.preventDefault()
    // Dissolution is proposed by the custodian group itself.
    setError(null)

    if (!safe) {
      reportError(t('shared.safeNotLoaded'))
      return
    }

    if (!canSubmit) {
      reportError(t('manage.dissolve.connectWallet'))
      return
    }

    try {
      setSubmittingSection('dissolve')

      const senderAddress = algosdk.Address.fromString(activeAddress!)
      const algorand = AlgorandClient.fromClients({ algod: algodClient }).setDefaultValidityWindow(TX_VALIDITY_WINDOW)
      algorand.setSigner(senderAddress, transactionSigner!)

      const clientVersion = await getAlgoSafeContractVersion(algodClient, BigInt(safe.appId))
      const appClient = algorand.client.getTypedAppClientById(getClient(clientVersion ?? 'latest'), {
        appId: BigInt(safe.appId),
        defaultSender: senderAddress,
      })

      const status = (await algodClient.status().do()) as unknown as Record<string, unknown>
      const expiryRound = getCurrentRound(status) + 2000n

      // The contract (v3.0.0+) requires the dissolve change to name the group's
      // last remaining member — its box is deleted together with the group box.
      const lastMember = detail?.members[0]?.address
      if (!lastMember || (detail?.group.memberCount ?? 0) !== 1) {
        reportError(t('manage.dissolve.needSingleMember'))
        setSubmittingSection(null)
        return
      }
      const change = createAdminChange({
        changeType: ADM_DISSOLVE_CUSTODIAN,
        targetGroupId: BigInt(groupId),
        memberAddr: lastMember,
      })

      const result = await appClient.send.proposeAdminChange({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        args: [BigInt(groupId), toAdminChangeTuple(change) as unknown as AdminChange, expiryRound, 0n] as any,
        maxFee: PROPOSAL_MAX_FEE,
        coverAppCallInnerTransactionFees: true,
        populateAppCallResources: true,
        suppressLog: true,
      })

      const proposalId = result.return?.toString() ?? ''
      const txId = result.txIds[0] ?? ''

      await queryClient.invalidateQueries({ queryKey: ['proposals', safeId] })
      await queryClient.invalidateQueries({ queryKey: ['proposal', safeId, proposalId] })
      await queryClient.invalidateQueries({ queryKey: ['signer-groups', safeId] })

      enqueueSnackbar(t('manage.dissolve.created'), { variant: 'success' })
      navigate(`/safe/${safeId}/proposals/${proposalId}`, { state: { txId } })
    } catch (submitError) {
      reportError(submitError instanceof Error ? submitError.message : t('manage.dissolve.failed'))
    } finally {
      setSubmittingSection(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-on-surface-variant">
          <Icon name="progress_activity" className="animate-spin text-lg" />
          <span>{t('manage.loading')}</span>
        </div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" className="px-0" onClick={() => navigate(`/safe/${safeId}`)}>
          <Icon name="arrow_back" className="text-base" />
          {t('shared.backToDashboard')}
        </Button>
        <Card className="px-6 py-8 text-center text-sm text-on-surface-variant">{t('manage.notFound')}</Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <nav className="mb-2 flex items-center gap-1 font-mono text-xs text-on-surface-variant">
            <span>{t('breadcrumb.treasury')}</span>
            <Icon name="chevron_right" className="text-sm" />
            <span>{t('breadcrumb.signerGroups')}</span>
            <Icon name="chevron_right" className="text-sm" />
            <span className="text-primary">{t('breadcrumb.manageGroup', { id: detail.group.id })}</span>
          </nav>
          <h1 className="text-3xl font-bold text-on-surface">{t('manage.title')}</h1>
          <p className="mt-1 text-sm text-on-surface-variant">{t('manage.subtitle')}</p>
        </div>
        <Button variant="secondary" onClick={() => navigate(`/safe/${safeId}`)}>
          <Icon name="arrow_back" className="text-base" />
          {t('shared.backToDashboard')}
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-md border border-error-container bg-error-container/30 px-4 py-3 text-sm text-on-error-container">
          <Icon name="error" className="text-base" />
          <span>{error}</span>
        </div>
      )}

      <Card>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold text-on-surface">{detail.group.name}</h2>
              {detail.group.isCustodian ? (
                <span className="rounded-sm bg-warn/15 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-warn">
                  {t('role.custodian')}
                </span>
              ) : (
                <span
                  className={`rounded-sm px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide ${detail.group.isAdminGroup ? 'bg-primary/15 text-primary' : 'bg-secondary-container/20 text-secondary'}`}
                >
                  {detail.group.isAdminGroup ? t('role.admin') : t('role.execution')}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-on-surface-variant">{t('manage.fixedNameNote')}</p>
          </div>

          <div className="w-full max-w-sm">
            <FormField label={t('shared.adminGroupLabel')} hint={t('manage.adminGroupHint')}>
              <select className={inputCls} value={selectedAdminGroupId} onChange={(event) => setSelectedAdminGroupId(event.target.value)}>
                {detail.adminGroupOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    #{option.id} {option.name}
                    {option.isMember ? t('manage.youAreMember') : ''}
                  </option>
                ))}
              </select>
            </FormField>
            {!detail.adminGroupOptions.length && <p className="mt-2 text-xs text-error">{t('shared.noAdminGroups')}</p>}
            {selectedAdminGroup && !selectedAdminGroup.isMember && <p className="mt-2 text-xs text-warn">{t('manage.mayReject')}</p>}
            {isFetching && (
              <div className="mt-2 flex items-center gap-2 text-xs text-on-surface-variant">
                <Icon name="progress_activity" className="animate-spin text-sm" />
                {t('manage.refreshing')}
              </div>
            )}
          </div>
        </div>
      </Card>

      {detail.group.isCustodian && (
        <div className="rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
          <Trans t={t} i18nKey="manage.custodianNotice" components={{ strong: <span className="font-semibold text-on-surface" /> }} />
          {detail.group.guardCount > 0 && (
            <span className="ml-2 font-mono text-[11px] text-warn">{t('manage.activeGuards', { count: detail.group.guardCount })}</span>
          )}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-on-surface">{t('manage.members.title')}</h2>
              <p className="text-sm text-on-surface-variant">{t('manage.members.desc')}</p>
            </div>
            <span className="rounded-sm bg-surface-container-high px-3 py-1 font-mono text-xs text-on-surface-variant">
              {t('manage.members.count', { count: detail.group.memberCount })}
            </span>
          </div>

          <div className="space-y-3">
            {currentMembers.map((member) => (
              <div key={member.address} className="rounded-md border border-outline-variant bg-surface-container-low px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-on-surface">{member.label || t('manage.members.defaultLabel')}</div>
                    <div className="mt-1">
                      <AddressDisplay address={member.address} textClassName="text-xs text-on-surface-variant" buttonClassName="h-5 w-5" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-sm bg-surface-container-high px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-on-surface-variant">
                      {accountTypeLabel(member.accountType, t)}
                    </span>
                    <button
                      type="button"
                      title={t('manage.members.removeTitle')}
                      aria-label={t('manage.members.removeAria', { who: member.label || member.address })}
                      className="flex h-7 w-7 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-error-container/40 hover:text-error disabled:opacity-40"
                      disabled={!canSubmit || submittingSection !== null || detail.group.memberCount <= detail.group.threshold}
                      onClick={() => handleRemoveMember(member.address)}
                    >
                      <Icon
                        name={submittingSection === `remove-${member.address}` ? 'progress_activity' : 'person_remove'}
                        className="text-base"
                      />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {detail.group.memberCount <= detail.group.threshold && detail.group.memberCount > 0 && (
              <p className="text-xs text-on-surface-variant">{t('manage.members.cannotRemove')}</p>
            )}
          </div>

          <form className="mt-5 space-y-4" onSubmit={handleAddMember}>
            <FormField label={t('manage.members.addressLabel')}>
              <input
                className={inputCls}
                value={memberAddress}
                onChange={(event) => setMemberAddress(event.target.value)}
                placeholder={t('shared.addressPlaceholder')}
              />
            </FormField>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label={t('shared.memberLabel')}>
                <input
                  className={inputCls}
                  value={memberLabel}
                  onChange={(event) => setMemberLabel(event.target.value)}
                  placeholder={t('manage.members.labelPlaceholder')}
                />
              </FormField>
              <FormField label={t('shared.accountType')}>
                <select className={inputCls} value={memberType} onChange={(event) => setMemberType(event.target.value)}>
                  {MEMBER_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
            <Button type="submit" disabled={!canSubmit || submittingSection !== null}>
              <Icon name="person_add" className="text-base" />
              {submittingSection === 'member' ? t('shared.creatingProposal') : t('manage.members.submitAdd')}
            </Button>
          </form>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-on-surface">{t('manage.threshold.title')}</h2>
          <p className="mt-1 text-sm text-on-surface-variant">{t('manage.threshold.desc')}</p>
          <form className="mt-5 space-y-4" onSubmit={handleThresholdUpdate}>
            <FormField label={t('manage.threshold.label')} hint={t('manage.threshold.hint', { max: maxThreshold })}>
              <input
                className={inputCls}
                type="number"
                min={1}
                max={maxThreshold}
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
              />
            </FormField>
            <Button type="submit" disabled={!canSubmit || submittingSection !== null}>
              <Icon name="rule" className="text-base" />
              {submittingSection === 'threshold' ? t('shared.creatingProposal') : t('manage.threshold.submit')}
            </Button>
          </form>
        </Card>

        {!detail.group.isCustodian && (
          <Card>
            <h2 className="text-lg font-semibold text-on-surface">{t('manage.policy.title')}</h2>
            <p className="mt-1 text-sm text-on-surface-variant">{t('manage.policy.desc')}</p>
            <form className="mt-5 space-y-4" onSubmit={handlePolicyUpdate}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface">
                  <input type="checkbox" checked={allowAlgo} onChange={(event) => setAllowAlgo(event.target.checked)} />
                  {t('shared.allowAlgo')}
                </label>
                <label className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface">
                  <input type="checkbox" checked={allowAsa} onChange={(event) => setAllowAsa(event.target.checked)} />
                  {t('shared.allowAsa')}
                </label>
                <label className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface">
                  <input type="checkbox" checked={allowApp} onChange={(event) => setAllowApp(event.target.checked)} />
                  {t('shared.allowApp')}
                </label>
                <label className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface">
                  <input type="checkbox" checked={allowKeyreg} onChange={(event) => setAllowKeyreg(event.target.checked)} />
                  {t('shared.allowKeyreg')}
                </label>
                <label className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface">
                  <input type="checkbox" checked={allowAcfg} onChange={(event) => setAllowAcfg(event.target.checked)} />
                  {t('shared.allowAcfg')}
                </label>
                <label className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface">
                  <input type="checkbox" checked={allowRekey} onChange={(event) => setAllowRekey(event.target.checked)} />
                  <span>
                    {t('shared.allowRekey')}
                    <span className="mt-0.5 block text-xs text-on-surface-variant">{t('manage.policy.rekeyHint')}</span>
                  </span>
                </label>
              </div>
              <FormField label={t('manage.policy.assetLabel')} hint={t('manage.policy.assetHint')}>
                <select
                  className={inputCls}
                  value={spendingLimitAssetKey}
                  onChange={(event) => setSpendingLimitAssetKey(event.target.value)}
                >
                  {spendingLimitAssets.map((asset) => (
                    <option key={asset.key} value={asset.key}>
                      {asset.symbol}
                      {asset.name ? ` · ${asset.name}` : ''}
                      {asset.assetId && asset.assetId !== 0 ? ` · ${asset.assetId}` : ''}
                      {` · ${t('manage.policy.optionAvailable', { balance: asset.balanceDisplay })}`}
                    </option>
                  ))}
                </select>
              </FormField>
              <div className="grid gap-4 md:grid-cols-3">
                <FormField
                  label={t('manage.policy.dailyLabel', { symbol: selectedSpendingAsset.symbol })}
                  hint={t('manage.policy.limitHint', { symbol: selectedSpendingAsset.symbol })}
                >
                  <input className={inputCls} value={dailyLimit} onChange={(event) => setDailyLimit(event.target.value)} />
                </FormField>
                <FormField
                  label={t('manage.policy.monthlyLabel', { symbol: selectedSpendingAsset.symbol })}
                  hint={t('manage.policy.limitHint', { symbol: selectedSpendingAsset.symbol })}
                >
                  <input className={inputCls} value={monthlyLimit} onChange={(event) => setMonthlyLimit(event.target.value)} />
                </FormField>
                <FormField label={t('manage.policy.cooldownLabel')} hint={t('manage.policy.cooldownHint')}>
                  <input
                    className={inputCls}
                    type="number"
                    min={0}
                    value={cooldownRounds}
                    onChange={(event) => setCooldownRounds(event.target.value)}
                  />
                </FormField>
              </div>
              <Button type="submit" disabled={!canSubmit || submittingSection !== null}>
                <Icon name="tune" className="text-base" />
                {submittingSection === 'policy' ? t('shared.creatingProposal') : t('manage.policy.submit')}
              </Button>
            </form>
          </Card>
        )}

        {!detail.group.isCustodian && (
          <Card>
            <h2 className="text-lg font-semibold text-on-surface">{t('manage.admin.title')}</h2>
            <p className="mt-1 text-sm text-on-surface-variant">{t('manage.admin.desc')}</p>

            <form className="mt-5 space-y-4" onSubmit={handlePrivilegesUpdate}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface">
                  <input type="checkbox" checked={groupAdmin} onChange={(event) => setGroupAdmin(event.target.checked)} />
                  {t('manage.admin.groupAdmin')}
                </label>
                <label className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface">
                  <input type="checkbox" checked={policyAdmin} onChange={(event) => setPolicyAdmin(event.target.checked)} />
                  {t('manage.admin.policyAdmin')}
                </label>
              </div>
              <Button type="submit" disabled={!canSubmit || submittingSection !== null}>
                <Icon name="admin_panel_settings" className="text-base" />
                {submittingSection === 'privileges' ? t('shared.creatingProposal') : t('manage.admin.submitPrivileges')}
              </Button>
            </form>

            <form className="mt-6 space-y-4 border-t border-outline-variant pt-6" onSubmit={handleActiveUpdate}>
              <label className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface">
                <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
                {t('manage.admin.activeLabel')}
              </label>
              <Button type="submit" disabled={!canSubmit || submittingSection !== null}>
                <Icon name={isActive ? 'toggle_on' : 'toggle_off'} className="text-base" />
                {submittingSection === 'status' ? t('shared.creatingProposal') : t('manage.admin.submitStatus')}
              </Button>
            </form>
          </Card>
        )}

        {detail.group.isCustodian && (
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-on-surface">{t('manage.guards.title')}</h2>
                <p className="text-sm text-on-surface-variant">{t('manage.guards.desc')}</p>
              </div>
              <span className="rounded-sm bg-surface-container-high px-3 py-1 font-mono text-xs text-on-surface-variant">
                {t('manage.guards.count', { count: detail.group.guardCount })}
              </span>
            </div>

            <div className="space-y-3">
              {(assetGuards ?? []).map((guard) => {
                const meta = guardAssetMetadata(guard.assetId)
                return (
                  <div
                    key={guard.assetId.toString()}
                    className="flex items-center justify-between gap-3 rounded-md border border-outline-variant bg-surface-container-low px-4 py-3"
                  >
                    <div>
                      <div className="text-sm font-semibold text-on-surface">
                        {meta.symbol}
                        {guard.assetId !== 0n && (
                          <span className="ml-2 font-mono text-xs text-on-surface-variant">ASA {guard.assetId.toString()}</span>
                        )}
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-on-surface-variant">
                        {t('manage.guards.remaining', { amount: formatUnits(guard.lockedAmount, meta.decimals), symbol: meta.symbol })}
                      </div>
                    </div>
                    <button
                      type="button"
                      title={t('manage.guards.removeTitle')}
                      aria-label={t('manage.guards.removeAria', { symbol: meta.symbol })}
                      className="flex h-7 w-7 items-center justify-center rounded text-on-surface-variant transition-colors hover:bg-error-container/40 hover:text-error disabled:opacity-40"
                      disabled={!canSubmit || submittingSection !== null}
                      onClick={() => handleRemoveGuard(guard.assetId)}
                    >
                      <Icon
                        name={submittingSection === `remove-guard-${guard.assetId}` ? 'progress_activity' : 'delete'}
                        className="text-base"
                      />
                    </button>
                  </div>
                )
              })}
              {(assetGuards ?? []).length === 0 && (
                <p className="rounded-md border border-outline-variant bg-surface-container-lowest px-4 py-3 text-sm text-on-surface-variant">
                  {t('manage.guards.empty')}
                </p>
              )}
            </div>

            <form className="mt-5 space-y-4 border-t border-outline-variant pt-5" onSubmit={handleSetGuard}>
              <div className="grid gap-4 md:grid-cols-2">
                <FormField label={t('manage.guards.assetLabel')} hint={t('manage.guards.assetHint')}>
                  <select className={inputCls} value={guardAssetKey} onChange={(event) => setGuardAssetKey(event.target.value)}>
                    {spendingLimitAssets.map((asset) => (
                      <option key={asset.key} value={asset.key}>
                        {asset.symbol}
                        {asset.assetId && asset.assetId !== 0 ? ` · ${asset.assetId}` : ''}
                        {` · ${t('manage.policy.optionAvailable', { balance: asset.balanceDisplay })}`}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label={t('manage.guards.amountLabel')} hint={t('manage.guards.amountHint')}>
                  <input
                    className={inputCls}
                    value={guardAmount}
                    onChange={(event) => setGuardAmount(event.target.value)}
                    inputMode="decimal"
                  />
                </FormField>
              </div>
              <Button type="submit" disabled={!canSubmit || submittingSection !== null}>
                <Icon name="shield" className="text-base" />
                {submittingSection === 'set-guard' ? t('shared.creatingProposal') : t('manage.guards.submit')}
              </Button>
            </form>
          </Card>
        )}

        {detail.group.isCustodian && (
          <Card>
            <h2 className="text-lg font-semibold text-on-surface">{t('manage.dissolve.title')}</h2>
            <p className="mt-1 text-sm text-on-surface-variant">{t('manage.dissolve.desc')}</p>
            <form className="mt-5 space-y-4" onSubmit={handleDissolveCustodian}>
              {detail.group.guardCount > 0 && (
                <div className="rounded-md border border-error-container bg-error-container/30 px-4 py-3 text-sm text-on-error-container">
                  {t('manage.dissolve.guardsWarning', { count: detail.group.guardCount })}
                </div>
              )}
              {detail.group.memberCount > 1 && (
                <div className="rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
                  {t('manage.dissolve.membersWarning', { count: detail.group.memberCount })}
                </div>
              )}
              <Button
                type="submit"
                variant="secondary"
                disabled={!canSubmit || submittingSection !== null || detail.group.guardCount > 0 || detail.group.memberCount !== 1}
              >
                <Icon name="delete_forever" className="text-base" />
                {submittingSection === 'dissolve' ? t('shared.creatingProposal') : t('manage.dissolve.submit')}
              </Button>
            </form>
          </Card>
        )}
      </div>
    </div>
  )
}
