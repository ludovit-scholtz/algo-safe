// src/services/mock/safeMock.ts
import type { SafeService } from '../SafeService'
import type { Agent, CreateSafeInput, Proposal } from '../types'
import { getSafeRegistryEntryBySafeId, listSafeRegistryEntries, safeRegistryEntryToSafe, safeRegistryEntryToSummary } from '../../lib/safeRegistry'
import { store } from '../../lib/store'

const delay = <T>(v: T) => new Promise<T>(r => setTimeout(() => r(v), 150))
const wait = (ms = 250) => new Promise<void>(r => setTimeout(r, ms))

export const safeMock: SafeService = {
  async listSafes() {
    await wait()
    return [...listSafeRegistryEntries().map(safeRegistryEntryToSummary), ...store.safes]
  },
  async getSafe(safeId: string) {
    const registrySafe = getSafeRegistryEntryBySafeId(safeId)
    if (registrySafe) return safeRegistryEntryToSafe(registrySafe)

    const s = store.safes.find(x => x.safeId === safeId) ?? store.safes[0]
    return { name: s.name, appId: s.appId, address: s.address, network: 'mainnet' as const }
  },
  async createSafe(input: CreateSafeInput) {
    await wait()
    const summary = {
      safeId: store.newSafeId(), name: input.name, appId: 100000000 + store.safes.length,
      address: `NEW${store.safes.length}...SAFE`, tier: `${input.threshold}-of-${input.signerCount} Multisig`,
      totalValueEur: input.initialDepositEurd, agentCount: 0, status: 'active' as const,
    }
    store.safes.push(summary)
    return summary
  },
  async listAssets(_safeId: string) { await wait(); return [...store.assets] },
  async getTreasury(_safeId: string) { await wait(); return { ...store.treasury } },

  listAgents: () => delay([...store.agents]),

  async registerAgent(input) {
    const agent: Agent = {
      id: store.newAgentId(),
      alias: input.alias, address: input.address, purpose: input.purpose,
      primaryAsset: input.primaryAsset, dailyLimit: input.dailyLimit,
      status: 'pending_review', groupTier: input.groupTier,
    }
    store.agents.push(agent)
    store.policies[agent.id] = { agentId: agent.id, dailyLimit: input.dailyLimit, monthlyLimit: input.dailyLimit * 20, dailyUsed: 0, monthlyUsed: 0, minIntervalSec: 60, maxTxPerMin: 4, allowlist: [], multiSigRequired: true }
    const proposal: Proposal = {
      id: store.newProposalId(), title: `Agent Registration: ${input.alias}`,
      description: `Register automated agent ${input.alias} in ${input.groupTier}.`,
      status: 'draft', approvals: 0, threshold: 3, date: 'Just now',
      txPreview: [{ type: 'appl', summary: 'Initialize agent contract', detail: input.groupTier }],
      policyChecks: [],
    }
    store.proposals.unshift(proposal)
    return delay(agent)
  },

  getPolicy: (agentId) => delay(store.policies[agentId]),

  async proposePolicyChange({ agentId, policy }) {
    const agent = store.agents.find(a => a.id === agentId)
    const proposal: Proposal = {
      id: store.newProposalId(), title: `Policy Update: ${agent?.alias ?? agentId}`,
      description: 'Modify agent spending policy.', status: 'pending', approvals: 1, threshold: 3, date: 'Just now',
      txPreview: [{ type: 'appl', summary: 'Update policy box', detail: JSON.stringify(policy).slice(0, 80) }],
      policyChecks: [{ label: 'Within governance rules', passed: true }],
    }
    store.proposals.unshift(proposal)
    return delay(proposal)
  },

  listProposals: () => delay([...store.proposals]),
  getProposal: (id) => delay(store.proposals.find(p => p.id === id)),

  async approveProposal(id) {
    const p = store.proposals.find(x => x.id === id)!
    if (p.status === 'blocked' || p.status === 'draft') p.status = 'pending'
    p.approvals = Math.min(p.threshold, p.approvals + 1)
    if (p.approvals >= p.threshold) p.status = 'executed'
    return delay({ ...p })
  },
  async rejectProposal(id) {
    const p = store.proposals.find(x => x.id === id)!
    p.status = 'rejected'
    return delay({ ...p })
  },
  async executeProposal(id) {
    const p = store.proposals.find(x => x.id === id)!
    p.status = 'executed'
    return delay({ ...p })
  },
}
