import { useTranslation } from 'react-i18next'
import { NavLink, useParams } from 'react-router-dom'
import logo from '../assets/logo.svg'
import { Icon } from '../components/ui/Icon'

const items = [
  { to: '', icon: 'dashboard', label: 'dashboard', end: true },
  { to: 'proposals', icon: 'how_to_vote', label: 'proposals', end: false },
  { to: 'proposals/create', icon: 'playlist_add', label: 'createProposal', end: false },
  { to: 'assets', icon: 'account_balance_wallet', label: 'assets', end: false },
  { to: 'upgrade', icon: 'upgrade', label: 'upgrade', end: false },
  { to: 'walletconnect', icon: 'link', label: 'walletConnect', end: false },
]
export function Sidebar() {
  const { t } = useTranslation('layout')
  const { safeId } = useParams<{ safeId: string }>()
  const base = `/safe/${safeId}`
  return (
    <aside className="w-60 shrink-0 border-r border-outline-variant bg-surface-container-low p-4">
      <div className="mb-6 flex items-center gap-1 px-2">
        <div className="rounded-xl bg-white/40 backdrop-blur-sm">
          <img src={logo} alt={t('logoAlt')} className="h-12 w-24 object-contain" />
        </div>
        <span className="font-semibold">Algo Safe</span>
      </div>
      <nav className="space-y-1">
        {items.map((it) => (
          <NavLink
            key={t(`nav.${it.label}`)}
            to={it.to ? `${base}/${it.to}` : base}
            end={it.end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-sm px-3 py-2 text-sm ${isActive ? 'bg-surface-container-high text-primary' : 'text-on-surface-variant hover:bg-surface-container-high'}`
            }
          >
            <Icon name={it.icon} className="text-lg" />
            {it.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
