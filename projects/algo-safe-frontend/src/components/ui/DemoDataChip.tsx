import { useTranslation } from 'react-i18next'
export const DemoDataChip = () => {
  const { t } = useTranslation('common')
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warn/15 px-2 py-0.5 font-mono text-xs font-medium text-warn">
      {t('demoData')}
    </span>
  )
}
