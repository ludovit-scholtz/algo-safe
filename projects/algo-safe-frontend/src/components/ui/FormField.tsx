import type { ReactNode } from 'react'
export const FormField = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <label className="block"><div className="mb-1 text-sm font-medium text-ink-700">{label}</div>{children}
    {hint && <div className="mt-1 text-xs text-ink-500">{hint}</div>}</label>
)
export const inputCls = 'w-full rounded-lg border border-surface-border bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none'
