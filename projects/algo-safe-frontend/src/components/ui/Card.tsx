import type { ReactNode } from 'react'
export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`rounded-md border border-outline-variant bg-surface-container p-6 ${className}`}>{children}</div>
)
