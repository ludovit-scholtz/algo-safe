// src/components/AppCallDetails.tsx
//
// Renders a verified, human-friendly breakdown of an application-call
// transaction's ABI method and arguments, using the self-hosted ARC-56
// registry (see `verifyAppCall` in the `algo-safe` package). The whole point
// of this component is to make it obvious — not just possible — when a call
// is unverified or doesn't match its claimed method, so the banner/tag
// treatment for each state below is deliberately distinct and never reused
// across states (see the state machine in `arc56.ts`).
import { useEffect, useState, type ReactNode } from 'react'
import type algosdk from 'algosdk'
import {
  decodeAppCallArgs,
  fetchCandidateMethod,
  verifyAppCall,
  type AbiSignatureCandidate,
  type AppCallVerification,
  type Arc56Method,
  type DecodedArg,
} from 'algo-safe'
import type { NetworkId, TxLine } from '../services/types'
import { env } from '../lib/env'
import { resolveAssetMetadata, type AssetMetadata } from '../lib/assetMetadata'
import { assetExplorerUrl, appExplorerUrl } from '../lib/explorer'
import { shortAddr } from '../lib/format'
import { Icon } from './ui/Icon'

type AppCall = NonNullable<TxLine['appCall']>

type Props = {
  appCall: AppCall
  algodClient: algosdk.Algodv2
  network: NetworkId
}

const ASSET_DESC_RE = /\basset\b/i
const APP_DESC_RE = /\bapp(lication)?\b/i

