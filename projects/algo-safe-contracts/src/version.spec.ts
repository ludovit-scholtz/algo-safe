import { describe, expect, it } from 'vitest'
import { algoSafeArc56 } from './artifacts'
import { getAlgoSafeContractVersion } from './version'
import { CONTRACT_HASHES } from './versioned-clients.generated'

function toBase64Url(base64: string) {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

describe('getAlgoSafeContractVersion', () => {
  it('supports approval programs returned as Uint8Array', async () => {
    const approvalBytes = Uint8Array.from(Buffer.from(algoSafeArc56.byteCode.approval, 'base64'))
    const algodClient = {
      getApplicationByID: () => ({
        do: async () => ({ params: { 'approval-program': approvalBytes } }),
      }),
    }

    const version = await getAlgoSafeContractVersion(algodClient, 1)

    expect(CONTRACT_HASHES).toContain(version)
  })

  it('supports url-safe base64 approval programs', async () => {
    const algodClient = {
      getApplicationByID: () => ({
        do: async () => ({ params: { 'approval-program': toBase64Url(algoSafeArc56.byteCode.approval) } }),
      }),
    }

    const version = await getAlgoSafeContractVersion(algodClient, 1)

    expect(CONTRACT_HASHES).toContain(version)
  })
})
