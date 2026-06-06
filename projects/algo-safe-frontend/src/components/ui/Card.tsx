import type { ReactNode } from 'react'
export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) =>
  <div className={`rounded-xl border border-surface-border bg-white p-6 ${className}`}>{children}</div>