function formatAbiValue(value: unknown): string {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return value
  if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString('hex')}`
  if (Array.isArray(value)) return `[${value.map(formatAbiValue).join(', ')}]`
  return String(value)
}

// ---------------------------------------------------------------------------
// Banner — the only place the "verified" (green) visual treatment is
// reachable from. Every other tone is styled distinctly on purpose.
// ---------------------------------------------------------------------------

type Tone = 'success' | 'warn' | 'danger' | 'neutral'

const TONE_STYLES: Record<Tone, string> = {
  success: 'border-primary/30 bg-primary/10',
  warn: 'border-warn/30 bg-warn/10',
  danger: 'border-error/40 bg-error-container/20',
  neutral: 'border-outline-variant bg-surface-container-lowest',
}
const TONE_ICON_COLOR: Record<Tone, string> = {
  success: 'text-primary',
  warn: 'text-warn',
  danger: 'text-error',
  neutral: 'text-on-surface-variant',
}

function Banner({ tone, icon, title, children }: { tone: Tone; icon: string; title: string; children?: ReactNode }) {
  return (
    <div className={`rounded-md border px-3 py-2 text-xs ${TONE_STYLES[tone]}`}>
      <div className="flex items-start gap-2">
        <Icon name={icon} className={`text-sm mt-0.5 flex-shrink-0 ${TONE_ICON_COLOR[tone]}`} />
        <div className="min-w-0">
          <div className="font-semibold text-on-surface">{title}</div>
          {children && <div className="mt-0.5 leading-relaxed text-on-surface-variant">{children}</div>}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reference value rendering — explorer link (when the network's host is
// configured) + best-effort live ASA/App metadata.
// ---------------------------------------------------------------------------

function AssetRefValue({ assetId, network, algodClient }: { assetId: bigint; network: NetworkId; algodClient: algosdk.Algodv2 }) {
  const [meta, setMeta] = useState<AssetMetadata | 'loading'>('loading')

  useEffect(() => {
    let cancelled = false
    setMeta('loading')
    void resolveAssetMetadata(algodClient, Number(assetId), network).then((resolved) => {
      if (!cancelled) setMeta(resolved)
    })
    return () => {
      cancelled = true
    }
  }, [assetId, algodClient, network])

  const url = assetExplorerUrl(assetId, network)

  return (
    <span>
      Asset{' '}
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="font-mono text-primary underline">
          {assetId.toString()}
        </a>
      ) : (
        <span className="font-mono">{assetId.toString()}</span>
      )}
      {meta !== 'loading' && (
        <span className="text-on-surface-variant">
          {' '}
          · {meta.name} ({meta.symbol})
        </span>
      )}
    </span>
  )
}

function AppRefValue({ appId, network }: { appId: bigint; network: NetworkId }) {
  const url = appExplorerUrl(appId, network)
  return (
    <span>
      App{' '}
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="font-mono text-primary underline">
          {appId.toString()}
        </a>
      ) : (
        <span className="font-mono">{appId.toString()}</span>
      )}
    </span>
  )
}

function renderArgValue(arg: DecodedArg, network: NetworkId, algodClient: algosdk.Algodv2): ReactNode {
  if (arg.kind === 'transaction') {
    return (
      <span className="italic text-on-surface-variant">
        Consumes a separate &quot;{arg.txnType}&quot; transaction earlier in this atomic group — not shown here.
      </span>
    )
  }

  if (arg.kind === 'unsupported') {
    return <span className="text-error">Could not decode — {arg.reason}</span>
  }

  if (arg.kind === 'reference') {
    if (arg.unresolved || arg.resolvedId === undefined) {
      return (
        <span className="text-warn">
          Unresolved reference (index {arg.index}) — {arg.reason}
        </span>
      )
    }
    if (arg.refType === 'asset') return <AssetRefValue assetId={arg.resolvedId as bigint} network={network} algodClient={algodClient} />
    if (arg.refType === 'application') return <AppRefValue appId={arg.resolvedId as bigint} network={network} />
    return <span className="font-mono">{shortAddr(String(arg.resolvedId), 6)}</span>
  }

  // kind === 'value'
  const looksLikeAssetRef = arg.type === 'uint64' && !!arg.desc && ASSET_DESC_RE.test(arg.desc) && typeof arg.value === 'bigint'
  const looksLikeAppRef = arg.type === 'uint64' && !!arg.desc && APP_DESC_RE.test(arg.desc) && typeof arg.value === 'bigint'

  if (looksLikeAssetRef) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <AssetRefValue assetId={arg.value as bigint} network={network} algodClient={algodClient} />
        <span className="rounded bg-warn/15 px-1 text-[10px] font-medium text-warn">inferred from description</span>
      </span>
    )
  }
  if (looksLikeAppRef) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <AppRefValue appId={arg.value as bigint} network={network} />
        <span className="rounded bg-warn/15 px-1 text-[10px] font-medium text-warn">inferred from description</span>
      </span>
    )
  }

  return <span className="font-mono break-all">{formatAbiValue(arg.value)}</span>
}

function ArgList({ args, network, algodClient }: { args: DecodedArg[]; network: NetworkId; algodClient: algosdk.Algodv2 }) {
  if (args.length === 0) return null
  return (
    <div className="mt-1.5 space-y-1.5">
      {args.map((arg, i) => {
        const typeLabel = arg.kind === 'value' ? arg.type : arg.kind === 'reference' ? arg.refType : arg.kind === 'transaction' ? arg.txnType : arg.type
        return (
          <div key={i} className="rounded border border-outline-variant bg-surface-container-lowest px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-on-surface">{arg.name ?? '(unnamed)'}</span>
              <span className="font-mono text-[10px] text-on-surface-variant">{typeLabel}</span>
            </div>
            {arg.desc && <p className="mt-0.5 text-[11px] text-on-surface-variant">{arg.desc}</p>}
            <div className="mt-1 text-xs text-on-surface">{renderArgValue(arg, network, algodClient)}</div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Unverified-candidates view — no spec for this exact contract, but the
// selector matches a method declared elsewhere. Every borrowed description
// stays permanently tagged as unverified once applied.
// ---------------------------------------------------------------------------

function CandidateRow({
  candidate,
  selector,
  onApply,
}: {
  candidate: AbiSignatureCandidate
  selector: Uint8Array
  onApply: (method: Arc56Method) => void
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'not-found' | { method: Arc56Method }>('idle')

  async function handleInspect() {
    setStatus('loading')
    const result = await fetchCandidateMethod(env.arc56RegistryUrl, candidate, selector)
    setStatus(result ? { method: result.method } : 'not-found')
  }

  return (
    <div className="rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-on-surface">{shortAddr(candidate.approvalHash, 8)}</span>
        {status === 'idle' && (
          <button type="button" className="font-medium text-primary underline" onClick={() => void handleInspect()}>
            Inspect
          </button>
        )}
      </div>
      {candidate.signature && <div className="mt-0.5 font-mono text-[11px] text-on-surface-variant">{candidate.signature}</div>}
      {status === 'loading' && <p className="mt-1 text-on-surface-variant">Loading…</p>}
      {status === 'not-found' && (
        <p className="mt-1 text-error">Could not confirm a matching method in this candidate&apos;s own published spec.</p>
      )}
      {typeof status === 'object' && (
        <div className="mt-1.5 space-y-1.5">
          {status.method.desc && <p className="text-on-surface-variant">{status.method.desc}</p>}
          <button
            type="button"
            className="rounded bg-warn/15 px-2 py-1 text-[11px] font-semibold text-warn"
            onClick={() => onApply(status.method)}
          >
            Apply these field descriptions (unverified)
          </button>
        </div>
      )}
    </div>
  )
}

function CandidatesView({
  verification,
  appCall,
  network,
  algodClient,
}: {
  verification: Extract<AppCallVerification, { status: 'unverified-candidates' }>
  appCall: AppCall
  network: NetworkId
  algodClient: algosdk.Algodv2
}) {
  const [applied, setApplied] = useState<{ candidate: AbiSignatureCandidate; method: Arc56Method } | null>(null)
  const candidates = verification.candidates.slice(0, 5)
  const selector = appCall.appArgs[0]

  return (
    <div className="mt-2 space-y-2">
      <Banner tone="warn" icon="gpp_maybe" title="Not verified for this exact contract">
        No ARC-56 spec is published for this contract&apos;s exact bytecode, but {verification.candidates.length} other published
        contract{verification.candidates.length === 1 ? '' : 's'} declare
        {verification.candidates.length === 1 ? 's' : ''} a method with the same selector (
        <code className="font-mono">{verification.selectorHex}</code>). You may inspect and optionally borrow field descriptions from
        one of them — this is never a guarantee that this app call behaves the same way.
      </Banner>

      {applied && (
        <Banner tone="danger" icon="warning" title="Unverified — descriptions borrowed from a different contract">
          Showing <code className="font-mono">{applied.method.name}</code> as published by contract hash{' '}
          <code className="font-mono">{shortAddr(applied.candidate.approvalHash, 8)}</code> — this has NOT been confirmed to match the
          contract actually being called here.
          <ArgList args={decodeAppCallArgs(applied.method, appCall)} network={network} algodClient={algodClient} />
        </Banner>
      )}

      <div className="space-y-1.5">
        {candidates.map((candidate) => (
          <CandidateRow
            key={candidate.approvalHash}
            candidate={candidate}
            selector={selector}
            onApply={(method) => setApplied({ candidate, method })}
          />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Top-level component
// ---------------------------------------------------------------------------

export function AppCallDetails({ appCall, algodClient, network }: Props) {
  const [state, setState] = useState<'loading' | AppCallVerification>('loading')

  useEffect(() => {
    let cancelled = false
    setState('loading')
    void verifyAppCall(algodClient, appCall, env.arc56RegistryUrl).then((result) => {
      if (!cancelled) setState(result)
    })
    return () => {
      cancelled = true
    }
  }, [appCall, algodClient])

  if (state === 'loading') {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-on-surface-variant">
        <Icon name="sync" className="animate-spin text-sm" /> Checking ARC-56 registry…
      </div>
    )
  }

  switch (state.status) {
    case 'not-an-abi-call':
      return (
        <div className="mt-2">
          <Banner tone="neutral" icon="info" title="Not an ABI method call">
            No 4-byte method selector is present in the first argument — nothing to verify against the ARC-56 registry.
          </Banner>
        </div>
      )

    case 'app-lookup-failed':
      return (
        <div className="mt-2">
          <Banner tone="warn" icon="error" title="Could not read this app from the network">
            {state.error}
          </Banner>
        </div>
      )

    case 'registry-unreachable':
      return (
        <div className="mt-2">
          <Banner tone="warn" icon="wifi_off" title="Could not reach the ARC-56 registry">
            Verification status is unknown due to a network error — this is <strong>not</strong> confirmation that the call is
            unverified. {state.error}
          </Banner>
        </div>
      )

    case 'no-spec':
      return (
        <div className="mt-2">
          <Banner tone="warn" icon="help" title="Not published in the ARC-56 registry">
            This contract&apos;s exact bytecode (hash <code className="font-mono">{shortAddr(state.approvalHash, 8)}</code>) has no
            published ARC-56 spec, and no other published contract declares a method with selector{' '}
            <code className="font-mono">{state.selectorHex}</code>. Nothing about this call is verified — proceed with caution.
          </Banner>
        </div>
      )

    case 'selector-mismatch':
      return (
        <div className="mt-2">
          <Banner tone="danger" icon="gpp_maybe" title="Method selector does not match this contract's spec">
            This app&apos;s bytecode is verified (hash <code className="font-mono">{shortAddr(state.approvalHash, 8)}</code>), but the
            method selector <code className="font-mono">{state.selectorHex}</code> used in this call does not match any method in its
            published ARC-56 spec. Do not assume this call does what any description elsewhere claims it does.
            {state.spec.methods.length > 0 && (
              <div className="mt-1">Known methods on this contract: {state.spec.methods.map((m) => m.name).join(', ')}</div>
            )}
          </Banner>
        </div>
      )

    case 'unverified-candidates':
      return <CandidatesView verification={state} appCall={appCall} network={network} algodClient={algodClient} />

    case 'verified':
      return (
        <div className="mt-2 space-y-1.5">
          <Banner tone="success" icon="verified" title={`Verified: ${state.method.name}(...)`}>
            Matches the published ARC-56 spec for this exact contract bytecode (hash{' '}
            <code className="font-mono">{shortAddr(state.approvalHash, 8)}</code>).
            {state.method.desc && <div className="mt-0.5">{state.method.desc}</div>}
          </Banner>
          <ArgList args={state.args} network={network} algodClient={algodClient} />
        </div>
      )
  }
}
