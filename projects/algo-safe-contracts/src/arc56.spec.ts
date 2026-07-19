import { ABIMethod, ABIType } from 'algosdk'
import { describe, expect, it, vi } from 'vitest'
import {
  buildAbiSignatureUrl,
  buildApprovalSpecUrl,
  decodeAppCallArgs,
  fetchAbiSignatureCandidates,
  fetchArc56SpecByApprovalHash,
  fetchCandidateMethod,
  findMethodBySelector,
  verifyAppCall,
  type Arc56Method,
  type Arc56Spec,
} from './arc56'

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response
}

function notFoundResponse() {
  return { status: 404, ok: false, json: async () => ({}) } as Response
}

const HELLO_METHOD: Arc56Method = {
  name: 'hello',
  desc: 'Says hello',
  args: [{ type: 'string', name: 'name', desc: 'Who to greet' }],
  returns: { type: 'string' },
}
const HELLO_SELECTOR = ABIMethod.fromSignature('hello(string)string').getSelector()
const DECOY_METHOD: Arc56Method = {
  name: 'goodbye',
  args: [{ type: 'uint64', name: 'x' }],
  returns: { type: 'void' },
}

describe('registry URL builders', () => {
  it('splits the hash into a 3-char prefix directory for approval specs', () => {
    expect(buildApprovalSpecUrl('/arc56-registry', 'ABCDEF1234')).toBe('/arc56-registry/approval-programs/abc/abcdef1234.arc56.json')
  })

  it('splits the selector into a 2-char prefix directory for abi-signature lookups', () => {
    expect(buildAbiSignatureUrl('/arc56-registry', 'AABBCCDD')).toBe('/arc56-registry/abi-signatures/aa/aabbccdd.json')
  })

  it('tolerates a trailing slash on the base URL', () => {
    expect(buildApprovalSpecUrl('/arc56-registry/', 'abc123')).toBe('/arc56-registry/approval-programs/abc/abc123.arc56.json')
  })
})

describe('fetchArc56SpecByApprovalHash', () => {
  it('returns null on HTTP 404', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(notFoundResponse())
    expect(await fetchArc56SpecByApprovalHash('/registry', 'deadbeef', fetchImpl)).toBeNull()
  })

  it('returns null when the body is not JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => {
        throw new Error('not json')
      },
    } as unknown as Response)
    expect(await fetchArc56SpecByApprovalHash('/registry', 'deadbeef', fetchImpl)).toBeNull()
  })

  it('returns null when methods is missing entirely', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ name: 'Foo' }))
    expect(await fetchArc56SpecByApprovalHash('/registry', 'deadbeef', fetchImpl)).toBeNull()
  })

  it('drops malformed method entries but keeps valid ones', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        methods: [HELLO_METHOD, { name: 42, args: [] }, { name: 'noArgs' }],
      }),
    )
    const spec = await fetchArc56SpecByApprovalHash('/registry', 'deadbeef', fetchImpl)
    expect(spec?.methods).toHaveLength(1)
    expect(spec?.methods[0].name).toBe('hello')
  })

  it('throws on a non-404 error status so callers can distinguish it from "not found"', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 500, ok: false, json: async () => ({}) } as Response)
    await expect(fetchArc56SpecByApprovalHash('/registry', 'deadbeef', fetchImpl)).rejects.toThrow()
  })
})

describe('fetchAbiSignatureCandidates', () => {
  it('accepts a plain array of hash strings', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ abi: 'hello(string)string', apps: ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'] }))
    const candidates = await fetchAbiSignatureCandidates('/registry', 'deadbeef', fetchImpl)
    expect(candidates).toEqual([
      { approvalHash: 'aaaaaaaaaaaaaaaa', signature: 'hello(string)string' },
      { approvalHash: 'bbbbbbbbbbbbbbbb', signature: 'hello(string)string' },
    ])
  })

  it('drops entries that are not valid hash strings or hash-bearing objects', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        abi: 'hello(string)string',
        apps: [42, { notAHash: true }, { hash: 'cccccccccccccccc' }, 'nothex!!', 'dddddddddddddddd'],
      }),
    )
    const candidates = await fetchAbiSignatureCandidates('/registry', 'deadbeef', fetchImpl)
    expect(candidates).toEqual([
      { approvalHash: 'cccccccccccccccc', signature: 'hello(string)string' },
      { approvalHash: 'dddddddddddddddd', signature: 'hello(string)string' },
    ])
  })

  it('returns null when the response is not an object', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse('not-an-object'))
    expect(await fetchAbiSignatureCandidates('/registry', 'deadbeef', fetchImpl)).toBeNull()
  })
})

