// src/pages/AgentPoliciesPage.tsx
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useSnackbar } from 'notistack'
import { useAgents, useProposals, useQuantozTransactions, usePolicy, useProposePolicyChange } from '../hooks'
import { Icon, StatusBadge, Skeleton, Button } from '../components/ui'
import { fmtEur, fmtNum, shortAddr } from '../lib/format'
import type { Agent, Policy } from '../services/types'

export const AgentPoliciesPage = () => {
  const { enqueueSnackbar } = useSnackbar()
  const { data: agents, isLoading: agentsLoading } = useAgents()
  const { data: proposals } = useProposals()
  const { data: transactions } = useQuantozTransactions()
  const proposePolicyChange = useProposePolicyChange()

  // Default-select first agent
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (agents && agents.length > 0 && !selectedId) {
      setSelectedId(agents[0].id)
    }
  }, [agents, selectedId])

  const { data: policy, isLoading: policyLoading } = usePolicy(selectedId)

  // Local editable policy state
  const [editedPolicy, setEditedPolicy] = useState<Partial<Policy>>({})
  const [newAllowEntry, setNewAllowEntry] = useState('')
  const [localAllowlist, setLocalAllowlist] = useState<string[]>([])
  const [search, setSearch] = useState('')

  // Sync local state when policy loads or selection changes
  useEffect(() => {
    if (policy) {
      setEditedPolicy({
        dailyLimit: policy.dailyLimit,
        monthlyLimit: policy.monthlyLimit,
        minIntervalSec: policy.minIntervalSec,
        maxTxPerMin: policy.maxTxPerMin,
      })
      setLocalAllowlist(policy.allowlist ?? [])
    }
  }, [policy])

  // Computed stats
  const activeAgentsCount = (agents ?? []).filter((a: Agent) => a.status === 'active').length

  const volume24h = (transactions ?? []).reduce((sum, tx) => sum + (tx.amount ?? 0), 0)

  const governanceCount = (proposals ?? []).filter(
    p => p.status === 'pending' || p.status === 'blocked'
  ).length

  const selectedAgent = (agents ?? []).find((a: Agent) => a.id === selectedId)

  const handleDiscard = () => {
    if (policy) {
      setEditedPolicy({
        dailyLimit: policy.dailyLimit,
        monthlyLimit: policy.monthlyLimit,
        minIntervalSec: policy.minIntervalSec,
        maxTxPerMin: policy.maxTxPerMin,
      })
      setLocalAllowlist(policy.allowlist ?? [])
    }
  }

  const handleProposeChanges = () => {
    if (!selectedId) return
    proposePolicyChange.mutate(
      {
        agentId: selectedId,
        policy: {
          ...editedPolicy,
          allowlist: localAllowlist,
        },
      },
      {
        onSuccess: () => {
          enqueueSnackbar('Policy change proposed', { variant: 'success' })
        },
        onError: () => {
          enqueueSnackbar('Failed to propose policy change', { variant: 'error' })
        },
      }
    )
  }

  const addAllowEntry = () => {
    const trimmed = newAllowEntry.trim()
    if (!trimmed) return
    if (!localAllowlist.includes(trimmed)) {
      setLocalAllowlist(prev => [...prev, trimmed])
    }
    setNewAllowEntry('')
  }

  const filteredAgents = (agents ?? []).filter((a: Agent) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (a.alias ?? '').toLowerCase().includes(q) ||
      (a.address ?? '').toLowerCase().includes(q)
    )
  })

  const removeAllowEntry = (entry: string) => {
    setLocalAllowlist(prev => prev.filter(e => e !== entry))
  }

  return (
    <div className="max-w-[1440px] mx-auto flex flex-col gap-6">

      {/* Page Header */}
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-3xl font-bold text-ink-900 tracking-tight mb-1">Agent Policies</h2>
          <p className="text-sm text-ink-500">
            Configure spending limits, allowlists, and execution constraints for automated actors.
          </p>
        </div>
        <div className="flex items-center gap-2 bg-surface-muted px-4 py-2 rounded-lg border border-surface-border shadow-sm">
          <Icon name="security" className="text-brand-600 text-[20px]" />
          <span className="text-xs text-ink-700">
            Global Policy Mode: <strong className="text-ink-900">Strict</strong>
          </span>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Active Agents */}
        <div className="rounded-xl border border-surface-border bg-white p-5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-widest text-ink-500">Active Agents</span>
            <Icon name="smart_toy" className="text-ink-400 text-[22px]" />
          </div>
          <div>
            {agentsLoading ? (
              <Skeleton className="h-12 w-16" />
            ) : (
              <span className="text-5xl font-bold text-ink-900">{activeAgentsCount}</span>
            )}
            <p className="text-xs text-ink-500 mt-1">Under active management</p>
          </div>
        </div>

        {/* 24h Volume */}
        <div className="rounded-xl border border-surface-border bg-white p-5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-widest text-ink-500">24h Volume Disbursed</span>
            <Icon name="payments" className="text-ink-400 text-[22px]" />
          </div>
          <div>
            <span className="text-2xl font-bold text-ink-900">
              {volume24h > 0 ? fmtEur(volume24h) : '45,200 '}
              {volume24h === 0 && <span className="text-base font-semibold text-ink-500">EURD</span>}
            </span>
            <div className="flex items-center gap-1 mt-1 text-ok">
              <Icon name="trending_up" className="text-[16px]" />
              <span className="text-xs font-medium">12% of total limit</span>
            </div>
          </div>
        </div>

        {/* Governance */}
        <div className="rounded-xl border border-surface-border bg-white p-5 flex flex-col justify-between shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-28 h-28 bg-brand-50 rounded-bl-full opacity-30 -z-0" />
          <div className="flex items-center justify-between mb-3 relative z-10">
            <span className="text-xs font-semibold uppercase tracking-widest text-ink-500">Governance</span>
            <Icon name="gavel" className="text-ink-400 text-[22px]" />
          </div>
          <div className="relative z-10">
            <span className="text-2xl font-bold text-ink-900">{governanceCount}</span>
            <p className="text-xs text-ink-500 mt-1">Pending policy revisions</p>
            <Link
              to="/proposals"
              className="mt-3 text-xs font-semibold text-brand-600 hover:text-brand-700 transition-colors flex items-center gap-1 self-start"
            >
              Review Proposals <Icon name="arrow_forward" className="text-[14px]" />
            </Link>
          </div>
        </div>
      </div>

      {/* Master-Detail: Agents Table + Policy Config */}
      <div className="grid grid-cols-12 gap-6">

        {/* LEFT: Deployed Agents Table */}
        <div className="col-span-12 xl:col-span-7 rounded-xl border border-surface-border bg-white overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-surface-border bg-surface-muted flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink-900">Deployed Agents</h3>
            <div className="relative">
              <Icon name="search" className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-400 text-[18px]" />
              <input
                type="text"
                placeholder="Search ID or Name"
                className="pl-8 pr-3 py-1.5 text-xs bg-white border border-surface-border rounded focus:border-brand-500 focus:outline-none w-44 transition-all"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            {agentsLoading ? (
              <div className="p-5 flex flex-col gap-3">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-surface-border">
                    <th className="px-5 py-3 text-xs font-semibold text-ink-500 uppercase tracking-wide">Identifier</th>
                    <th className="px-5 py-3 text-xs font-semibold text-ink-500 uppercase tracking-wide">Primary Asset</th>
                    <th className="px-5 py-3 text-xs font-semibold text-ink-500 uppercase tracking-wide text-right">Daily Limit</th>
                    <th className="px-5 py-3 text-xs font-semibold text-ink-500 uppercase tracking-wide">Status</th>
                  </tr>
                </thead>
                <tbody className="text-sm text-ink-900">
                  {filteredAgents.map((agent: Agent) => {
                    const isSelected = agent.id === selectedId
                    return (
                      <tr
                        key={agent.id}
                        onClick={() => setSelectedId(agent.id)}
                        className={`border-b border-surface-border cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-brand-50'
                            : 'hover:bg-surface-muted'
                        }`}
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                agent.status === 'active'
                                  ? 'bg-ok'
                                  : agent.status === 'pending_review'
                                  ? 'bg-warn'
                                  : 'bg-ink-400'
                              }`}
                            />
                            <div>
                              <p className={`font-semibold text-sm ${isSelected ? 'text-brand-700' : 'text-ink-900'}`}>
                                {agent.alias}
                              </p>
                              <p className="font-mono text-xs text-ink-400 mt-0.5">
                                {shortAddr(agent.address)}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 font-medium text-sm">{agent.primaryAsset}</td>
                        <td className="px-5 py-4 text-right">
                          <span className="block font-mono text-sm">{fmtNum(agent.dailyLimit)}</span>
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge status={agent.status} />
                        </td>
                      </tr>
                    )
                  })}
                  {filteredAgents.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-10 text-center text-sm text-ink-500">
                        {search ? 'No agents match your search' : 'No agents deployed'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* RIGHT: Policy Configuration Panel */}
        <div className="col-span-12 xl:col-span-5 flex flex-col gap-4">
          <div className="rounded-xl border border-surface-border bg-white shadow-sm p-5">

            {/* Form Header */}
            <div className="flex items-start justify-between border-b border-surface-border pb-4 mb-5">
              <div>
                <h3 className="text-base font-semibold text-ink-900">Policy Configuration</h3>
                <p className="text-xs text-ink-500 mt-0.5">
                  {selectedAgent
                    ? <>Editing rules for <strong className="text-ink-700">{selectedAgent.alias}</strong></>
                    : 'Select an agent to configure'}
                </p>
              </div>
              <button className="text-ink-400 hover:text-ink-700 transition-colors">
                <Icon name="more_vert" className="text-[20px]" />
              </button>
            </div>

            {!selectedId ? (
              <div className="py-10 text-center text-sm text-ink-500">
                Select an agent from the table to view and edit its policy.
              </div>
            ) : policyLoading ? (
              <div className="flex flex-col gap-4">
                {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : (
              <div className="space-y-5">

                {/* Spending Limits */}
                <div>
                  <h4 className="text-xs font-semibold text-ink-900 mb-3 flex items-center gap-1">
                    <Icon name="tune" className="text-[16px] text-ink-400" />
                    Spending Limits
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-ink-500 mb-1">
                        Daily Limit ({selectedAgent?.primaryAsset ?? 'EURD'})
                      </label>
                      <input
                        type="number"
                        className="w-full bg-surface-muted border border-surface-border rounded-lg px-3 py-2 text-sm font-mono text-ink-900 focus:border-brand-500 focus:outline-none text-right"
                        value={editedPolicy.dailyLimit ?? ''}
                        onChange={e => setEditedPolicy(prev => ({ ...prev, dailyLimit: Number(e.target.value) }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-ink-500 mb-1">
                        Monthly Limit ({selectedAgent?.primaryAsset ?? 'EURD'})
                      </label>
                      <input
                        type="number"
                        className="w-full bg-surface-muted border border-surface-border rounded-lg px-3 py-2 text-sm font-mono text-ink-900 focus:border-brand-500 focus:outline-none text-right"
                        value={editedPolicy.monthlyLimit ?? ''}
                        onChange={e => setEditedPolicy(prev => ({ ...prev, monthlyLimit: Number(e.target.value) }))}
                      />
                    </div>
                  </div>

                  {/* Daily Cycle Usage Bar */}
                  {policy && (
                    <div className="mt-3 bg-surface-muted p-3 rounded border border-surface-border">
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-ink-500">Daily Cycle Usage</span>
                        <span className="font-mono text-ink-900">
                          {fmtNum(policy.dailyUsed)} / {fmtNum(policy.dailyLimit)} {selectedAgent?.primaryAsset}
                        </span>
                      </div>
                      <div className="w-full h-2 bg-surface-border rounded-full overflow-hidden">
                        <div
                          className="bg-brand-600 h-full transition-all"
                          style={{
                            width: `${Math.min(100, (policy.dailyUsed / policy.dailyLimit) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Velocity & Cooldown */}
                <div>
                  <h4 className="text-xs font-semibold text-ink-900 mb-3 flex items-center gap-1">
                    <Icon name="speed" className="text-[16px] text-ink-400" />
                    Velocity &amp; Cooldown
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-ink-500 mb-1">Min. Cooldown (Seconds)</label>
                      <input
                        type="number"
                        className="w-full bg-surface-muted border border-surface-border rounded-lg px-3 py-2 text-sm font-mono text-ink-900 focus:border-brand-500 focus:outline-none"
                        value={editedPolicy.minIntervalSec ?? ''}
                        onChange={e => setEditedPolicy(prev => ({ ...prev, minIntervalSec: Number(e.target.value) }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-ink-500 mb-1">Max Txs per Minute</label>
                      <input
                        type="number"
                        className="w-full bg-surface-muted border border-surface-border rounded-lg px-3 py-2 text-sm font-mono text-ink-900 focus:border-brand-500 focus:outline-none"
                        value={editedPolicy.maxTxPerMin ?? ''}
                        onChange={e => setEditedPolicy(prev => ({ ...prev, maxTxPerMin: Number(e.target.value) }))}
                      />
                    </div>
                  </div>
                </div>

                {/* Destination Allowlist */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-semibold text-ink-900 flex items-center gap-1">
                      <Icon name="list_alt" className="text-[16px] text-ink-400" />
                      Destination Allowlist
                    </h4>
                  </div>

                  <div className="space-y-1.5 bg-surface-muted border border-surface-border p-2 rounded-lg min-h-[80px]">
                    {localAllowlist.map((entry, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between bg-white border border-surface-border rounded px-3 py-1.5"
                      >
                        <div className="flex items-center gap-2">
                          <Icon name="data_object" className="text-[16px] text-brand-600" />
                          <span className="font-mono text-xs text-ink-900 truncate max-w-[180px]">{entry}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAllowEntry(entry)}
                          className="text-ink-400 hover:text-danger transition-colors"
                        >
                          <Icon name="close" className="text-[16px]" />
                        </button>
                      </div>
                    ))}
                    {localAllowlist.length === 0 && (
                      <p className="text-xs text-ink-400 text-center py-3">No allowlist entries</p>
                    )}
                  </div>

                  {/* Add Entry Input */}
                  <div className="flex gap-2 mt-2">
                    <input
                      type="text"
                      placeholder="App ID or address..."
                      className="flex-1 text-xs font-mono border border-surface-border rounded-lg px-3 py-2 focus:border-brand-500 focus:outline-none bg-white"
                      value={newAllowEntry}
                      onChange={e => setNewAllowEntry(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addAllowEntry())}
                    />
                    <button
                      type="button"
                      onClick={addAllowEntry}
                      className="px-3 py-2 text-xs font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
                    >
                      Add
                    </button>
                  </div>
                </div>

                {/* Multi-Sig Warning */}
                {policy?.multiSigRequired && (
                  <div className="bg-brand-50 border border-brand-100 rounded p-3 flex items-start gap-2">
                    <Icon name="info" className="text-brand-600 text-[20px] mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-ink-900">Multi-Sig Required</p>
                      <p className="text-xs text-ink-500 mt-0.5">
                        Modifying this policy requires <strong>2 of 3</strong> treasury signatures. Saving will
                        generate a new proposal.
                      </p>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="pt-4 border-t border-surface-border flex items-center justify-end gap-3">
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={handleDiscard}
                  >
                    Discard
                  </Button>
                  <Button
                    variant="primary"
                    type="button"
                    onClick={handleProposeChanges}
                    disabled={proposePolicyChange.isPending}
                  >
                    {proposePolicyChange.isPending ? 'Proposing…' : 'Propose Changes'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
