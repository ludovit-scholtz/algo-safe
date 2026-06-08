import type { ReactNode } from 'react'
export const FormField = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <label className="block">
    <div className="mb-1 font-mono text-xs font-medium uppercase tracking-wide text-on-surface-variant">{label}</div>
    {children}
    {hint && <div className="mt-1 text-xs text-on-surface-variant">{hint}</div>}
  </label>
)
export const inputCls =
  'w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30'
