import { ABIMethod, ABIType, abiTypeIsReference, abiTypeIsTransaction } from 'algosdk'
import { hashApprovalProgram } from './version'

// ---------------------------------------------------------------------------
// ARC-56-verified app-call decoding.
//
// Ground truth is always the *actual on-chain bytecode* of the app being
// called: we fetch its approval program from algod ourselves and hash it —
// the registry is never trusted to say what code is deployed, only to map a
// hash we computed independently to a published spec. A method match is only
// accepted when we recompute the method's selector ourselves (via
// `algosdk.ABIMethod`) and it byte-matches `appArgs[0]` of the transaction
// actually being signed. Anything short of that fails closed to a clearly
// labeled "unverified"/"mismatch" state — never silently upgraded to look
// like a verified match. See `verifyAppCall`'s state machine below.
// ---------------------------------------------------------------------------

export const DEFAULT_ARC56_REGISTRY_BASE_URL = '/arc56-registry'

export type Arc56MethodArg = { type: string; name?: string; desc?: string; struct?: string }
export type Arc56MethodReturn = { type: string; desc?: string; struct?: string }
export type Arc56Method = {
  name: string
  desc?: string
  args: Arc56MethodArg[]
  returns: Arc56MethodReturn
  readonly?: boolean
}
export type Arc56Spec = {
  name?: string
  desc?: string
  methods: Arc56Method[]
  // Passed through verbatim but never relied on for decoding correctness —
  // `structs`/etc. are display-only aids per ARC-56; `args[i].type` is always
  // a self-sufficient ARC-4 type string.
  [key: string]: unknown
}

export type AbiSignatureCandidate = { approvalHash: string; signature?: string }

export type AppCallContext = {
  appId: bigint
  /** Sender of the application-call transaction — needed to resolve account-reference index 0. */
  sender?: string
  appArgs: Uint8Array[]
  /** undefined for proposal formats that don't carry foreign-array data (e.g. legacy Safe payloads). */
  accounts?: string[]
  foreignApps?: bigint[]
  foreignAssets?: bigint[]
}

export type DecodedArg =
  | { kind: 'value'; name?: string; desc?: string; type: string; value: unknown }
  | {
      kind: 'reference'
      name?: string
      desc?: string
      refType: 'account' | 'asset' | 'application'
      index: number
      resolvedId?: string | bigint
      unresolved?: boolean
      reason?: string
    }
  | { kind: 'transaction'; name?: string; desc?: string; txnType: string }
  | { kind: 'unsupported'; name?: string; desc?: string; type: string; reason: string }

export type AppCallVerification =
  | { status: 'not-an-abi-call' }
  | { status: 'app-lookup-failed'; error: string }
  | { status: 'registry-unreachable'; error: string }
  | { status: 'no-spec'; approvalHash: string; selectorHex: string }
  | { status: 'selector-mismatch'; approvalHash: string; spec: Arc56Spec; selectorHex: string }
  | { status: 'unverified-candidates'; selectorHex: string; candidates: AbiSignatureCandidate[] }
  | { status: 'verified'; approvalHash: string; spec: Arc56Spec; method: Arc56Method; args: DecodedArg[] }

// ---------------------------------------------------------------------------
// Registry URL helpers
// ---------------------------------------------------------------------------

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

export function buildApprovalSpecUrl(baseUrl: string, approvalHashHex: string): string {
  const hash = approvalHashHex.toLowerCase()
  return `${trimTrailingSlash(baseUrl)}/approval-programs/${hash.slice(0, 3)}/${hash}.arc56.json`
}

export function buildAbiSignatureUrl(baseUrl: string, selectorHex: string): string {
  const selector = selectorHex.toLowerCase()
  return `${trimTrailingSlash(baseUrl)}/abi-signatures/${selector.slice(0, 2)}/${selector}.json`
}

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

