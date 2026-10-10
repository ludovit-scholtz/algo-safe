// src/services/mock/safeMock.ts
import i18n from '../../i18n/instance'
import {
  getSafeRegistryEntryBySafeId,
  listSafeRegistryEntriesForWallet,
  safeRegistryEntryToSafe,
  safeRegistryEntryToSummary,
} from '../../lib/safeRegistry'
import { store } from '../../lib/store'
import type { SafeService } from '../SafeService'
import type { Agent, CreateSafeInput, Proposal, SafeListFilters } from '../types'

const delay = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 150))
const wait = (ms = 250) => new Promise<void>((r) => setTimeout(r, ms))

export const safeMock: SafeService = {
  async listSafes(filters?: SafeListFilters) {
    await wait()
    return listSafeRegistryEntriesForWallet({ creatorAddress: filters?.creatorAddress, network: filters?.network }).map(
      safeRegistryEntryToSummary,
    )
  },
  async getSafe(safeId: string) {
    const registrySafe = getSafeRegistryEntryBySafeId(safeId)
    if (registrySafe) return safeRegistryEntryToSafe(registrySafe)

    throw new Error(i18n.t('safes:mock.safeNotFound', { safeId }))
  },
  async createSafe(input: CreateSafeInput) {
    await wait()
    const summary = {
      safeId: store.newSafeId(),
      name: input.name,
      appId: 100000000 + store.safes.length,
      address: `NEW${store.safes.length}...SAFE`,
      tier: i18n.t('safes:mock.tier', { threshold: input.threshold, signerCount: input.signerCount }),
      totalValueEur: input.initialDepositEurd,
      agentCount: 0,
      status: 'active' as const,
    }
    store.safes.push(summary)
    return summary
  },
  async listAssets(_safeId: string) {
    await wait()
    return [...store.assets]
  },
  async getTreasury(_safeId: string) {
    await wait()
    return { ...store.treasury }
  },

  listAgents: () => delay([...store.agents]),

  async registerAgent(input) {
    const agent: Agent = {
      id: store.newAgentId(),
      alias: input.alias,
      address: input.address,
      purpose: input.purpose,
      primaryAsset: input.primaryAsset,
      dailyLimit: input.dailyLimit,
      status: 'pending_review',
      groupTier: input.groupTier,
    }
    store.agents.push(agent)
    store.policies[agent.id] = {
      agentId: agent.id,
      dailyLimit: input.dailyLimit,
      monthlyLimit: input.dailyLimit * 20,
      dailyUsed: 0,
      monthlyUsed: 0,
      minIntervalSec: 60,
      maxTxPerMin: 4,
      allowlist: [],
      multiSigRequired: true,
    }
    const proposal: Proposal = {
      id: store.newProposalId(),
      title: i18n.t('safes:mock.agentRegTitle', { alias: input.alias }),
      description: i18n.t('safes:mock.agentRegDesc', { alias: input.alias, groupTier: input.groupTier }),
      status: 'draft',
      approvals: 0,
      threshold: 3,
      date: i18n.t('safes:mock.justNow'),
      txPreview: [{ type: 'appl', summary: i18n.t('safes:mock.initAgent'), detail: input.groupTier }],
      policyChecks: [],
    }
    store.proposals.unshift(proposal)
    return delay(agent)
  },

  getPolicy: (agentId) => delay(store.policies[agentId]),

  async proposePolicyChange({ agentId, policy }) {
    const agent = store.agents.find((a) => a.id === agentId)
    const proposal: Proposal = {
      id: store.newProposalId(),
      title: i18n.t('safes:mock.policyTitle', { name: agent?.alias ?? agentId }),
      description: i18n.t('safes:mock.policyDesc'),
      status: 'pending',
      approvals: 1,
      threshold: 3,
      date: i18n.t('safes:mock.justNow'),
      txPreview: [{ type: 'appl', summary: i18n.t('safes:mock.updatePolicyBox'), detail: JSON.stringify(policy).slice(0, 80) }],
      policyChecks: [{ label: i18n.t('safes:mock.withinRules'), passed: true }],
    }
    store.proposals.unshift(proposal)
    return delay(proposal)
  },

  listProposals: () => delay([...store.proposals]),
  getProposal: (id) => delay(store.proposals.find((p) => p.id === id)),

  async approveProposal(id) {
    const p = store.proposals.find((x) => x.id === id)!
    if (p.status === 'blocked' || p.status === 'draft') p.status = 'pending'
    p.approvals = Math.min(p.threshold, p.approvals + 1)
    if (p.approvals >= p.threshold) p.status = 'executed'
    return delay({ ...p })
  },
  async rejectProposal(id) {
    const p = store.proposals.find((x) => x.id === id)!
    p.status = 'rejected'
    return delay({ ...p })
  },
  async executeProposal(id) {
    const p = store.proposals.find((x) => x.id === id)!
    p.status = 'executed'
    return delay({ ...p })
  },
}
