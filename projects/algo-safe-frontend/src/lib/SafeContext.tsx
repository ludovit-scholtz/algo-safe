// src/lib/SafeContext.tsx
import { useNetwork } from '@txnlab/use-wallet-react'
import { createContext, useContext, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { normalizeNetworkId, resolveCanonicalSafeId } from './safeRegistry'

const SafeIdContext = createContext<string | undefined>(undefined)

/** Provides the active safeId (from the :safeId route param) to console pages. */
export function SafeProvider({ children }: { children: React.ReactNode }) {
  const { safeId } = useParams<{ safeId: string }>()
  const navigate = useNavigate()
  const { activeNetwork } = useNetwork()
  const resolvedSafeId = safeId ? resolveCanonicalSafeId(safeId, normalizeNetworkId(activeNetwork)) : safeId

  useEffect(() => {
    if (!safeId || !resolvedSafeId || safeId === resolvedSafeId) return
    navigate(`/safe/${resolvedSafeId}`, { replace: true })
  }, [navigate, resolvedSafeId, safeId])

  return <SafeIdContext.Provider value={resolvedSafeId}>{children}</SafeIdContext.Provider>
}

export function useSafeId(): string {
  const id = useContext(SafeIdContext)
  if (!id) throw new Error('useSafeId must be used within a SafeProvider (console route)')
  return id
}
