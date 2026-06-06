// src/services/SafeService.ts
import type {
  Safe, SafeSummary, Agent, Policy, Proposal, AssetHolding, TreasurySummary,
  RegisterAgentInput, PolicyChangeInput, CreateSafeInput,
} from './types'
export interface SafeService {
  listSafes(): Promise<SafeSummary[]>
  getSafe(safeId: string): Promise<Safe>
  createSafe(input: CreateSafeInput): Promise<SafeSummary>
  listAssets(safeId: string): Promise<AssetHolding[]>
  getTreasury(safeId: string): Promise<TreasurySummary>
  listAgents(): Promise<Agent[]>
  registerAgent(input: RegisterAgentInput): Promise<Agent>
  getPolicy(agentId: string): Promise<Policy>
  proposePolicyChange(input: PolicyChangeInput): Promise<Proposal>
  listProposals(): Promise<Proposal[]>
  getProposal(id: string): Promise<Proposal | undefined>
  approveProposal(id: string): Promise<Proposal>
  rejectProposal(id: string): Promise<Proposal>
  executeProposal(id: string): Promise<Proposal>
}
