import type { ReactNode } from 'react'
import { Card } from './Card'
export const StatCard = ({ label, value, sub, right }: { label: string; value: ReactNode; sub?: ReactNode; right?: ReactNode }) => (
  <Card><div className="flex items-start justify-between"><div className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</div>{right}</div>
    <div className="mt-3 text-3xl font-bold text-ink-900">{value}</div>{sub && <div className="mt-1 text-xs text-ink-500">{sub}</div>}</Card>
)
