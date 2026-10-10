import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { formatUnits } from '../lib/onChainSafe'
import { useSafeId } from '../lib/SafeContext'
import type { LiveSignerGroup } from '../services/algoSafeGroups'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Icon } from './ui/Icon'

const ACT_PAY = 1
const ACT_AXFER = 2
const ACT_APPL = 4
const ACT_KEYREG = 8

function getActionLabels(allowedActions: number, t: TFunction<'signers'>) {
  const labels: string[] = []
  if ((allowedActions & ACT_PAY) !== 0) labels.push('ALGO')
  if ((allowedActions & ACT_AXFER) !== 0) labels.push('ASA')
  if ((allowedActions & ACT_APPL) !== 0) labels.push(t('card.actionApp'))
  if ((allowedActions & ACT_KEYREG) !== 0) labels.push(t('card.actionKeyreg'))
  return labels.length > 0 ? labels : [t('card.none')]
}

function getLimitAssetLabel(group: LiveSignerGroup) {
  return group.limitAsset.symbol || (group.limitAssetId === 0n ? 'ALGO' : `ASA ${group.limitAssetId.toString()}`)
}

function formatAssetScopedAmount(amount: bigint, group: LiveSignerGroup) {
  return `${formatUnits(amount, group.limitAsset.decimals)} ${getLimitAssetLabel(group)}`
}

function formatLimit(limit: bigint, group: LiveSignerGroup, t: TFunction<'signers'>) {
  return limit === 0n ? t('card.noLimit') : `${formatAssetScopedAmount(limit, group)} · ${getLimitAssetLabel(group)}`
}

export function SignerGroupCard({ group }: { group: LiveSignerGroup }) {
  const { t } = useTranslation('signers')
  const navigate = useNavigate()
  const safeId = useSafeId()
  const allowedActions = getActionLabels(group.allowedActions, t)
  const usagePercent = group.dailyLimit === 0n ? 0 : Math.min(100, Math.round(Number((group.dailyUsage * 100n) / group.dailyLimit)))

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-on-surface">{group.name}</span>
            <span
              className={`rounded-sm px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide ${group.isAdminGroup ? 'bg-primary/15 text-primary' : 'bg-secondary-container/20 text-secondary'}`}
            >
              {group.isAdminGroup ? t('role.admin') : t('role.execution')}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-on-surface-variant">
            {t('card.groupSummary', { id: group.id, threshold: group.threshold, count: group.memberCount })}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide ${group.active ? 'bg-primary/15 text-primary' : 'bg-surface-container-high text-on-surface-variant'}`}
        >
          <Icon name={group.active ? 'check_circle' : 'pause_circle'} className="text-sm" />
          {group.active ? t('status.active') : t('status.disabled')}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <div className="flex justify-between font-mono text-xs uppercase text-on-surface-variant">
            <span>{t('card.dailyUsage', { asset: getLimitAssetLabel(group) })}</span>
            <span>{group.dailyLimit === 0n ? t('card.unlimited') : `${usagePercent}%`}</span>
          </div>
          <div className="mt-1 h-2 w-full rounded-full bg-surface-container-lowest">
            <div className="h-2 rounded-full bg-primary" style={{ width: `${usagePercent}%` }} />
          </div>
          <div className="mt-1 text-xs text-on-surface-variant">
            {formatAssetScopedAmount(group.dailyUsage, group)} / {formatLimit(group.dailyLimit, group, t)}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {allowedActions.map((label) => (
            <span
              key={label}
              className="rounded-sm border border-outline-variant bg-surface-container-low px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-on-surface-variant"
            >
              {label}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs text-on-surface-variant">
          <div>
            <div className="font-mono uppercase tracking-wide">{t('card.monthlyLimit')}</div>
            <div className="mt-1 text-on-surface">{formatLimit(group.monthlyLimit, group, t)}</div>
          </div>
          <div>
            <div className="font-mono uppercase tracking-wide">{t('card.cooldown')}</div>
            <div className="mt-1 text-on-surface">
              {group.cooldownRounds > 0 ? t('card.rounds', { count: group.cooldownRounds }) : t('card.none')}
            </div>
          </div>
        </div>

        <div className="pt-1">
          <Button variant="secondary" className="w-full" onClick={() => navigate(`/safe/${safeId}/signer-groups/${group.id}/edit`)}>
            <Icon name="tune" className="text-base" />
            {t('card.manage')}
          </Button>
        </div>
      </div>
    </Card>
  )
}