const HEX_DIGITS = '0123456789abcdef'

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += HEX_DIGITS[(byte >> 4) & 0x0f] + HEX_DIGITS[byte & 0x0f]
  return hex
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ---------------------------------------------------------------------------
// Defensive JSON shape validation — the registry is untrusted input.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sanitizeMethods(methods: unknown[]): Arc56Method[] {
  const out: Arc56Method[] = []
  for (const entry of methods) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || !Array.isArray(entry.args)) continue
    const args: Arc56MethodArg[] = []
    for (const arg of entry.args) {
      if (isRecord(arg) && typeof arg.type === 'string') {
        args.push({
          type: arg.type,
          name: typeof arg.name === 'string' ? arg.name : undefined,
          desc: typeof arg.desc === 'string' ? arg.desc : undefined,
          struct: typeof arg.struct === 'string' ? arg.struct : undefined,
        })
      }
    }
    const returnsRaw = entry.returns
    const returns: Arc56MethodReturn =
      isRecord(returnsRaw) && typeof returnsRaw.type === 'string'
        ? { type: returnsRaw.type, desc: typeof returnsRaw.desc === 'string' ? returnsRaw.desc : undefined }
        : { type: 'void' }
    out.push({
      name: entry.name,
      desc: typeof entry.desc === 'string' ? entry.desc : undefined,
      args,
      returns,
      readonly: typeof entry.readonly === 'boolean' ? entry.readonly : undefined,
    })
  }
  return out
}

function isHexHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{16,}$/i.test(value)
}

// ---------------------------------------------------------------------------
// Registry HTTP client — every function resolves to `null` for "not found /
// unusable response" and only throws for genuine transport/HTTP failures, so
// callers can distinguish "not published" from "couldn't check".
// ---------------------------------------------------------------------------

async function fetchJsonOrNull(url: string, fetchImpl: typeof fetch): Promise<unknown | null> {
  const response = await fetchImpl(url)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`ARC-56 registry returned HTTP ${response.status} for ${url}`)
  try {
    return await response.json()
  } catch {
    return null
  }
}

