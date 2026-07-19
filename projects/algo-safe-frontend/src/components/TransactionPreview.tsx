import type algosdk from 'algosdk'
import type { NetworkId, TxLine } from '../services/types'
import { AppCallDetails } from './AppCallDetails'
import { Icon } from './ui/Icon'

type Props = {
  lines: TxLine[]
  algodClient: algosdk.Algodv2
  network: NetworkId
}

export function TransactionPreview({ lines, algodClient, network }: Props) {
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div key={i} className="flex items-start gap-3 rounded-md border border-outline-variant bg-surface-container-lowest p-3">
          <Icon name="arrow_outward" className="text-error" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-on-surface">{l.summary}</div>
            <div className="font-mono text-xs text-on-surface-variant">{l.detail}</div>
            {l.type === 'appl' && l.appCall && <AppCallDetails appCall={l.appCall} algodClient={algodClient} network={network} />}
          </div>
        </div>
      ))}
    </div>
  )
}
