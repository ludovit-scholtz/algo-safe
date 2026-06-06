// src/routes.tsx
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { PreSafeShell } from './layout/PreSafeShell'
import { ConsoleShell } from './layout/ConsoleShell'
import { SafeSelectionPage } from './pages/SafeSelectionPage'
import { InitializeSafePage } from './pages/InitializeSafePage'
import { AgentDashboardPage } from './pages/AgentDashboardPage'
import { RegisterAgentPage } from './pages/RegisterAgentPage'
import { ProposalsPage } from './pages/ProposalsPage'
import { ProposalDetailPage } from './pages/ProposalDetailPage'
import { TreasuryAssetsPage } from './pages/TreasuryAssetsPage'

export const router = createBrowserRouter([
  {
    element: <PreSafeShell />,
    children: [
      { path: '/', element: <SafeSelectionPage /> },
      { path: '/initialize', element: <InitializeSafePage /> },
    ],
  },
  {
    path: '/safe/:safeId',
    element: <ConsoleShell />,
    children: [
      { index: true, element: <AgentDashboardPage /> },
      { path: 'agents/register', element: <RegisterAgentPage /> },
      { path: 'proposals', element: <ProposalsPage /> },
      { path: 'proposals/:id', element: <ProposalDetailPage /> },
      { path: 'assets', element: <TreasuryAssetsPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
