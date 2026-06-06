import type { ReactNode } from 'react'
import { Card } from './Card'
export const StatCard = ({ label, value, sub, right }: { label: string; value: ReactNode; sub?: ReactNode; right?: ReactNode }) => (
  <Card><div className="flex items-start justify-between"><div className="font-mono text-xs font-medium uppercase tracking-wide text-on-surface-variant">{label}</div>{right}</div>
    <div className="mt-3 text-3xl font-bold text-on-surface">{value}</div>{sub && <div className="mt-1 text-xs text-on-surface-variant">{sub}</div>}</Card>
)
