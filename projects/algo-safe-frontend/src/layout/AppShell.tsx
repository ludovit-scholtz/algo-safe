// src/layout/AppShell.tsx
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
export const AppShell = () => (
  <div className="flex h-screen overflow-hidden"><Sidebar />
    <div className="flex flex-1 flex-col overflow-hidden"><TopBar />
      <main className="flex-1 overflow-y-auto p-8"><Outlet /></main></div></div>
)
