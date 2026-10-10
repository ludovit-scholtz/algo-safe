import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AuthStatus } from '../components/AuthStatus'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { Button } from '../components/ui/Button'
import { Icon } from '../components/ui/Icon'
import { useSafe } from '../hooks'

export function TopBar() {
  const { t } = useTranslation('layout')
  const { safeId } = useParams<{ safeId: string }>()
  const nav = useNavigate()
  const { data: safe } = useSafe(safeId)
  return (
    <header className="flex items-center justify-between border-b border-outline-variant bg-surface-container-low px-6 py-3">
      <button className="flex items-center gap-2 text-sm text-on-surface-variant hover:text-on-surface" onClick={() => nav('/')}>
        <Icon name="unfold_more" className="text-lg" />
        <span className="font-medium text-on-surface">{safe?.name ?? t('selectSafe')}</span>
      </button>
      <div className="flex items-center gap-3">
        <LanguageSwitcher />
        <AuthStatus />
        <Link to={`/safe/${safeId}/agents/register`}>
          <Button>
            <Icon name="add" className="text-lg" />
            {t('registerAgent')}
          </Button>
        </Link>
      </div>
    </header>
  )
}
