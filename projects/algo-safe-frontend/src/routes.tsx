// src/routes.tsx
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { ConsoleShell } from './layout/ConsoleShell'
import { PreSafeShell } from './layout/PreSafeShell'
import { AgentDashboardPage } from './pages/AgentDashboardPage'
import { CreateProposalPage } from './pages/CreateProposalPage'
import { CreateSignerGroupPage } from './pages/CreateSignerGroupPage'
import { InitializeSafePage } from './pages/InitializeSafePage'
import { ProposalDetailPage } from './pages/ProposalDetailPage'
import { ProposalsPage } from './pages/ProposalsPage'
import { RegisterAgentPage } from './pages/RegisterAgentPage'
import { SafeSelectionPage } from './pages/SafeSelectionPage'
import { SafeUpgradePage } from './pages/SafeUpgradePage'
import { SignerGroupManagementPage } from './pages/SignerGroupManagementPage'
import { TreasuryAssetsPage } from './pages/TreasuryAssetsPage'
import { WalletConnectPage } from './pages/WalletConnectPage'

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
      { path: 'signer-groups/create', element: <CreateSignerGroupPage /> },
      { path: 'signer-groups/:groupId/edit', element: <SignerGroupManagementPage /> },
      { path: 'proposals', element: <ProposalsPage /> },
      { path: 'proposals/create', element: <CreateProposalPage /> },
      { path: 'proposals/:id', element: <ProposalDetailPage /> },
      { path: 'assets', element: <TreasuryAssetsPage /> },
      { path: 'upgrade', element: <SafeUpgradePage /> },
      { path: 'walletconnect', element: <WalletConnectPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
