import { Outlet } from 'react-router-dom'
import { AuthStatus } from '../components/AuthStatus'
import { Icon } from '../components/ui/Icon'

export function PreSafeShell() {
  return (
    <div className="min-h-screen bg-background text-on-surface">
      <header className="border-b border-outline-variant">
        <div className="mx-auto flex max-w-container items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2">
            <Icon name="security" className="text-primary" />
            <span className="font-semibold">Algo Safe</span>
          </div>
          <AuthStatus />
        </div>
      </header>
      <main className="mx-auto max-w-container px-5 py-10">
        <Outlet />
      </main>
    </div>
  )
}
