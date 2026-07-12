import { CONTRACT_HASHES, type ContractVersion } from './versioned-clients.generated'

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
