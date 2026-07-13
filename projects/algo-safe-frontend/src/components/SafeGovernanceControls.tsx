import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWallet } from '@txnlab/use-wallet-react'
import { useSnackbar } from 'notistack'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSafe, useSignerGroups } from '../hooks'
import { useSafeId } from '../lib/SafeContext'
import { proposeSetPaused, readSafePausedState } from '../services/algoSafeGovernance'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Icon } from './ui/Icon'

/**
 * Safe-wide governance controls: emergency pause / unpause (ADM_SET_PAUSED) and
 * a shortcut to create a new signer group. Pause blocks fund-moving proposals
 * only; governance stays live, so unpausing is always possible.
 */
export function SafeGovernanceControls() {
  const safeId = useSafeId()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { enqueueSnackbar } = useSnackbar()
  const { data: safe } = useSafe(safeId)
  const { data: signerGroups } = useSignerGroups()
  const { activeAddress, algodClient, transactionSigner, isReady } = useWallet()
  const [submitting, setSubmitting] = useState(false)

  const { data: pausedState } = useQuery({
    queryKey: ['safe-paused', safeId],
    enabled: !!safe?.appId,
    refetchInterval: 15000,
    queryFn: () => readSafePausedState({ algodClient, safe: safe! }),
  })

  // Group membership is not carried on the summary record; the contract will
  // reject a proposal from a non-member, so pick the first active admin group
  // and surface any rejection through the snackbar.
  const adminGroups = (signerGroups ?? []).filter((group) => group.isAdminGroup && group.active)
  const memberAdminGroup = adminGroups[0]
  const canSubmit = !!safe && !!isReady && !!activeAddress && !!transactionSigner && !!memberAdminGroup

  async function handleTogglePause() {
    if (!safe || !memberAdminGroup) return
    const nextPaused = !(pausedState?.paused ?? false)
    try {
      setSubmitting(true)
      const { proposalId, txId } = await proposeSetPaused(
        { algodClient, safe, activeAddress, transactionSigner },
        { adminGroupId: BigInt(memberAdminGroup.id), paused: nextPaused },
      )
      await queryClient.invalidateQueries({ queryKey: ['proposals', safeId] })
      enqueueSnackbar(nextPaused ? 'Pause proposal created' : 'Unpause proposal created', { variant: 'success' })
      navigate(`/safe/${safeId}/proposals/${proposalId}`, { state: { txId } })
    } catch (error) {
      enqueueSnackbar(error instanceof Error ? error.message : 'Failed to create pause proposal', { variant: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  const paused = pausedState?.paused ?? false

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              paused ? 'bg-error/15 text-error' : 'bg-primary/10 text-primary'
            }`}
          >
            <Icon name={paused ? 'pause_circle' : 'shield'} className="text-xl" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-on-surface">Safe Status</h3>
              <span
                className={`rounded-sm px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide ${
                  paused ? 'bg-error/15 text-error' : 'bg-primary/15 text-primary'
                }`}
              >
                {paused ? 'Paused' : 'Active'}
              </span>
            </div>
            <p className="mt-1 max-w-md text-sm text-on-surface-variant">
              {paused
                ? 'Fund-moving proposals are blocked. Governance stays live — create an unpause proposal to resume operations.'
                : 'Emergency pause halts all fund-moving proposals while keeping governance available. Use it if a signer key is suspected compromised.'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          <Button variant={paused ? 'primary' : 'secondary'} disabled={!canSubmit || submitting} onClick={handleTogglePause}>
            <Icon name={paused ? 'play_arrow' : 'pause'} className="text-base" />
            {submitting ? 'Creating Proposal…' : paused ? 'Propose Unpause' : 'Propose Pause'}
          </Button>
          <Button variant="ghost" onClick={() => navigate(`/safe/${safeId}/signer-groups/create`)}>
            <Icon name="group_add" className="text-base" />
            New Signer Group
          </Button>
        </div>
      </div>
      {!memberAdminGroup && (
        <p className="border-t border-outline-variant bg-surface-container-low px-5 py-3 text-xs text-warn">
          No active admin signer group is available for the connected wallet — governance actions are unavailable.
        </p>
      )}
    </Card>
  )
}
