// src/hooks/index.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@txnlab/use-wallet-react'
import { useServices } from '../services'
import { useSafeId } from '../lib/SafeContext'
import type { RegisterAgentInput, PolicyChangeInput, CreateSafeInput } from '../services/types'
import { approveLiveProposal, cancelLiveProposal, executeLiveProposal, fetchLiveProposal, fetchLiveProposals, type ExecuteProposalLifecycle } from '../services/algoSafeProposals'

type ExecuteProposalInput = { id: string } & ExecuteProposalLifecycle

export const useSafes = () => { const { safe } = useServices(); return useQuery({ queryKey: ['safes'], queryFn: () => safe.listSafes() }) }
export const useSafe = (safeId?: string) => { const { safe } = useServices(); return useQuery({ queryKey: ['safe', safeId], queryFn: () => safe.getSafe(safeId!), enabled: !!safeId }) }
export const useAssets = (safeId?: string) => { const { safe } = useServices(); return useQuery({ queryKey: ['assets', safeId], queryFn: () => safe.listAssets(safeId!), enabled: !!safeId }) }
export const useTreasury = (safeId?: string) => { const { safe } = useServices(); return useQuery({ queryKey: ['treasury', safeId], queryFn: () => safe.getTreasury(safeId!), enabled: !!safeId }) }

export const useAgents = () => { const { safe } = useServices(); return useQuery({ queryKey: ['agents'], queryFn: () => safe.listAgents() }) }
export const usePolicy = (agentId?: string) => { const { safe } = useServices(); return useQuery({ queryKey: ['policy', agentId], queryFn: () => safe.getPolicy(agentId!), enabled: !!agentId }) }
export const useProposals = () => {
  const safeId = useSafeId()
  const { data: safe } = useSafe(safeId)
  const { algodClient, activeAddress } = useWallet()

  return useQuery({
    queryKey: ['proposals', safeId, safe?.appId, activeAddress],
    enabled: !!safe,
    queryFn: () => fetchLiveProposals({ algodClient, safe: safe!, activeAddress }),
  })
}
export const useProposal = (id?: string) => {
  const safeId = useSafeId()
  const { data: safe } = useSafe(safeId)
  const { algodClient, activeAddress } = useWallet()

  return useQuery({
    queryKey: ['proposal', safeId, id, safe?.appId, activeAddress],
    enabled: !!id && !!safe,
    queryFn: () => fetchLiveProposal({ algodClient, safe: safe!, activeAddress }, id!),
  })
}

export const useEurdBalance = () => { const { quantoz } = useServices(); return useQuery({ queryKey: ['eurd'], queryFn: () => quantoz.getEurdBalance() }) }
export const useQuantozTransactions = () => { const { quantoz } = useServices(); return useQuery({ queryKey: ['qtx'], queryFn: () => quantoz.getTransactions() }) }

export function useCreateSafe() {
  const { safe } = useServices(); const qc = useQueryClient()
  return useMutation({ mutationFn: (input: CreateSafeInput) => safe.createSafe(input), onSuccess: () => qc.invalidateQueries({ queryKey: ['safes'] }) })
}
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
  const safeId = useSafeId()
  const { data: safe } = useSafe(safeId)
  const { algodClient, activeAddress, transactionSigner } = useWallet()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => approveLiveProposal({ algodClient, safe: safe!, activeAddress, transactionSigner }, id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['proposals', safeId] })
      qc.invalidateQueries({ queryKey: ['proposal', safeId, id] })
    },
  })
}
export function useRejectProposal() {
  const safeId = useSafeId()
  const { data: safe } = useSafe(safeId)
  const { algodClient, activeAddress, transactionSigner } = useWallet()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => cancelLiveProposal({ algodClient, safe: safe!, activeAddress, transactionSigner }, id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['proposals', safeId] })
      qc.invalidateQueries({ queryKey: ['proposal', safeId, id] })
    },
  })
}
export function useExecuteProposal() {
  const safeId = useSafeId()
  const { data: safe } = useSafe(safeId)
  const { algodClient, activeAddress, transactionSigner } = useWallet()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, onSubmitted, onConfirmed }: ExecuteProposalInput) =>
      executeLiveProposal({ algodClient, safe: safe!, activeAddress, transactionSigner }, id, { onSubmitted, onConfirmed }),
    onSuccess: (_d, variables) => {
      qc.invalidateQueries({ queryKey: ['proposals', safeId] })
      qc.invalidateQueries({ queryKey: ['proposal', safeId, variables.id] })
      qc.invalidateQueries({ queryKey: ['safe-holdings', safeId] })
      qc.invalidateQueries({ queryKey: ['assets', safeId] })
      qc.invalidateQueries({ queryKey: ['treasury', safeId] })
    },
  })
}
