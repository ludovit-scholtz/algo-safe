// src/lib/SafeContext.tsx
import { createContext, useContext } from 'react'
import { useParams } from 'react-router-dom'

const SafeIdContext = createContext<string | undefined>(undefined)

/** Provides the active safeId (from the :safeId route param) to console pages. */
export function SafeProvider({ children }: { children: React.ReactNode }) {
  const { safeId } = useParams<{ safeId: string }>()
  return <SafeIdContext.Provider value={safeId}>{children}</SafeIdContext.Provider>
}

export function useSafeId(): string {
  const id = useContext(SafeIdContext)
  if (!id) throw new Error('useSafeId must be used within a SafeProvider (console route)')
  return id
}