export async function fetchArc56SpecByApprovalHash(
  baseUrl: string,
  approvalHashHex: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Arc56Spec | null> {
  const json = await fetchJsonOrNull(buildApprovalSpecUrl(baseUrl, approvalHashHex), fetchImpl)
  if (!isRecord(json) || !Array.isArray(json.methods)) return null
  return { ...json, methods: sanitizeMethods(json.methods) }
}

export async function fetchAbiSignatureCandidates(
  baseUrl: string,
  selectorHex: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AbiSignatureCandidate[] | null> {
  const json = await fetchJsonOrNull(buildAbiSignatureUrl(baseUrl, selectorHex), fetchImpl)
  if (!isRecord(json)) return null
  const signature = typeof json.abi === 'string' ? json.abi : undefined
  const appsRaw = Array.isArray(json.apps) ? json.apps : []
  const candidates: AbiSignatureCandidate[] = []
  for (const entry of appsRaw) {
    if (isHexHash(entry)) {
      candidates.push({ approvalHash: entry.toLowerCase(), signature })
    } else if (isRecord(entry) && isHexHash(entry.hash)) {
      candidates.push({ approvalHash: entry.hash.toLowerCase(), signature: typeof entry.abi === 'string' ? entry.abi : signature })
    }
    // Anything else (unexpected shape) is silently dropped — the schema of
    // this endpoint isn't contractually guaranteed, so unknown entries must
    // never crash the UI or be guessed into something that looks verified.
  }
  return candidates
}

/**
 * Re-fetches a candidate's OWN spec and re-derives the selector match
 * independently — never trust the registry's `apps[]` listing at face value,
 * even though it already implies the match.
 */
export async function fetchCandidateMethod(
  baseUrl: string,
  candidate: AbiSignatureCandidate,
  selector: Uint8Array,
  fetchImpl: typeof fetch = fetch,
): Promise<{ spec: Arc56Spec; method: Arc56Method } | undefined> {
  const spec = await fetchArc56SpecByApprovalHash(baseUrl, candidate.approvalHash, fetchImpl)
  if (!spec) return undefined
  const method = findMethodBySelector(spec, selector)
  if (!method) return undefined
  return { spec, method }
}

// ---------------------------------------------------------------------------
// Selector matching
// ---------------------------------------------------------------------------

function buildAbiMethod(method: Arc56Method): ABIMethod {
  return new ABIMethod({
    name: method.name,
    desc: method.desc,
    args: method.args.map((arg) => ({ type: arg.type, name: arg.name, desc: arg.desc })),
    returns: method.returns,
  })
}

export function findMethodBySelector(spec: Arc56Spec, selector: Uint8Array): Arc56Method | undefined {
  for (const method of spec.methods) {
    try {
      if (bytesEqual(buildAbiMethod(method).getSelector(), selector)) return method
    } catch {
      // A malformed method entry (unparseable ARC-4 type string) can never
      // match — skip it rather than letting it abort the whole search.
      continue
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Argument decoding — ARC-4-aware: reference-typed args (account/asset/
// application) are a single-byte index into the txn's accounts/foreignApps/
// foreignAssets arrays (with the ARC-4 "index 0 = sender/this-app" rule),
// and transaction-typed args consume a PRECEDING transaction in the atomic
// group rather than an appArgs slot at all. Getting this wrong would
// misalign every argument after the first reference/txn arg and show wrong
// values with false confidence, so each case is handled explicitly.
// ---------------------------------------------------------------------------

function resolveReference(
  refType: 'account' | 'asset' | 'application',
  index: number,
  ctx: AppCallContext,
  name?: string,
  desc?: string,
): DecodedArg {
  if (refType === 'asset') {
    const resolvedId = ctx.foreignAssets?.[index]
    if (resolvedId === undefined) {
      return {
        kind: 'reference',
        name,
        desc,
        refType,
        index,
        unresolved: true,
        reason: ctx.foreignAssets ? 'Index out of range for foreignAssets.' : 'No foreign-asset array available for this proposal format.',
      }
    }
    return { kind: 'reference', name, desc, refType, index, resolvedId }
  }

  if (refType === 'account') {
    if (index === 0) {
      if (!ctx.sender) return { kind: 'reference', name, desc, refType, index, unresolved: true, reason: 'Sender address unknown.' }
      return { kind: 'reference', name, desc, refType, index, resolvedId: ctx.sender }
    }
    const resolvedId = ctx.accounts?.[index - 1]
    if (resolvedId === undefined) {
      return {
        kind: 'reference',
        name,
        desc,
        refType,
        index,
        unresolved: true,
        reason: ctx.accounts ? 'Index out of range for accounts.' : 'No accounts array available for this proposal format.',
      }
    }
    return { kind: 'reference', name, desc, refType, index, resolvedId }
  }

  // application
  if (index === 0) {
    return { kind: 'reference', name, desc, refType, index, resolvedId: ctx.appId }
  }
  const resolvedId = ctx.foreignApps?.[index - 1]
  if (resolvedId === undefined) {
    return {
      kind: 'reference',
      name,
      desc,
      refType,
      index,
      unresolved: true,
      reason: ctx.foreignApps ? 'Index out of range for foreignApps.' : 'No foreign-app array available for this proposal format.',
    }
  }
  return { kind: 'reference', name, desc, refType, index, resolvedId }
}

const MAX_DIRECT_APP_ARGS = 15 // ARC-4: beyond this, trailing args are packed into a single tuple — not decoded here.

export function decodeAppCallArgs(method: Arc56Method, ctx: AppCallContext): DecodedArg[] {
  let abiMethod: ABIMethod
  try {
    abiMethod = buildAbiMethod(method)
  } catch (err) {
    return method.args.map((arg) => ({
      kind: 'unsupported',
      name: arg.name,
      desc: arg.desc,
      type: arg.type,
      reason: `Could not parse ABI type: ${errMsg(err)}`,
    }))
  }

  const results: DecodedArg[] = []
  let cursor = 1 // appArgs[0] is the 4-byte method selector
  let valueArgCount = 0

  for (const arg of abiMethod.args) {
    if (abiTypeIsTransaction(arg.type)) {
      results.push({ kind: 'transaction', name: arg.name, desc: arg.description, txnType: String(arg.type) })
      continue // consumes a preceding group transaction, not an appArgs slot
    }

    valueArgCount += 1
    if (valueArgCount > MAX_DIRECT_APP_ARGS) {
      results.push({
        kind: 'unsupported',
        name: arg.name,
        desc: arg.description,
        type: String(arg.type),
        reason: 'Argument packing beyond 15 direct arguments is not decoded in this version.',
      })
      continue
    }

    const raw = ctx.appArgs[cursor]
    cursor += 1

    if (raw === undefined) {
      results.push({
        kind: 'unsupported',
        name: arg.name,
        desc: arg.description,
        type: String(arg.type),
        reason: 'Missing app-call argument bytes.',
      })
      continue
    }

    if (abiTypeIsReference(arg.type)) {
      const refType = arg.type as 'account' | 'asset' | 'application'
      let index: number
      try {
        index = Number(ABIType.from('uint8').decode(raw))
      } catch {
        results.push({ kind: 'unsupported', name: arg.name, desc: arg.description, type: refType, reason: 'Could not decode reference index byte.' })
        continue
      }
      results.push(resolveReference(refType, index, ctx, arg.name, arg.description))
      continue
    }

    try {
      const value = arg.type.decode(raw)
      results.push({ kind: 'value', name: arg.name, desc: arg.description, type: arg.type.toString(), value })
    } catch (err) {
      results.push({ kind: 'unsupported', name: arg.name, desc: arg.description, type: String(arg.type), reason: `Decode failed: ${errMsg(err)}` })
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

type AlgodAppLookup = {
  getApplicationByID: (appId: number) => { do(): Promise<unknown> }
}

type ApplicationLookupResponse = {
  params?: {
    'approval-program'?: string | Uint8Array | number[]
    approvalProgram?: string | Uint8Array | number[]
  }
}

async function fetchApprovalProgramBytes(
  algodClient: AlgodAppLookup,
  appId: bigint,
): Promise<string | Uint8Array | number[] | undefined> {
  const application = (await algodClient.getApplicationByID(Number(appId)).do()) as ApplicationLookupResponse
  return application.params?.['approval-program'] ?? application.params?.approvalProgram
}

/**
 * Verify and (if possible) decode an application-call transaction against the
 * ARC-56 registry. Resolves to a status in `AppCallVerification` — never
 * throws — so a caller (e.g. a React component) can always render *some*
 * clearly-labeled state, including a distinct "couldn't check" state for
 * transient failures (never conflated with "confirmed absent from the
 * registry").
 */
export async function verifyAppCall(
  algodClient: AlgodAppLookup,
  ctx: AppCallContext,
  registryBaseUrl: string = DEFAULT_ARC56_REGISTRY_BASE_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<AppCallVerification> {
  if (ctx.appArgs.length === 0 || ctx.appArgs[0].length !== 4) {
    return { status: 'not-an-abi-call' }
  }
  const selector = ctx.appArgs[0]
  const selectorHex = bytesToHex(selector)

  let approvalHash: string
  try {
    const approvalProgram = await fetchApprovalProgramBytes(algodClient, ctx.appId)
    if (!approvalProgram) return { status: 'app-lookup-failed', error: `App ${ctx.appId} has no readable approval program.` }
    approvalHash = await hashApprovalProgram(approvalProgram)
  } catch (err) {
    return { status: 'app-lookup-failed', error: errMsg(err) }
  }

  let spec: Arc56Spec | null
  try {
    spec = await fetchArc56SpecByApprovalHash(registryBaseUrl, approvalHash, fetchImpl)
  } catch (err) {
    return { status: 'registry-unreachable', error: errMsg(err) }
  }

  if (spec) {
    const method = findMethodBySelector(spec, selector)
    if (!method) return { status: 'selector-mismatch', approvalHash, spec, selectorHex }
    return { status: 'verified', approvalHash, spec, method, args: decodeAppCallArgs(method, ctx) }
  }

  let candidates: AbiSignatureCandidate[] | null
  try {
    candidates = await fetchAbiSignatureCandidates(registryBaseUrl, selectorHex, fetchImpl)
  } catch (err) {
    return { status: 'registry-unreachable', error: errMsg(err) }
  }

  if (candidates && candidates.length > 0) {
    return { status: 'unverified-candidates', selectorHex, candidates }
  }

  return { status: 'no-spec', approvalHash, selectorHex }
}
