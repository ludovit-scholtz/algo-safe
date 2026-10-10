import { useTranslation } from 'react-i18next'

export function PolicyLogicBlock({ condition, action, signers }: { condition: string; action: string; signers: string }) {
  const { t } = useTranslation('proposals')
  return (
    <div className="space-y-2 rounded-md border border-outline-variant bg-surface-container-high p-4">
      <div>
        <span className="font-mono text-xs uppercase text-on-surface-variant">{t('policyBlock.condition')}</span>
        <div className="text-sm text-on-surface">{condition}</div>
      </div>
      <div>
        <span className="font-mono text-xs uppercase text-on-surface-variant">{t('policyBlock.action')}</span>
        <div className="text-sm text-on-surface">{action}</div>
      </div>
      <div>
        <span className="font-mono text-xs uppercase text-on-surface-variant">{t('policyBlock.signers')}</span>
        <div className="text-sm text-on-surface">{signers}</div>
      </div>
    </div>
  )
}
