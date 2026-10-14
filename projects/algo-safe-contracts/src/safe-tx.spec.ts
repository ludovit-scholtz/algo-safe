import algosdk from 'algosdk'
import { describe, expect, it } from 'vitest'
import { algosdkTxnsToSafeTxnGroup } from './safe-tx'

const suggestedParams = {
  fee: 1000n,
  firstValid: 1n,
  lastValid: 1000n,
  genesisID: 'test',
  genesisHash: new Uint8Array(32),
  minFee: 1000n,
} satisfies algosdk.SuggestedParams

const sender = algosdk.generateAccount().addr

describe('algosdkTxnsToSafeTxnGroup', () => {
  it('throws on a keyreg with nonParticipation: true instead of silently downgrading to go-offline (v3.2.0, I-01)', () => {
    const nonParticipationTxn = algosdk.makeKeyRegistrationTxnWithSuggestedParamsFromObject({
      sender,
      nonParticipation: true,
      suggestedParams,
    })

    expect(() => algosdkTxnsToSafeTxnGroup([nonParticipationTxn])).toThrow(/nonParticipation/)
  })

  it('still converts a plain go-offline keyreg (no vote key, nonParticipation unset)', () => {
    const goOfflineTxn = algosdk.makeKeyRegistrationTxnWithSuggestedParamsFromObject({
      sender,
      suggestedParams,
    })

    expect(() => algosdkTxnsToSafeTxnGroup([goOfflineTxn])).not.toThrow()
  })

  it('throws on an asset transfer carrying a clawback target (assetSender) instead of dropping it (v3.3.0, L-02)', () => {
    const clawback = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender,
      receiver: sender,
      assetIndex: 5,
      amount: 1n,
      assetSender: algosdk.generateAccount().addr,
      suggestedParams,
    })
    expect(() => algosdkTxnsToSafeTxnGroup([clawback])).toThrow(/clawback/)

    const plain = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender,
      receiver: sender,
      assetIndex: 5,
      amount: 1n,
      suggestedParams,
    })
    expect(() => algosdkTxnsToSafeTxnGroup([plain])).not.toThrow()
  })
})
