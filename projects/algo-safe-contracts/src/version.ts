import { CONTRACT_HASHES, LATEST_CONTRACT_HASH, type ContractVersion } from './versioned-clients.generated'

/**
 * Approval hashes sharing the current ("modern") ABI call surface: tagged-envelope
 * payloads, `approveProposal(proposalId, expectedPayloadVersion, ensureBudgetValue)`,
 * `executeProposal(uint64,uint64)`, `proposalId*7+slot` payload box keys, and no
 * read-only ABI getters (state is read via the box/global readers in on-chain.ts).
 *
 * Extend this list whenever a new contract version ships WITHOUT breaking that
 * surface (e.g. v3.1.0 over v3.0.0, v3.2.0 over v3.1.0). Clients should branch
 * legacy-vs-modern with `hasModernAbi(version)` rather than comparing against
 * LATEST_CONTRACT_HASH — a hash-equality check silently demotes every
 * older-but-compatible deployment to the legacy code path the moment a new
 * version is registered.
 */
export const MODERN_ABI_CONTRACT_HASHES: readonly string[] = [
  LATEST_CONTRACT_HASH, // v3.2.0
  '0ec5f00067169dae3414cffd9f2e04d8e2a91884d7fd0eb903c31aa409da6ead', // v3.1.0
  '8a9073ec02dd208e4757e57180a96b452e074c1731c7ecccdabdbe8dc7f3acee', // v3.0.0
]

/** True when the detected version uses the modern ABI surface (see MODERN_ABI_CONTRACT_HASHES). */
export function hasModernAbi(version: ContractVersion | undefined): boolean {
  return !version || version === 'latest' || MODERN_ABI_CONTRACT_HASHES.includes(version)
}

type AlgodAppLookup = {
  getApplicationByID?: (appId: number) => {
    do(): Promise<unknown>
  }
  applicationByID?: (appId: number) => {
    do(): Promise<unknown>
  }
}

type ApplicationLookupResponse = {
  params?: {
    'approval-program'?: string | Uint8Array | number[]
    approvalProgram?: string | Uint8Array | number[]
  }
}

const HEX_DIGITS = '0123456789abcdef'

function decodeBase64Bytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
  const decoded = atob(padded)
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0))
}

function normalizeApprovalProgram(value: string | Uint8Array | number[]) {
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value)) return Uint8Array.from(value)
  return decodeBase64Bytes(value)
}

function bytesToHex(bytes: Uint8Array) {
  let hex = ''

  for (const byte of bytes) {
    hex += HEX_DIGITS[(byte >> 4) & 0x0f] + HEX_DIGITS[byte & 0x0f]
  }

  return hex
}

export async function hashApprovalProgram(approvalProgram: string | Uint8Array | number[]) {
  const approvalProgramBytes = normalizeApprovalProgram(approvalProgram)
  const digest = await crypto.subtle.digest('SHA-256', approvalProgramBytes as NodeJS.BufferSource)
  return bytesToHex(new Uint8Array(digest))
}

export async function getAlgoSafeContractVersion(
  algodClient: AlgodAppLookup,
  appId: bigint | number,
): Promise<ContractVersion> {
  const lookup = algodClient.getApplicationByID?.(Number(appId)) ?? algodClient.applicationByID?.(Number(appId))

  if (!lookup) {
    throw new Error('The provided algod client does not support application lookup by ID.')
  }

  const application = (await lookup.do()) as ApplicationLookupResponse
  const approvalProgram = application.params?.['approval-program'] ?? application.params?.approvalProgram

  if (!approvalProgram) return 'latest'

  const approvalHash = await hashApprovalProgram(approvalProgram)
  return CONTRACT_HASHES.includes(approvalHash as (typeof CONTRACT_HASHES)[number]) ? approvalHash : 'latest'
}
