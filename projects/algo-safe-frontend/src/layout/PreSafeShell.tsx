import { Outlet } from 'react-router-dom'
import logo from '../assets/logo.svg'
import { AuthStatus } from '../components/AuthStatus'

export function PreSafeShell() {
  return (
    <div className="min-h-screen bg-background text-on-surface">
      <header className="border-b border-outline-variant">
        <div className="mx-auto flex max-w-container items-center justify-between px-5 py-4">
          <div className="flex items-center gap-1">
            <div className="rounded-xl bg-white/80 backdrop-blur-sm mr-2">
              <img src={logo} alt="Algo Safe logo" className="h-12 w-24 object-contain" />
            </div>
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
