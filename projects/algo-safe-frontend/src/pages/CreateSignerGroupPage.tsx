import { useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@txnlab/use-wallet-react'
import { ACT_ACFG, ACT_APPL, ACT_AXFER, ACT_KEYREG, ACT_PAY, ACT_REKEY, PRIV_GROUP, PRIV_POLICY } from 'algo-safe'
import { useSnackbar } from 'notistack'
import { useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { FormField, inputCls } from '../components/ui/FormField'
import { Icon } from '../components/ui/Icon'
import { useSafe, useSignerGroups } from '../hooks'
import { useSafeId } from '../lib/SafeContext'
import { proposeCreateSignerGroup } from '../services/algoSafeGovernance'

const MEMBER_TYPE_OPTIONS = [
  { value: 1, labelKey: 'memberTypes.standard' },
  { value: 2, labelKey: 'memberTypes.multisig' },
  { value: 3, labelKey: 'memberTypes.rekeyed' },
  { value: 4, labelKey: 'memberTypes.agent' },
  { value: 5, labelKey: 'memberTypes.quantum' },
]

type GroupKind = 'standard' | 'custodian'

export function CreateSignerGroupPage() {
  const { t } = useTranslation('signers')
  const safeId = useSafeId()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const { data: safe } = useSafe(safeId)
  const { data: signerGroups } = useSignerGroups()
  const { activeAddress, algodClient, transactionSigner, isReady } = useWallet()

  const [kind, setKind] = useState<GroupKind>('standard')
  const [name, setName] = useState('')
  const [memberAddress, setMemberAddress] = useState('')
  const [memberLabel, setMemberLabel] = useState('')
  const [memberType, setMemberType] = useState('1')
  const [selectedAdminGroupId, setSelectedAdminGroupId] = useState('')
  const [allowAlgo, setAllowAlgo] = useState(true)
  const [allowAsa, setAllowAsa] = useState(true)
  const [allowApp, setAllowApp] = useState(false)
  const [allowKeyreg, setAllowKeyreg] = useState(false)
  const [allowAcfg, setAllowAcfg] = useState(false)
  const [allowRekey, setAllowRekey] = useState(false)
  const [groupAdmin, setGroupAdmin] = useState(false)
  const [policyAdmin, setPolicyAdmin] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const adminGroups = useMemo(() => (signerGroups ?? []).filter((group) => group.isAdminGroup && group.active), [signerGroups])
  const effectiveAdminGroupId = selectedAdminGroupId || adminGroups[0]?.id || ''

  const isCustodian = kind === 'custodian'
  const canSubmit = !!safe && !!isReady && !!activeAddress && !!transactionSigner && !!effectiveAdminGroupId

  const actionMask = useMemo(() => {
    if (isCustodian) {
      // Custodians are contract-restricted to pay/axfer.
      let mask = 0n
      if (allowAlgo) mask |= ACT_PAY
      if (allowAsa) mask |= ACT_AXFER
      return mask
    }
    let mask = 0n
    if (allowAlgo) mask |= ACT_PAY
    if (allowAsa) mask |= ACT_AXFER
    if (allowApp) mask |= ACT_APPL
    if (allowKeyreg) mask |= ACT_KEYREG
    if (allowAcfg) mask |= ACT_ACFG
    if (allowRekey) mask |= ACT_REKEY
    return mask
  }, [isCustodian, allowAlgo, allowAsa, allowApp, allowKeyreg, allowAcfg, allowRekey])

  const adminMask = useMemo(() => {
    if (isCustodian) return 0n
    let mask = 0n
    if (groupAdmin) mask |= PRIV_GROUP
    if (policyAdmin) mask |= PRIV_POLICY
    return mask
  }, [isCustodian, groupAdmin, policyAdmin])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) {
      setError(t('create.errors.nameRequired'))
      return
    }
    if (!safe || !effectiveAdminGroupId) {
      setError(t('create.errors.noAdminGroup'))
      return
    }

    try {
      setSubmitting(true)
      const { proposalId, txId } = await proposeCreateSignerGroup(
        { algodClient, safe, activeAddress, transactionSigner },
        {
          adminGroupId: BigInt(effectiveAdminGroupId),
          name,
          memberAddress,
          memberLabel,
          memberType: BigInt(memberType),
          isCustodian,
          allowedActions: actionMask,
          adminPrivileges: adminMask,
        },
      )
      await queryClient.invalidateQueries({ queryKey: ['proposals', safeId] })
      await queryClient.invalidateQueries({ queryKey: ['signer-groups', safeId] })
      enqueueSnackbar(t('create.created'), { variant: 'success' })
      navigate(`/safe/${safeId}/proposals/${proposalId}`, { state: { txId } })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t('create.errors.failed'))
    } finally {
      setSubmitting(false)
    }
  }

  const actionCheckbox = (checked: boolean, onChange: (value: boolean) => void, label: string, hint?: string) => (
    <label className="flex items-start gap-3 rounded-md border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        {label}
        {hint && <span className="mt-0.5 block text-xs text-on-surface-variant">{hint}</span>}
      </span>
    </label>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <nav className="mb-2 flex items-center gap-1 font-mono text-xs text-on-surface-variant">
            <span>{t('breadcrumb.treasury')}</span>
            <Icon name="chevron_right" className="text-sm" />
            <span>{t('breadcrumb.signerGroups')}</span>
            <Icon name="chevron_right" className="text-sm" />
            <span className="text-primary">{t('breadcrumb.createGroup')}</span>
          </nav>
          <h1 className="text-3xl font-bold text-on-surface">{t('create.title')}</h1>
          <p className="mt-1 text-sm text-on-surface-variant">{t('create.subtitle')}</p>
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

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <h2 className="text-lg font-semibold text-on-surface">{t('create.groupType.title')}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setKind('standard')}
              className={`rounded-md border px-4 py-3 text-left transition-colors ${
                kind === 'standard'
                  ? 'border-primary bg-primary/10'
                  : 'border-outline-variant bg-surface-container-low hover:border-primary/40'
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-on-surface">
                <Icon name="group" className="text-base" />
                {t('create.groupType.standard')}
              </div>
              <p className="mt-1 text-xs text-on-surface-variant">{t('create.groupType.standardDesc')}</p>
            </button>
            <button
              type="button"
              onClick={() => setKind('custodian')}
              className={`rounded-md border px-4 py-3 text-left transition-colors ${
                kind === 'custodian' ? 'border-warn bg-warn/10' : 'border-outline-variant bg-surface-container-low hover:border-warn/40'
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-on-surface">
                <Icon name="account_balance" className="text-base" />
                {t('create.groupType.custodian')}
              </div>
              <p className="mt-1 text-xs text-on-surface-variant">{t('create.groupType.custodianDesc')}</p>
            </button>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-on-surface">{t('create.identity.title')}</h2>
          <div className="mt-4 space-y-4">
            <FormField label={t('create.identity.nameLabel')} hint={t('create.identity.nameHint')}>
              <input
                className={inputCls}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('create.identity.namePlaceholder')}
              />
            </FormField>
            <FormField label={t('create.identity.firstMemberLabel')} hint={t('create.identity.firstMemberHint')}>
              <input
                className={`${inputCls} font-mono`}
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
                  placeholder={t('create.identity.labelPlaceholder')}
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
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-on-surface">{t('create.actions.title')}</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            {isCustodian ? t('create.actions.custodianDesc') : t('create.actions.standardDesc')}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {actionCheckbox(allowAlgo, setAllowAlgo, t('shared.allowAlgo'))}
            {actionCheckbox(allowAsa, setAllowAsa, t('shared.allowAsa'))}
            {!isCustodian && actionCheckbox(allowApp, setAllowApp, t('shared.allowApp'))}
            {!isCustodian && actionCheckbox(allowKeyreg, setAllowKeyreg, t('shared.allowKeyreg'))}
            {!isCustodian && actionCheckbox(allowAcfg, setAllowAcfg, t('shared.allowAcfg'))}
            {!isCustodian && actionCheckbox(allowRekey, setAllowRekey, t('shared.allowRekey'), t('create.actions.rekeyHint'))}
          </div>
        </Card>

        {!isCustodian && (
          <Card>
            <h2 className="text-lg font-semibold text-on-surface">{t('create.privileges.title')}</h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              <Trans t={t} i18nKey="create.privileges.desc" components={{ em: <em /> }} />
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {actionCheckbox(groupAdmin, setGroupAdmin, t('create.privileges.groupAdmin'), t('create.privileges.groupAdminHint'))}
              {actionCheckbox(policyAdmin, setPolicyAdmin, t('create.privileges.policyAdmin'), t('create.privileges.policyAdminHint'))}
            </div>
          </Card>
        )}

        <Card>
          <FormField label={t('shared.adminGroupLabel')} hint={t('create.adminGroupHint')}>
            <select className={inputCls} value={effectiveAdminGroupId} onChange={(event) => setSelectedAdminGroupId(event.target.value)}>
              {adminGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  #{group.id} {group.name}
                </option>
              ))}
            </select>
          </FormField>
          {!adminGroups.length && <p className="mt-2 text-xs text-error">{t('shared.noAdminGroups')}</p>}
        </Card>

        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="ghost" onClick={() => navigate(`/safe/${safeId}`)}>
            {t('shared.cancel')}
          </Button>
          <Button type="submit" disabled={!canSubmit || submitting}>
            <Icon name="send" className="text-base" />
            {submitting ? t('shared.submitting') : t('create.submit')}
          </Button>
        </div>
      </form>
    </div>
  )
}
