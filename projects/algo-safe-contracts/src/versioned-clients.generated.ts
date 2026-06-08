import { AlgoSafeClient as AlgoSafeClient_ebd1cf101b997b6a914caa195aa7d3eb050d557dc823edab438cc30cbf156b1e } from '../clients/ebd1cf101b997b6a914caa195aa7d3eb050d557dc823edab438cc30cbf156b1e/AlgoSafeClient'

export const LATEST_CONTRACT_HASH = 'ebd1cf101b997b6a914caa195aa7d3eb050d557dc823edab438cc30cbf156b1e' as const
export const CONTRACT_HASHES = [
  'ebd1cf101b997b6a914caa195aa7d3eb050d557dc823edab438cc30cbf156b1e',
] as const
export const DEFAULT_CLIENT_VERSION = 'latest' as const

export type ContractHash = (typeof CONTRACT_HASHES)[number]
export type ContractVersion = ContractHash | typeof DEFAULT_CLIENT_VERSION | string
export type AlgoSafeClientConstructor = typeof AlgoSafeClient_ebd1cf101b997b6a914caa195aa7d3eb050d557dc823edab438cc30cbf156b1e

const CLIENT_REGISTRY = {
  'ebd1cf101b997b6a914caa195aa7d3eb050d557dc823edab438cc30cbf156b1e': AlgoSafeClient_ebd1cf101b997b6a914caa195aa7d3eb050d557dc823edab438cc30cbf156b1e,
} satisfies Record<ContractHash, AlgoSafeClientConstructor>

export function getClientRegistry() {
  return CLIENT_REGISTRY
}
