import { describe, expect, it } from 'vitest'
import { getClient } from './get-client'
import { CONTRACT_HASHES, LATEST_CONTRACT_HASH } from './versioned-clients.generated'

describe('getClient', () => {
  it('defaults to the latest client when called with no argument', () => {
    expect(getClient()).toBe(getClient(LATEST_CONTRACT_HASH))
  })

  it("resolves 'latest' to the same constructor as the latest hash", () => {
    expect(getClient('latest')).toBe(getClient(LATEST_CONTRACT_HASH))
  })

  it('resolves every known contract hash to a distinct constructor', () => {
    const constructors = CONTRACT_HASHES.map((hash) => getClient(hash))
    expect(new Set(constructors).size).toBe(CONTRACT_HASHES.length)
  })

  it('throws a helpful error for an unrecognized version', () => {
    expect(() => getClient('not-a-real-hash')).toThrow(/Unknown Algo Safe client version/)
    expect(() => getClient('not-a-real-hash')).toThrow(/not-a-real-hash/)
  })
})
