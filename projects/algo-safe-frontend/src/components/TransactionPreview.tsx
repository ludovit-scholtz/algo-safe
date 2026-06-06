import type { TxLine } from '../services/types'
import { Icon } from './ui/Icon'

export function TransactionPreview({ lines }: { lines: TxLine[] }) {
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div key={i} className="flex items-start gap-3 rounded-md border border-outline-variant bg-surface-container-lowest p-3">
          <Icon name="arrow_outward" className="text-error" />
          <div><div className="font-medium text-on-surface">{l.summary}</div><div className="font-mono text-xs text-on-surface-variant">{l.detail}</div></div>
        </div>
      ))}
    </div>
  )
}
