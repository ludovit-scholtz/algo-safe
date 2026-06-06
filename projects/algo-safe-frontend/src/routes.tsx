// src/routes.tsx
import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from './layout/AppShell'
import { DashboardPage } from './pages/DashboardPage'
import { RegisterAgentPage } from './pages/RegisterAgentPage'
import { AgentPoliciesPage } from './pages/AgentPoliciesPage'
import { FundEurdPage } from './pages/FundEurdPage'
import { ProposalDetailPage } from './pages/ProposalDetailPage'
import { Placeholder } from './pages/Placeholder'
export const router = createBrowserRouter([
  { element: <AppShell />, children: [
    { path: '/', element: <DashboardPage /> },
    { path: '/agents', element: <AgentPoliciesPage /> },
    { path: '/agents/register', element: <RegisterAgentPage /> },
    { path: '/proposals/:id', element: <ProposalDetailPage /> },
    { path: '/proposals', element: <Placeholder title="Proposals list" /> },
    { path: '/fund', element: <FundEurdPage /> },
    { path: '/assets', element: <Placeholder title="Assets" /> },
    { path: '/settings', element: <Placeholder title="Settings" /> },
  ]},
])
