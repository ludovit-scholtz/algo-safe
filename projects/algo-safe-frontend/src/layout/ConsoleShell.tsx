import { Outlet } from 'react-router-dom'
import { SafeProvider } from '../lib/SafeContext'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

export function ConsoleShell() {
  return (
    <SafeProvider>
      <div className="flex min-h-screen bg-background text-on-surface">
        <Sidebar />
        <div className="flex flex-1 flex-col">
          <TopBar />
          <main className="flex-1 p-6"><div className="mx-auto max-w-container"><Outlet /></div></main>
        </div>
      </div>
    </SafeProvider>
  )
}
