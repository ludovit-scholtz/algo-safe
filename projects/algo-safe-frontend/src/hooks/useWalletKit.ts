import type { ProposalTypes, SessionTypes } from '@walletconnect/types'
import { useCallback, useEffect, useState } from 'react'
import {
  approveWalletConnectSession,
  disconnectWalletConnectSession,
  getWalletKit,
  pairWalletConnect,
  rejectWalletConnectRequest,
  rejectWalletConnectSession,
  respondWalletConnectRequest,
} from '../services/walletKitService'

export type PendingWalletConnectRequest = {
  topic: string
  id: number
  chainId: string
  method: string
  params: unknown
}

export type WalletKitState = {
  sessions: SessionTypes.Struct[]
  pendingProposal: ProposalTypes.Struct | null
  pendingRequests: PendingWalletConnectRequest[]
}

function toPendingRequest(struct: {
  topic: string
  id: number
  params: { request: { method: string; params: unknown }; chainId: string }
}): PendingWalletConnectRequest {
  return {
    topic: struct.topic,
    id: struct.id,
    chainId: struct.params.chainId,
    method: struct.params.request.method,
    params: struct.params.request.params,
  }
}

/**
 * React wrapper around the WalletKit singleton in walletKitService — refreshes
 * sessions/proposals/requests from the SDK's own pending-state getters on every
 * relevant event rather than hand-rolling state transitions.
 */
export function useWalletKit() {
  const [state, setState] = useState<WalletKitState>({ sessions: [], pendingProposal: null, pendingRequests: [] })
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const walletKit = await getWalletKit()
    const proposals = Object.values(walletKit.getPendingSessionProposals())
    setState({
      sessions: Object.values(walletKit.getActiveSessions()),
      pendingProposal: proposals[0] ?? null,
      pendingRequests: walletKit.getPendingSessionRequests().map(toPendingRequest),
    })
  }, [])

  useEffect(() => {
    let disposed = false

    void getWalletKit()
      .then(async (walletKit) => {
        if (disposed) return
        const onChange = () => void refresh()
        walletKit.on('session_proposal', onChange)
        walletKit.on('session_request', onChange)
        walletKit.on('session_delete', onChange)
        walletKit.on('session_request_expire', onChange)
        walletKit.on('proposal_expire', onChange)
        await refresh()
        setIsReady(true)
        return () => {
          walletKit.off('session_proposal', onChange)
          walletKit.off('session_request', onChange)
          walletKit.off('session_delete', onChange)
          walletKit.off('session_request_expire', onChange)
          walletKit.off('proposal_expire', onChange)
        }
      })
      .catch((walletKitError: unknown) => {
        setError(walletKitError instanceof Error ? walletKitError.message : 'Failed to initialize WalletConnect.')
      })

    return () => {
      disposed = true
    }
  }, [refresh])

  const pair = useCallback(async (uri: string) => {
    setError(null)
    try {
      await pairWalletConnect(uri)
    } catch (pairError) {
      setError(pairError instanceof Error ? pairError.message : 'Failed to pair with the WalletConnect URI.')
    }
  }, [])

  const approveSession = useCallback(
    async (proposal: ProposalTypes.Struct, caipChainId: string, safeAddress: string) => {
      setError(null)
      try {
        await approveWalletConnectSession(proposal, caipChainId, safeAddress)
        await refresh()
      } catch (approveError) {
        setError(approveError instanceof Error ? approveError.message : 'Failed to approve the session proposal.')
      }
    },
    [refresh],
  )

  const rejectSession = useCallback(
    async (proposalId: number) => {
      setError(null)
      try {
        await rejectWalletConnectSession(proposalId)
        await refresh()
      } catch (rejectSessionError) {
        setError(rejectSessionError instanceof Error ? rejectSessionError.message : 'Failed to reject the session proposal.')
      }
    },
    [refresh],
  )

  const disconnectSession = useCallback(
    async (topic: string) => {
      setError(null)
      try {
        await disconnectWalletConnectSession(topic)
        await refresh()
      } catch (disconnectError) {
        setError(disconnectError instanceof Error ? disconnectError.message : 'Failed to disconnect the session.')
      }
    },
    [refresh],
  )

  const respondToRequest = useCallback(
    async (topic: string, id: number, result: unknown) => {
      await respondWalletConnectRequest(topic, id, result)
      await refresh()
    },
    [refresh],
  )

  const rejectRequest = useCallback(
    async (topic: string, id: number, message: string) => {
      await rejectWalletConnectRequest(topic, id, message)
      await refresh()
    },
    [refresh],
  )

  return { ...state, isReady, error, pair, approveSession, rejectSession, disconnectSession, respondToRequest, rejectRequest }
}
