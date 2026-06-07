import { useRef, useState } from 'react'
import { ellipseAddress } from '../utils/ellipseAddress'
import { Icon } from './ui/Icon'

type AddressDisplayProps = {
  address?: string | null
  className?: string
  textClassName?: string
  buttonClassName?: string
  fallback?: string
}

function joinClasses(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(' ')
}

export function AddressDisplay({
  address,
  className,
  textClassName,
  buttonClassName,
  fallback = '—',
}: AddressDisplayProps) {
  const [copied, setCopied] = useState(false)
  const resetTimerRef = useRef<number | null>(null)

  async function handleCopy(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()

    if (!address) return

    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)

      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current)
      }

      resetTimerRef.current = window.setTimeout(() => {
        setCopied(false)
        resetTimerRef.current = null
      }, 1600)
    } catch {
      setCopied(false)
    }
  }

  if (!address) {
    return <span className={joinClasses('font-mono', textClassName)}>{fallback}</span>
  }

  return (
    <span className={joinClasses('inline-flex min-w-0 items-center gap-2', className)}>
      <span className={joinClasses('truncate font-mono', textClassName)} title={address}>
        {ellipseAddress(address)}
      </span>
      <button
        type="button"
        title={copied ? `Copied ${address}` : `Copy ${address}`}
        aria-label={copied ? 'Address copied' : 'Copy address'}
        onClick={(event) => void handleCopy(event)}
        className={joinClasses(
          'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-outline-variant text-on-surface-variant transition hover:border-primary/40 hover:text-primary',
          buttonClassName,
        )}
      >
        <Icon name={copied ? 'check' : 'content_copy'} className="text-[14px]" />
      </button>
    </span>
  )
}