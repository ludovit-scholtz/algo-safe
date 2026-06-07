import { formatUnits } from '../lib/onChainSafe'
import type { LiveSignerGroup } from '../services/algoSafeGroups'
import { Card } from './ui/Card'
import { Icon } from './ui/Icon'

const ACT_PAY = 1
const ACT_AXFER = 2
const ACT_APPL = 4
const ACT_KEYREG = 8

function getActionLabels(allowedActions: number) {
  const labels: string[] = []
  if ((allowedActions & ACT_PAY) !== 0) labels.push('ALGO')
  if ((allowedActions & ACT_AXFER) !== 0) labels.push('ASA')
  if ((allowedActions & ACT_APPL) !== 0) labels.push('App')
  if ((allowedActions & ACT_KEYREG) !== 0) labels.push('Keyreg')
  return labels.length > 0 ? labels : ['None']
}

function formatLimit(limit: bigint) {
  return limit === 0n ? 'No limit' : `${formatUnits(limit, 6)} ALGO`
}

export function SignerGroupCard({ group }: { group: LiveSignerGroup }) {
  const allowedActions = getActionLabels(group.allowedActions)
  const usagePercent = group.dailyLimit === 0n ? 0 : Math.min(100, Math.round(Number((group.dailyUsage * 100n) / group.dailyLimit)))

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-on-surface">{group.name}</span>
            <span className={`rounded-sm px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide ${group.isAdminGroup ? 'bg-primary/15 text-primary' : 'bg-secondary-container/20 text-secondary'}`}>
              {group.isAdminGroup ? 'Admin' : 'Execution'}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-on-surface-variant">
            Group #{group.id} · {group.threshold}-of-{group.memberCount} signers
          </p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide ${group.active ? 'bg-primary/15 text-primary' : 'bg-surface-container-high text-on-surface-variant'}`}>
          <Icon name={group.active ? 'check_circle' : 'pause_circle'} className="text-sm" />
          {group.active ? 'Active' : 'Disabled'}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <div className="flex justify-between font-mono text-xs uppercase text-on-surface-variant">
            <span>Daily Usage</span>
            <span>{group.dailyLimit === 0n ? 'Unlimited' : `${usagePercent}%`}</span>
          </div>
          <div className="mt-1 h-2 w-full rounded-full bg-surface-container-lowest">
            <div className="h-2 rounded-full bg-primary" style={{ width: `${usagePercent}%` }} />
          </div>
          <div className="mt-1 text-xs text-on-surface-variant">
            {formatUnits(group.dailyUsage, 6)} / {formatLimit(group.dailyLimit)}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {allowedActions.map((label) => (
            <span key={label} className="rounded-sm border border-outline-variant bg-surface-container-low px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-on-surface-variant">
              {label}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs text-on-surface-variant">
          <div>
            <div className="font-mono uppercase tracking-wide">Monthly Limit</div>
            <div className="mt-1 text-on-surface">{formatLimit(group.monthlyLimit)}</div>
          </div>
          <div>
            <div className="font-mono uppercase tracking-wide">Cooldown</div>
            <div className="mt-1 text-on-surface">{group.cooldownRounds > 0 ? `${group.cooldownRounds} rounds` : 'None'}</div>
          </div>
        </div>
      </div>
    </Card>
  )
}