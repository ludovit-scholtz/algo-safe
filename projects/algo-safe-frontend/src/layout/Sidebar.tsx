// src/layout/Sidebar.tsx
import { NavLink } from 'react-router-dom'
import { Icon } from '../components/ui'
const items = [
  { to: '/', icon: 'dashboard', label: 'Dashboard', end: true },
  { to: '/assets', icon: 'account_balance_wallet', label: 'Assets' },
  { to: '/agents', icon: 'smart_toy', label: 'Agents' },
  { to: '/proposals', icon: 'gavel', label: 'Proposals' },
  { to: '/settings', icon: 'settings', label: 'Settings' },
]
export const Sidebar = () => (
  <aside className="flex w-60 flex-col border-r border-surface-border bg-white">
    <div className="flex items-center gap-2 px-6 py-5"><Icon name="shield" className="text-ink-900" /><div><div className="font-bold">AlgoSafe</div><div className="text-xs text-ink-500">Institutional Treasury</div></div></div>
    <nav className="flex-1 px-3">{items.map(i => (
      <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => `mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-700 hover:bg-surface-muted'}`}>
        <Icon name={i.icon} className="text-[20px]" />{i.label}</NavLink>))}</nav>
    <div className="p-3"><button className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white"><Icon name="add" className="text-[20px]" />Create Proposal</button></div>
  </aside>
)
