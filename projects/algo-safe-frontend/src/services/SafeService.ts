// src/services/SafeService.ts
import type { Safe, Agent, Policy, Proposal, RegisterAgentInput, PolicyChangeInput } from './types'
export interface SafeService {
  getSafe(): Promise<Safe>
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
