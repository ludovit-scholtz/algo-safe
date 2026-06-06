// src/lib/store.ts
import type { Agent, AssetHolding, Policy, Proposal, Safe, SafeSummary, TreasurySummary } from '../services/types'

let nextAgentSeq = 4
let nextPropSeq = 44
let nextSafeSeq = 3

export const store = {
  safes: [
    { safeId: 'safe_1', name: 'Cold Storage A', appId: 109847265, address: 'A3B7...X9Z2', tier: '3-of-5 Multisig', totalValueEur: 2485920.42, agentCount: 3, status: 'active' },
    { safeId: 'safe_2', name: 'Governance Treasury', appId: 109847266, address: 'GOV4...K1M8', tier: '2-of-3 Multisig', totalValueEur: 812340.10, agentCount: 1, status: 'active' },
  ] as SafeSummary[],

  currentSafeId: 'safe_1',

  safe: {
    name: 'Cold Storage A',
    appId: 109847265,
    address: 'A3B7...X9Z2',
    network: 'mainnet',
  } as Safe,

  assets: [
    { symbol: 'ALGO', name: 'Algorand Native', assetId: 0, amount: 1250000, valueEur: 287500, type: 'native' },
    { symbol: 'EURD', name: 'EURD Stablecoin', assetId: 1221682136, amount: 2100000, valueEur: 2100000, type: 'stablecoin' },
    { symbol: 'EURD', name: 'EURD — Active Lending', assetId: 1221682136, amount: 98420.42, valueEur: 98420.42, type: 'lending', apy: 4.2 },
  ] as AssetHolding[],

  treasury: { totalValueEur: 2485920.42, availableAlgo: 1250000, availableEurd: 2100000 } as TreasurySummary,

  agents: [
    { id: 'agt_1', alias: 'Arbitrage Bot Alpha', address: 'ARBX...A1B2', purpose: 'Algorithmic Trading', primaryAsset: 'ALGO', dailyLimit: 10000, status: 'active', groupTier: 'Tier 3 - Automated Execution (1/1)' },
    { id: 'agt_2', alias: 'EURD Treasury Sweeper', address: 'SWEP...C3D4', purpose: 'Treasury Rebalancing', primaryAsset: 'EURD', dailyLimit: 50000, status: 'active', groupTier: 'Tier 2 - Operational Reserves (2/3)' },
    { id: 'agt_3', alias: 'Cross-Chain Bridge Relay', address: 'BRDG...E5F6', purpose: 'Treasury Rebalancing', primaryAsset: 'USDC', dailyLimit: 25000, status: 'pending_review', groupTier: 'Tier 2 - Operational Reserves (2/3)' },
  ] as Agent[],

  policies: {
    agt_1: { agentId: 'agt_1', dailyLimit: 10000, monthlyLimit: 250000, dailyUsed: 3200, monthlyUsed: 88000, minIntervalSec: 60, maxTxPerMin: 4, allowlist: ['100279384'], multiSigRequired: true },
    agt_2: { agentId: 'agt_2', dailyLimit: 50000, monthlyLimit: 250000, dailyUsed: 12000, monthlyUsed: 130000, minIntervalSec: 60, maxTxPerMin: 4, allowlist: ['7QLMZH5C5XVPEV6T7D6W2TMWRSURHVDMLQEBDODWGVVMKOJD2A77AIHVMA'], multiSigRequired: true },
    agt_3: { agentId: 'agt_3', dailyLimit: 25000, monthlyLimit: 100000, dailyUsed: 0, monthlyUsed: 0, minIntervalSec: 120, maxTxPerMin: 2, allowlist: [], multiSigRequired: true },
  } as Record<string, Policy>,

  proposals: [
    { id: '0042', title: 'Quarterly LP Provisioning', description: 'Provision liquidity for Q4 market making.', status: 'pending', approvals: 2, threshold: 5, amount: 250000, asset: 'EURD', date: 'Today, 14:30',
      txPreview: [{ type: 'axfer', summary: 'Transfer 250,000 EURD', detail: 'to LP pool 100279384' }],
      policyChecks: [{ label: 'Within daily limit', passed: true }, { label: 'Receiver allowlisted', passed: true }] },
    { id: '0041', title: 'Vendor Payment - Security Audit', description: 'Pay security auditor.', status: 'executed', approvals: 3, threshold: 3, amount: 15000, asset: 'EURD', date: 'Yesterday, 09:15',
      txPreview: [{ type: 'axfer', summary: 'Transfer 15,000 EURD', detail: 'to vendor' }], policyChecks: [{ label: 'Within daily limit', passed: true }] },
    { id: '0040', title: 'Agent Registration: Yield Farmer V2', description: 'Register a new automated agent.', status: 'draft', approvals: 0, threshold: 3, date: 'Oct 24, 2023',
      txPreview: [{ type: 'appl', summary: 'Initialize agent contract', detail: 'register signer in Tier 3' }], policyChecks: [] },
    { id: '0043', title: 'Agent Payment — SkipperBrief Forecast', description: 'Arbitrage Bot Alpha attempted an autonomous payment that exceeds its daily limit.', status: 'blocked', approvals: 0, threshold: 2, amount: 12000, asset: 'EURD', date: 'Today, 15:02',
      txPreview: [{ type: 'axfer', summary: 'Transfer 12,000 EURD', detail: 'to merchant skipper.ever-online.com' }],
      policyChecks: [{ label: 'Within daily limit (10,000 EURD)', passed: false }, { label: 'Receiver allowlisted', passed: false }],
      blockedReason: 'Exceeds agent daily limit (12,000 > 10,000 EURD) and receiver not on allowlist. Requires admin approval.' },
  ] as Proposal[],

  newAgentId() { return `agt_${nextAgentSeq++}` },
  newProposalId() { return String(nextPropSeq++).padStart(4, '0') },
  newSafeId() { return `safe_${nextSafeSeq++}` },
}
