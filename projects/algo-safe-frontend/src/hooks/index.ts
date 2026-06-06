// src/hooks/index.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useServices } from '../services'
import type { RegisterAgentInput, PolicyChangeInput } from '../services/types'

export const useSafe = () => { const { safe } = useServices(); return useQuery({ queryKey: ['safe'], queryFn: () => safe.getSafe() }) }
export const useAgents = () => { const { safe } = useServices(); return useQuery({ queryKey: ['agents'], queryFn: () => safe.listAgents() }) }
export const usePolicy = (agentId?: string) => { const { safe } = useServices(); return useQuery({ queryKey: ['policy', agentId], queryFn: () => safe.getPolicy(agentId!), enabled: !!agentId }) }
export const useProposals = () => { const { safe } = useServices(); return useQuery({ queryKey: ['proposals'], queryFn: () => safe.listProposals() }) }
export const useProposal = (id?: string) => { const { safe } = useServices(); return useQuery({ queryKey: ['proposal', id], queryFn: () => safe.getProposal(id!), enabled: !!id }) }

export const useEurdBalance = () => { const { quantoz } = useServices(); return useQuery({ queryKey: ['eurd'], queryFn: () => quantoz.getEurdBalance() }) }
export const useQuantozTransactions = () => { const { quantoz } = useServices(); return useQuery({ queryKey: ['qtx'], queryFn: () => quantoz.getTransactions() }) }

export function useRegisterAgent() {
  const { safe } = useServices(); const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: RegisterAgentInput) => safe.registerAgent(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }); qc.invalidateQueries({ queryKey: ['proposals'] }) },
  })
}
export function useProposePolicyChange() {
  const { safe } = useServices(); const qc = useQueryClient()
  return useMutation({ mutationFn: (input: PolicyChangeInput) => safe.proposePolicyChange(input), onSuccess: () => qc.invalidateQueries({ queryKey: ['proposals'] }) })
}
export function useApproveProposal() {
  const { safe } = useServices(); const qc = useQueryClient()
  return useMutation({ mutationFn: (id: string) => safe.approveProposal(id), onSuccess: (_d, id) => { qc.invalidateQueries({ queryKey: ['proposals'] }); qc.invalidateQueries({ queryKey: ['proposal', id] }) } })
}
export function useRejectProposal() {
  const { safe } = useServices(); const qc = useQueryClient()
  return useMutation({ mutationFn: (id: string) => safe.rejectProposal(id), onSuccess: (_d, id) => { qc.invalidateQueries({ queryKey: ['proposals'] }); qc.invalidateQueries({ queryKey: ['proposal', id] }) } })
}
export function useExecuteProposal() {
  const { safe } = useServices(); const qc = useQueryClient()
  return useMutation({ mutationFn: (id: string) => safe.executeProposal(id), onSuccess: (_d, id) => { qc.invalidateQueries({ queryKey: ['proposals'] }); qc.invalidateQueries({ queryKey: ['proposal', id] }) } })
}
