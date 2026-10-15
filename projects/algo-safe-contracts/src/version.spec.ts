import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_PROPOSAL_LIFETIME_ROUNDS } from './constants'
import { algoSafeArc56 } from './artifacts'
import { getAlgoSafeContractVersion, MODERN_ABI_CONTRACT_HASHES } from './version'
import { CONTRACT_HASHES, LATEST_CONTRACT_HASH } from './versioned-clients.generated'

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

  it('lists the latest and the previous (v3.3.0) hash as modern-ABI compatible', () => {
    expect(MODERN_ABI_CONTRACT_HASHES).toContain(LATEST_CONTRACT_HASH)
    expect(MODERN_ABI_CONTRACT_HASHES).toContain('b096f50b39dff57a9df61e36a9a74a35e9f892854495f4c5efc42e5d8822bf35')
    for (const hash of MODERN_ABI_CONTRACT_HASHES) expect(CONTRACT_HASHES).toContain(hash)
  })

  it('keeps the library expiry cap in sync with the contract constant', () => {
    const source = readFileSync(join(process.cwd(), 'smart_contracts/algo_safe/contract.algo.ts'), 'utf-8')
    const match = /MAX_PROPOSAL_LIFETIME_ROUNDS: uint64 = Uint64\(([\d_]+)\)/.exec(source)
    expect(match).not.toBeNull()
    expect(BigInt(match![1].replace(/_/g, ''))).toBe(MAX_PROPOSAL_LIFETIME_ROUNDS)
  })
})
