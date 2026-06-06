import { NavLink, useParams } from 'react-router-dom'
import { Icon } from '../components/ui/Icon'

const items = [
  { to: '', icon: 'dashboard', label: 'Dashboard', end: true },
  { to: 'proposals', icon: 'how_to_vote', label: 'Proposals', end: false },
  { to: 'assets', icon: 'account_balance_wallet', label: 'Assets', end: false },
]
export function Sidebar() {
  const { safeId } = useParams<{ safeId: string }>()
  const base = `/safe/${safeId}`
  return (
    <aside className="w-60 shrink-0 border-r border-outline-variant bg-surface-container-low p-4">
      <div className="mb-6 flex items-center gap-2 px-2"><Icon name="security" className="text-primary" /><span className="font-semibold">Algo Safe</span></div>
      <nav className="space-y-1">
        {items.map(it => (
          <NavLink key={it.label} to={it.to ? `${base}/${it.to}` : base} end={it.end}
            className={({ isActive }) => `flex items-center gap-3 rounded-sm px-3 py-2 text-sm ${isActive ? 'bg-surface-container-high text-primary' : 'text-on-surface-variant hover:bg-surface-container-high'}`}>
            <Icon name={it.icon} className="text-lg" />{it.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
