import { algo, AlgorandClient } from '@algorandfoundation/algokit-utils'
import { useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@txnlab/use-wallet-react'
import { createAdminChange, getAlgoSafeContractVersion, getClient, type AdminChange } from 'algo-safe'
import algosdk from 'algosdk'
import { useSnackbar } from 'notistack'
import { useEffect, useMemo, useState } from 'react'
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
import type { AssetSymbol } from '../services/types'

const TX_VALIDITY_WINDOW = 200
const PROPOSAL_CALL_FEE = algo(0.2)
const ADM_ADD_MEMBER = 2n
const ADM_CHANGE_THRESHOLD = 4n
const ADM_SET_POLICY = 5n
const ADM_SET_PRIVILEGES = 6n
const ADM_SET_ACTIVE = 7n

const ACT_PAY = 1
const ACT_AXFER = 2
const ACT_APPL = 4
const ACT_KEYREG = 8
const PRIV_GROUP = 1
const PRIV_POLICY = 2

const MEMBER_TYPE_OPTIONS = [
  { value: 1, label: 'Standard account' },
  { value: 2, label: 'Multisig account' },
  { value: 3, label: 'Rekeyed account' },
  { value: 4, label: 'Agent account' },
  { value: 5, label: 'Quantum account' },
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

type AdminChangeTuple = [bigint, bigint, string, string, bigint, string, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]

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

function accountTypeLabel(accountType: number) {
  return MEMBER_TYPE_OPTIONS.find((option) => option.value === accountType)?.label ?? `Type ${accountType}`
}

function flagSet(mask: number, flag: number) {
  return (mask & flag) !== 0
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
  ]
}

export function SignerGroupManagementPage() {
  const safeId = useSafeId()
  const { groupId = '' } = useParams<{ groupId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const { data: safe } = useSafe(safeId)
  const { data: detail, isLoading, isFetching } = useSignerGroup(groupId)
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
  const [groupAdmin, setGroupAdmin] = useState(false)
  const [policyAdmin, setPolicyAdmin] = useState(false)
  const [isActive, setIsActive] = useState(true)
  const [submittingSection, setSubmittingSection] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const knownAssets = useMemo(() => getKnownAssets(safe?.network), [safe?.network])

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
        balanceDisplay: 'not held',
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
          balanceDisplay: 'not held',
          isNative: trackedAsset.isNative,
        })
      }
    }

    return Array.from(assetMap.values()).sort((left, right) => {
      if (left.isNative !== right.isNative) return left.isNative ? -1 : 1
      return left.symbol.localeCompare(right.symbol) || (left.assetId ?? 0) - (right.assetId ?? 0)
    })
  }, [detail, holdings, knownAssets])

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
    let mask = 0
    if (allowAlgo) mask |= ACT_PAY
    if (allowAsa) mask |= ACT_AXFER
    if (allowApp) mask |= ACT_APPL
    if (allowKeyreg) mask |= ACT_KEYREG
    return mask
  }, [allowAlgo, allowApp, allowAsa, allowKeyreg])
  const adminMask = useMemo(() => {
    let mask = 0
    if (groupAdmin) mask |= PRIV_GROUP
    if (policyAdmin) mask |= PRIV_POLICY
    return mask
  }, [groupAdmin, policyAdmin])

  async function submitChange(section: string, change: AdminChange, successMessage: string) {
    setError(null)

    if (!safe) {
      setError('The selected safe could not be loaded.')
      return
    }

    if (!canSubmit) {
      setError('Connect a wallet with access to an admin signer group before managing this signer group.')
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
        args: [BigInt(selectedAdminGroupId), toAdminChangeTuple(change) as unknown as AdminChange, expiryRound],
        staticFee: PROPOSAL_CALL_FEE,
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
      setError(submitError instanceof Error ? submitError.message : 'Failed to create signer-group update proposal.')
    } finally {
      setSubmittingSection(null)
    }
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault()

    if (!algosdk.isValidAddress(memberAddress.trim())) {
      setError('Enter a valid Algorand address for the member.')
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
      'Member addition proposal created',
    )
  }

  async function handleThresholdUpdate(e: React.FormEvent) {
    e.preventDefault()
    const parsedThreshold = Number(threshold)

    if (!Number.isInteger(parsedThreshold) || parsedThreshold < 1 || parsedThreshold > maxThreshold) {
      setError(`Threshold must be between 1 and ${maxThreshold}.`)
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
      'Threshold update proposal created',
    )
  }

  async function handlePolicyUpdate(e: React.FormEvent) {
    e.preventDefault()
    const parsedDailyLimit = parseBaseUnits(dailyLimit, selectedSpendingAsset.decimals)
    const parsedMonthlyLimit = parseBaseUnits(monthlyLimit, selectedSpendingAsset.decimals)
    if (!/^\d+$/.test(cooldownRounds || '0')) {
      setError('Cooldown rounds must be a non-negative integer.')
      return
    }
    const parsedCooldown = BigInt(cooldownRounds || '0')
    const limitAssetId = BigInt(selectedSpendingAsset.assetId ?? 0)

    if (parsedDailyLimit === null || parsedMonthlyLimit === null) {
      setError(`Enter valid ${selectedSpendingAsset.symbol} limits for the signer group policy.`)
      return
    }

    const hasSpendingLimit = parsedDailyLimit > 0n || parsedMonthlyLimit > 0n
    if (hasSpendingLimit && limitAssetId === 0n && !allowAlgo) {
      setError('Enable ALGO payments when the spending limit asset is ALGO.')
      return
    }

    if (hasSpendingLimit && limitAssetId !== 0n && !allowAsa) {
      setError('Enable ASA transfers when the spending limit asset is an ASA.')
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
        allowedActions: BigInt(actionMask),
        limitAssetId,
        dailyLimit: parsedDailyLimit,
        monthlyLimit: parsedMonthlyLimit,
        cooldownRounds: parsedCooldown,
        activeFlag: 1n,
      }),
      'Policy update proposal created',
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
        adminPrivileges: BigInt(adminMask),
        allowedActions: 0n,
        limitAssetId: 0n,
        dailyLimit: 0n,
        monthlyLimit: 0n,
        cooldownRounds: 0n,
        activeFlag: 1n,
      }),
      'Admin privileges proposal created',
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
      'Signer-group status proposal created',
    )
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-on-surface-variant">
          <Icon name="progress_activity" className="animate-spin text-lg" />
          <span>Loading signer-group settings from the blockchain…</span>
        </div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" className="px-0" onClick={() => navigate(`/safe/${safeId}`)}>
          <Icon name="arrow_back" className="text-base" />
          Back to Dashboard
        </Button>
        <Card className="px-6 py-8 text-center text-sm text-on-surface-variant">The selected signer group was not found.</Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <nav className="mb-2 flex items-center gap-1 font-mono text-xs text-on-surface-variant">
            <span>Treasury</span>
            <Icon name="chevron_right" className="text-sm" />
            <span>Signer Groups</span>
            <Icon name="chevron_right" className="text-sm" />
            <span className="text-primary">Manage Group #{detail.group.id}</span>
          </nav>
          <h1 className="text-3xl font-bold text-on-surface">Manage Signer Group</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Update membership, thresholds, policy controls, and admin permissions through governance proposals.
          </p>
        </div>
        <Button variant="secondary" onClick={() => navigate(`/safe/${safeId}`)}>
          <Icon name="arrow_back" className="text-base" />
          Back to Dashboard
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
              <span
                className={`rounded-sm px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide ${detail.group.isAdminGroup ? 'bg-primary/15 text-primary' : 'bg-secondary-container/20 text-secondary'}`}
              >
                {detail.group.isAdminGroup ? 'Admin' : 'Execution'}
              </span>
            </div>
            <p className="mt-1 text-sm text-on-surface-variant">
              Group names are fixed at creation time. All other supported properties can be updated via proposals from an admin signer
              group.
            </p>
          </div>

          <div className="w-full max-w-sm">
            <FormField
              label="Submitting Admin Signer Group"
              hint="The connected account must be a member of the selected admin group to submit the proposal."
            >
              <select className={inputCls} value={selectedAdminGroupId} onChange={(event) => setSelectedAdminGroupId(event.target.value)}>
                {detail.adminGroupOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    #{option.id} {option.name}
                    {option.isMember ? ' · you are a member' : ''}
                  </option>
                ))}
              </select>
            </FormField>
            {!detail.adminGroupOptions.length && (
              <p className="mt-2 text-xs text-error">No active admin signer groups were found for this safe.</p>
            )}
            {selectedAdminGroup && !selectedAdminGroup.isMember && (
              <p className="mt-2 text-xs text-warn">
                The selected admin group may reject this proposal if the connected wallet is not a member.
              </p>
            )}
            {isFetching && (
              <div className="mt-2 flex items-center gap-2 text-xs text-on-surface-variant">
                <Icon name="progress_activity" className="animate-spin text-sm" />
                Refreshing group state…
              </div>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-on-surface">Members</h2>
              <p className="text-sm text-on-surface-variant">Current signer accounts and labels recorded in the group boxes.</p>
            </div>
            <span className="rounded-sm bg-surface-container-high px-3 py-1 font-mono text-xs text-on-surface-variant">
              {detail.group.memberCount} member{detail.group.memberCount === 1 ? '' : 's'}
            </span>
          </div>

          <div className="space-y-3">
            {currentMembers.map((member) => (
              <div key={member.address} className="rounded-md border border-outline-variant bg-surface-container-low px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-on-surface">{member.label || 'Member'}</div>
                    <div className="mt-1">
                      <AddressDisplay address={member.address} textClassName="text-xs text-on-surface-variant" buttonClassName="h-5 w-5" />
                    </div>
                  </div>
                  <span className="rounded-sm bg-surface-container-high px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-on-surface-variant">
                    {accountTypeLabel(member.accountType)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <form className="mt-5 space-y-4" onSubmit={handleAddMember}>
            <FormField label="Member Address">
              <input
                className={inputCls}
                value={memberAddress}
                onChange={(event) => setMemberAddress(event.target.value)}
                placeholder="Algorand address"
              />
            </FormField>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Member Label">
                <input
                  className={inputCls}
                  value={memberLabel}
                  onChange={(event) => setMemberLabel(event.target.value)}
                  placeholder="Treasury signer"
                />
              </FormField>
              <FormField label="Account Type">
                <select className={inputCls} value={memberType} onChange={(event) => setMemberType(event.target.value)}>
                  {MEMBER_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
            <Button type="submit" disabled={!canSubmit || submittingSection !== null}>
              <Icon name="person_add" className="text-base" />
              {submittingSection === 'member' ? 'Creating Proposal…' : 'Propose Member Addition'}
            </Button>
          </form>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-on-surface">Signing Threshold</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Change how many signatures are required before this group can approve execution.
          </p>
          <form className="mt-5 space-y-4" onSubmit={handleThresholdUpdate}>
            <FormField label="Threshold" hint={`Current members available: ${maxThreshold}`}>
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
              {submittingSection === 'threshold' ? 'Creating Proposal…' : 'Propose Threshold Update'}
            </Button>
          </form>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-on-surface">Execution Policy</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Update allowed actions, asset-based limits, and cooldown rounds for the signer group.
          </p>
          <form className="mt-5 space-y-4" onSubmit={handlePolicyUpdate}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface">
                <input type="checkbox" checked={allowAlgo} onChange={(event) => setAllowAlgo(event.target.checked)} />
                Allow ALGO payments
              </label>
              <label className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface">
                <input type="checkbox" checked={allowAsa} onChange={(event) => setAllowAsa(event.target.checked)} />
                Allow ASA transfers
              </label>
              <label className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface">
                <input type="checkbox" checked={allowApp} onChange={(event) => setAllowApp(event.target.checked)} />
                Allow app calls
              </label>
              <label className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface">
                <input type="checkbox" checked={allowKeyreg} onChange={(event) => setAllowKeyreg(event.target.checked)} />
                Allow key registration
              </label>
            </div>
            <FormField
              label="Spending Limit Asset"
              hint="The selected asset controls how the daily and monthly limit fields are interpreted and labeled."
            >
              <select className={inputCls} value={spendingLimitAssetKey} onChange={(event) => setSpendingLimitAssetKey(event.target.value)}>
                {spendingLimitAssets.map((asset) => (
                  <option key={asset.key} value={asset.key}>
                    {asset.symbol}
                    {asset.name ? ` · ${asset.name}` : ''}
                    {asset.assetId && asset.assetId !== 0 ? ` · ${asset.assetId}` : ''}
                    {` · Available ${asset.balanceDisplay}`}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="grid gap-4 md:grid-cols-3">
              <FormField
                label={`Daily Limit (${selectedSpendingAsset.symbol})`}
                hint={`Use 0 for no limit in ${selectedSpendingAsset.symbol}.`}
              >
                <input className={inputCls} value={dailyLimit} onChange={(event) => setDailyLimit(event.target.value)} />
              </FormField>
              <FormField
                label={`Monthly Limit (${selectedSpendingAsset.symbol})`}
                hint={`Use 0 for no limit in ${selectedSpendingAsset.symbol}.`}
              >
                <input className={inputCls} value={monthlyLimit} onChange={(event) => setMonthlyLimit(event.target.value)} />
              </FormField>
              <FormField label="Cooldown Rounds" hint="Use 0 for no cooldown.">
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
              {submittingSection === 'policy' ? 'Creating Proposal…' : 'Propose Policy Update'}
            </Button>
          </form>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-on-surface">Admin Controls</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Grant or revoke governance privileges and enable or disable the signer group.
          </p>

          <form className="mt-5 space-y-4" onSubmit={handlePrivilegesUpdate}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface">
                <input type="checkbox" checked={groupAdmin} onChange={(event) => setGroupAdmin(event.target.checked)} />
                Group admin privileges
              </label>
              <label className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface">
                <input type="checkbox" checked={policyAdmin} onChange={(event) => setPolicyAdmin(event.target.checked)} />
                Policy admin privileges
              </label>
            </div>
            <Button type="submit" disabled={!canSubmit || submittingSection !== null}>
              <Icon name="admin_panel_settings" className="text-base" />
              {submittingSection === 'privileges' ? 'Creating Proposal…' : 'Propose Privilege Update'}
            </Button>
          </form>

          <form className="mt-6 space-y-4 border-t border-outline-variant pt-6" onSubmit={handleActiveUpdate}>
            <label className="flex items-center gap-3 rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface">
              <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
              Group is active and can participate in proposal approvals and execution.
            </label>
            <Button type="submit" disabled={!canSubmit || submittingSection !== null}>
              <Icon name={isActive ? 'toggle_on' : 'toggle_off'} className="text-base" />
              {submittingSection === 'status' ? 'Creating Proposal…' : 'Propose Status Update'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  )
}
