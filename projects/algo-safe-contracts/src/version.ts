type AlgodAppLookup = {
  getApplicationByID?: (appId: number) => {
    do(): Promise<unknown>
  }
  applicationByID?: (appId: number) => {
    do(): Promise<unknown>
  }
}

type AppStateValue = {
  type?: number
  bytes?: string
}

type AppStateEntry = {
  key?: string
  value?: AppStateValue
}

type ApplicationLookupResponse = {
  params?: {
    'global-state'?: AppStateEntry[]
    globalState?: AppStateEntry[]
  }
}

const VERSION_STATE_KEY_BASE64 = 'dmVy'
const COMMIT_ID_PATTERN = /^[0-9a-f]{7,40}$/i
const UTF8_DECODER = new TextDecoder()

function decodeBase64Utf8(value: string) {
  const decoded = atob(value)
  const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0))
  return UTF8_DECODER.decode(bytes)
}

export async function getAlgoSafeContractVersion(
  algodClient: AlgodAppLookup,
  appId: bigint | number,
): Promise<string | null> {
  const lookup = algodClient.getApplicationByID?.(Number(appId)) ?? algodClient.applicationByID?.(Number(appId))

  if (!lookup) {
    throw new Error('The provided algod client does not support application lookup by ID.')
  }

  const application = (await lookup.do()) as ApplicationLookupResponse
  const globalState = application.params?.['global-state'] ?? application.params?.globalState
  const versionEntry = globalState?.find((entry) => entry.key === VERSION_STATE_KEY_BASE64)
  const encodedVersion = versionEntry?.value?.type === 1 ? versionEntry.value.bytes : undefined

  if (!encodedVersion) return null

  const version = decodeBase64Utf8(encodedVersion)?.trim()
  return version && COMMIT_ID_PATTERN.test(version) ? version : null
}
