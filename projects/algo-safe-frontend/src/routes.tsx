// src/routes.tsx
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { ConsoleShell } from './layout/ConsoleShell'
import { PreSafeShell } from './layout/PreSafeShell'
import { AgentDashboardPage } from './pages/AgentDashboardPage'
import { CreateProposalPage } from './pages/CreateProposalPage'
import { InitializeSafePage } from './pages/InitializeSafePage'
import { ProposalDetailPage } from './pages/ProposalDetailPage'
import { ProposalsPage } from './pages/ProposalsPage'
import { RegisterAgentPage } from './pages/RegisterAgentPage'
import { SafeSelectionPage } from './pages/SafeSelectionPage'
import { SignerGroupManagementPage } from './pages/SignerGroupManagementPage'
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
      { path: 'signer-groups/:groupId/edit', element: <SignerGroupManagementPage /> },
      { path: 'proposals', element: <ProposalsPage /> },
      { path: 'proposals/create', element: <CreateProposalPage /> },
      { path: 'proposals/:id', element: <ProposalDetailPage /> },
      { path: 'assets', element: <TreasuryAssetsPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
