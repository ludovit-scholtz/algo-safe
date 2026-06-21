import { AlgoSafeClient as AlgoSafeClient_1a77ba21f289ff35d2d54b732cc2e66e4bdba6ac820e7f25e381f58bea41b5fc } from '../clients/1a77ba21f289ff35d2d54b732cc2e66e4bdba6ac820e7f25e381f58bea41b5fc/AlgoSafeClient'
import { AlgoSafeClient as AlgoSafeClient_ebd1cf101b997b6a914caa195aa7d3eb050d557dc823edab438cc30cbf156b1e } from '../clients/ebd1cf101b997b6a914caa195aa7d3eb050d557dc823edab438cc30cbf156b1e/AlgoSafeClient'

export const LATEST_CONTRACT_HASH = '1a77ba21f289ff35d2d54b732cc2e66e4bdba6ac820e7f25e381f58bea41b5fc' as const
export const CONTRACT_HASHES = [
  '1a77ba21f289ff35d2d54b732cc2e66e4bdba6ac820e7f25e381f58bea41b5fc',
  'ebd1cf101b997b6a914caa195aa7d3eb050d557dc823edab438cc30cbf156b1e',
] as const
export const DEFAULT_CLIENT_VERSION = 'latest' as const

export type ContractHash = (typeof CONTRACT_HASHES)[number]
export type ContractVersion = ContractHash | typeof DEFAULT_CLIENT_VERSION | string
export type AlgoSafeClientConstructor =
  | typeof AlgoSafeClient_1a77ba21f289ff35d2d54b732cc2e66e4bdba6ac820e7f25e381f58bea41b5fc
  | typeof AlgoSafeClient_ebd1cf101b997b6a914caa195aa7d3eb050d557dc823edab438cc30cbf156b1e

const CLIENT_REGISTRY = {
  '1a77ba21f289ff35d2d54b732cc2e66e4bdba6ac820e7f25e381f58bea41b5fc':
    AlgoSafeClient_1a77ba21f289ff35d2d54b732cc2e66e4bdba6ac820e7f25e381f58bea41b5fc,
  ebd1cf101b997b6a914caa195aa7d3eb050d557dc823edab438cc30cbf156b1e:
    AlgoSafeClient_ebd1cf101b997b6a914caa195aa7d3eb050d557dc823edab438cc30cbf156b1e,
} satisfies Record<ContractHash, AlgoSafeClientConstructor>

export function getClientRegistry() {
  return CLIENT_REGISTRY
}