describe('findMethodBySelector', () => {
  it('finds the method whose recomputed selector matches, ignoring decoys', () => {
    const spec: Arc56Spec = { methods: [DECOY_METHOD, HELLO_METHOD] }
    expect(findMethodBySelector(spec, HELLO_SELECTOR)).toEqual(HELLO_METHOD)
  })

  it('returns undefined when nothing matches', () => {
    const spec: Arc56Spec = { methods: [DECOY_METHOD] }
    expect(findMethodBySelector(spec, HELLO_SELECTOR)).toBeUndefined()
  })

  it('skips a method whose type string cannot be parsed rather than throwing', () => {
    const spec: Arc56Spec = { methods: [{ name: 'broken', args: [{ type: 'not-a-real-type' }], returns: { type: 'void' } }, HELLO_METHOD] }
    expect(findMethodBySelector(spec, HELLO_SELECTOR)).toEqual(HELLO_METHOD)
  })
})

describe('decodeAppCallArgs', () => {
  it('decodes plain value args in order', () => {
    const method: Arc56Method = {
      name: 'm',
      args: [
        { type: 'uint64', name: 'amount' },
        { type: 'bool', name: 'flag' },
      ],
      returns: { type: 'void' },
    }
    const appArgs = [new Uint8Array(4), ABIType.from('uint64').encode(42n), ABIType.from('bool').encode(true)]
    const decoded = decodeAppCallArgs(method, { appId: 1n, appArgs })
    expect(decoded).toEqual([
      { kind: 'value', name: 'amount', desc: undefined, type: 'uint64', value: 42n },
      { kind: 'value', name: 'flag', desc: undefined, type: 'bool', value: true },
    ])
  })

  it('resolves an asset-reference arg via foreignAssets, with no offset', () => {
    const method: Arc56Method = { name: 'm', args: [{ type: 'asset', name: 'a' }], returns: { type: 'void' } }
    const appArgs = [new Uint8Array(4), ABIType.from('uint8').encode(1n)]
    const decoded = decodeAppCallArgs(method, { appId: 1n, appArgs, foreignAssets: [111n, 222n] })
    expect(decoded).toEqual([{ kind: 'reference', name: 'a', desc: undefined, refType: 'asset', index: 1, resolvedId: 222n }])
  })

  it('marks an asset-reference arg unresolved when no foreignAssets array is available (legacy proposal)', () => {
    const method: Arc56Method = { name: 'm', args: [{ type: 'asset', name: 'a' }], returns: { type: 'void' } }
    const appArgs = [new Uint8Array(4), ABIType.from('uint8').encode(0n)]
    const decoded = decodeAppCallArgs(method, { appId: 1n, appArgs })
    expect(decoded[0]).toMatchObject({ kind: 'reference', unresolved: true })
  })

  it('resolves account-reference index 0 to the sender, and index>=1 to accounts[index-1]', () => {
    const method: Arc56Method = {
      name: 'm',
      args: [
        { type: 'account', name: 'a' },
        { type: 'account', name: 'b' },
      ],
      returns: { type: 'void' },
    }
    const appArgs = [new Uint8Array(4), ABIType.from('uint8').encode(0n), ABIType.from('uint8').encode(1n)]
    const decoded = decodeAppCallArgs(method, { appId: 1n, appArgs, sender: 'SENDERADDR', accounts: ['ACCT0'] })
    expect(decoded[0]).toMatchObject({ refType: 'account', index: 0, resolvedId: 'SENDERADDR' })
    expect(decoded[1]).toMatchObject({ refType: 'account', index: 1, resolvedId: 'ACCT0' })
  })

  it('resolves application-reference index 0 to the called app itself, and index>=1 to foreignApps[index-1]', () => {
    const method: Arc56Method = {
      name: 'm',
      args: [
        { type: 'application', name: 'a' },
        { type: 'application', name: 'b' },
      ],
      returns: { type: 'void' },
    }
    const appArgs = [new Uint8Array(4), ABIType.from('uint8').encode(0n), ABIType.from('uint8').encode(1n)]
    const decoded = decodeAppCallArgs(method, { appId: 999n, appArgs, foreignApps: [123n] })
    expect(decoded[0]).toMatchObject({ refType: 'application', index: 0, resolvedId: 999n })
    expect(decoded[1]).toMatchObject({ refType: 'application', index: 1, resolvedId: 123n })
  })

  it('does not advance the appArgs cursor for a transaction-typed arg (regression test)', () => {
    const method: Arc56Method = {
      name: 'm',
      args: [
        { type: 'pay', name: 'payment' },
        { type: 'uint64', name: 'amount' },
      ],
      returns: { type: 'void' },
    }
    // Only ONE value slot after the selector — the `pay` arg consumes a
    // preceding group transaction, not an appArgs entry.
    const appArgs = [new Uint8Array(4), ABIType.from('uint64').encode(777n)]
    const decoded = decodeAppCallArgs(method, { appId: 1n, appArgs })
    expect(decoded[0]).toEqual({ kind: 'transaction', name: 'payment', desc: undefined, txnType: 'pay' })
    expect(decoded[1]).toEqual({ kind: 'value', name: 'amount', desc: undefined, type: 'uint64', value: 777n })
  })
})

