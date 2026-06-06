import type { ReactNode } from 'react'
export interface Column<T> { key: string; header: string; render: (row: T) => ReactNode; className?: string }
export function DataTable<T>({ columns, rows, empty = 'No data' }: { columns: Column<T>[]; rows: T[]; empty?: string }) {
  if (!rows.length) return <div className="py-10 text-center text-sm text-ink-500">{empty}</div>
  return (<table className="w-full text-sm"><thead><tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-ink-500">
    {columns.map(c => <th key={c.key} className={`px-3 py-3 font-medium ${c.className ?? ''}`}>{c.header}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-surface-border/60 last:border-0">
      {columns.map(c => <td key={c.key} className={`px-3 py-4 ${c.className ?? ''}`}>{c.render(r)}</td>)}</tr>)}</tbody></table>)
}
