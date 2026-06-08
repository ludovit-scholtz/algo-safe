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
    'approval-program'?: string
    approvalProgram?: string
  }
}

const UTF8_DECODER = new TextDecoder()
const HEX_DIGITS = '0123456789abcdef'

function decodeBase64Utf8(value: string) {
  const decoded = atob(value)
  const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0))
  return UTF8_DECODER.decode(bytes)
}

function decodeBase64Bytes(value: string) {
  const decoded = atob(value)
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0))
}

function bytesToHex(bytes: Uint8Array) {
  let hex = ''

  for (const byte of bytes) {
    hex += HEX_DIGITS[(byte >> 4) & 0x0f] + HEX_DIGITS[byte & 0x0f]
  }

  return hex
}

async function hashApprovalProgram(approvalProgramBase64: string) {
  const approvalProgramBytes = decodeBase64Bytes(approvalProgramBase64)
  const digest = await crypto.subtle.digest('SHA-256', approvalProgramBytes)
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
