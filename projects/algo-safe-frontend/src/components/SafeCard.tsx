import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { currentLocale } from '../i18n/instance'
import type { SafeSummary } from '../services/types'
import { AddressDisplay } from './AddressDisplay'
import { Card } from './ui/Card'
import { Icon } from './ui/Icon'
import { StatusBadge } from './ui/StatusBadge'

export function SafeCard({ safe }: { safe: SafeSummary }) {
  const { t } = useTranslation('safes')
  const nav = useNavigate()

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      nav(`/safe/${safe.safeId}`)
    }
  }

  return (
    <Card className="cursor-pointer transition hover:border-primary">
      <div role="button" tabIndex={0} className="w-full text-left" onClick={() => nav(`/safe/${safe.safeId}`)} onKeyDown={handleKeyDown}>
        <div className="flex items-center justify-between">
          <span className="text-lg font-semibold text-on-surface">{safe.name}</span>
          <StatusBadge status={safe.status} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-on-surface-variant">
          <AddressDisplay address={safe.address} textClassName="text-xs text-on-surface-variant" buttonClassName="h-5 w-5" />
          <span>· {t('card.app', { appId: safe.appId })}</span>
        </div>
        <div className="mt-4 text-2xl font-bold text-on-surface">€{safe.totalValueEur.toLocaleString(currentLocale())}</div>
        <div className="mt-2 flex items-center justify-between text-xs text-on-surface-variant">
          <span>{safe.tier}</span>
          <span className="inline-flex items-center gap-1">
            <Icon name="smart_toy" className="text-sm" />
            {t('card.agents', { count: safe.agentCount })}
          </span>
        </div>
      </div>
    </Card>
  )
}
