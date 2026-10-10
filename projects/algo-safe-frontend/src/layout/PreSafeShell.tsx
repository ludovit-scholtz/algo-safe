import { Outlet } from 'react-router-dom'
import logo from '../assets/logo.svg'
import { useTranslation } from 'react-i18next'
import { AuthStatus } from '../components/AuthStatus'
import { LanguageSwitcher } from '../components/LanguageSwitcher'

export function PreSafeShell() {
  const { t } = useTranslation('layout')
  return (
    <div className="min-h-screen bg-background text-on-surface">
      <header className="border-b border-outline-variant">
        <div className="mx-auto flex max-w-container items-center justify-between px-5 py-4">
          <div className="flex items-center gap-1">
            <div className="rounded-xl bg-white/80 backdrop-blur-sm mr-2">
              <img src={logo} alt={t('logoAlt')} className="h-12 w-24 object-contain" />
            </div>
            <span className="font-semibold">Algo Safe</span>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <AuthStatus />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-container px-5 py-10">
        <Outlet />
      </main>
    </div>
  )
}