describe('verifyAppCall', () => {
  function algodClientReturning(approvalProgram: Uint8Array) {
    return { getApplicationByID: () => ({ do: async () => ({ params: { 'approval-program': approvalProgram } }) }) }
  }

  const approvalProgram = new Uint8Array([1, 2, 3, 4, 5])
  const ctx = { appId: 1n, appArgs: [HELLO_SELECTOR] }

  it('returns not-an-abi-call when appArgs is empty', async () => {
    const result = await verifyAppCall(algodClientReturning(approvalProgram), { appId: 1n, appArgs: [] }, '/registry', vi.fn())
    expect(result).toEqual({ status: 'not-an-abi-call' })
  })

  it('returns not-an-abi-call when the first arg is not exactly 4 bytes', async () => {
    const result = await verifyAppCall(
      algodClientReturning(approvalProgram),
      { appId: 1n, appArgs: [new Uint8Array([1, 2])] },
      '/registry',
      vi.fn(),
    )
    expect(result).toEqual({ status: 'not-an-abi-call' })
  })

  it('returns app-lookup-failed when algod throws', async () => {
    const algodClient = {
      getApplicationByID: () => ({
        do: async () => {
          throw new Error('app does not exist')
        },
      }),
    }
    const result = await verifyAppCall(algodClient, ctx, '/registry', vi.fn())
    expect(result.status).toBe('app-lookup-failed')
  })

  it('returns verified when the hash is found and the selector matches a method', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ methods: [HELLO_METHOD] }))
    const result = await verifyAppCall(algodClientReturning(approvalProgram), ctx, '/registry', fetchImpl)
    expect(result.status).toBe('verified')
    if (result.status === 'verified') {
      expect(result.method.name).toBe('hello')
    }
  })

  it('returns selector-mismatch when the hash is found but no method matches', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ methods: [DECOY_METHOD] }))
    const result = await verifyAppCall(algodClientReturning(approvalProgram), ctx, '/registry', fetchImpl)
    expect(result.status).toBe('selector-mismatch')
  })

  it('returns no-spec when the hash 404s and no selector candidates exist', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(notFoundResponse()).mockResolvedValueOnce(jsonResponse({ apps: [] }))
    const result = await verifyAppCall(algodClientReturning(approvalProgram), ctx, '/registry', fetchImpl)
    expect(result.status).toBe('no-spec')
  })

  it('returns unverified-candidates when the hash 404s but the selector matches elsewhere', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(notFoundResponse())
      .mockResolvedValueOnce(jsonResponse({ abi: 'hello(string)string', apps: ['aaaaaaaaaaaaaaaa'] }))
    const result = await verifyAppCall(algodClientReturning(approvalProgram), ctx, '/registry', fetchImpl)
    expect(result.status).toBe('unverified-candidates')
  })

  it('returns registry-unreachable (not no-spec) when the registry request throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'))
    const result = await verifyAppCall(algodClientReturning(approvalProgram), ctx, '/registry', fetchImpl)
    expect(result.status).toBe('registry-unreachable')
  })
})

describe('fetchCandidateMethod', () => {
  it('re-derives the selector match from the candidate spec instead of trusting the registry listing blindly', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ methods: [HELLO_METHOD] }))
    const result = await fetchCandidateMethod('/registry', { approvalHash: 'aaaaaaaaaaaaaaaa' }, HELLO_SELECTOR, fetchImpl)
    expect(result?.method.name).toBe('hello')
  })

  it('returns undefined if the candidate spec does not actually contain a matching method', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ methods: [DECOY_METHOD] }))
    const result = await fetchCandidateMethod('/registry', { approvalHash: 'aaaaaaaaaaaaaaaa' }, HELLO_SELECTOR, fetchImpl)
    expect(result).toBeUndefined()
  })
})
