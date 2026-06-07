type AlgodAppLookup = {
  getApplicationByID(appId: number): {
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
  }
}

const VERSION_STATE_KEY_BASE64 = 'dmVy'
const COMMIT_ID_PATTERN = /^[0-9a-f]{7,40}$/i

function decodeBase64Utf8(value: string) {
  try {
    return decodeURIComponent(
      Array.from(globalThis.atob(value))
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    )
  } catch {
    return null
  }
}

export async function getAlgoSafeContractVersion(algodClient: AlgodAppLookup, appId: bigint | number): Promise<string | null> {
  const application = (await algodClient.getApplicationByID(Number(appId)).do()) as ApplicationLookupResponse
  const versionEntry = application.params?.['global-state']?.find((entry) => entry.key === VERSION_STATE_KEY_BASE64)
  const encodedVersion = versionEntry?.value?.type === 1 ? versionEntry.value.bytes : undefined

  if (!encodedVersion) return null

  const version = decodeBase64Utf8(encodedVersion)?.trim()
  return version && COMMIT_ID_PATTERN.test(version) ? version : null
}