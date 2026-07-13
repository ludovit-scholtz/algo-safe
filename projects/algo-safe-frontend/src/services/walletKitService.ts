// Wallet-side WalletConnect (Reown WalletKit) subsystem: lets a paired dapp send
// session requests *to* this app, treating the connected Algo Safe as the account.
// This is the inverse of the outbound `@txnlab/use-wallet-react` connector in App.tsx.
import { Core } from '@walletconnect/core'
import { buildApprovedNamespaces } from '@walletconnect/utils'
import { WalletKit, type WalletKitTypes } from '@reown/walletkit'
import type { ProposalTypes, SessionTypes } from '@walletconnect/types'
import { env } from '../lib/env'

export const ALGORAND_WC_METHOD = 'algo_signTxn'
const ALGORAND_WC_EVENTS: string[] = []

type WalletKitEvent = WalletKitTypes.Event
type WalletKitEventArgs = WalletKitTypes.EventArguments

let walletKitPromise: Promise<InstanceType<typeof WalletKit>> | null = null

async function createWalletKit() {
  const core = new Core({ projectId: env.walletConnectProjectId })
  return WalletKit.init({
    core,
    metadata: {
      name: 'Biatec Algo Safe',
      description: 'Policy-driven smart account for Algorand — connect a dapp to propose transactions through your Safe.',
      url: window.location.origin,
      icons: [`${window.location.origin}/favicon.svg`],
    },
  })
}

export function getWalletKit() {
  if (!walletKitPromise) {
    walletKitPromise = createWalletKit()
  }
  return walletKitPromise
}

export async function pairWalletConnect(uri: string) {
  const walletKit = await getWalletKit()
  await walletKit.pair({ uri: uri.trim() })
}

/**
 * Reads whatever `algorand` chain reference(s) the dapp actually put in its
 * session proposal — either as a namespace key's `chains` array (`algorand: {
 * chains: ["algorand:X"] }`) or as the chain id used directly as the namespace
 * key (`"algorand:X": {...}`). There's no single agreed CAIP-2 reference
 * format for Algorand across wallets/dapps, so `buildApprovedNamespaces`
 * requires an exact string match against what the dapp requested — computing
 * our own reference and hoping it matches produces an empty (and rejected)
 * approved-namespaces object whenever the two don't agree character-for-character.
 */
function extractRequestedAlgorandChains(proposal: ProposalTypes.Struct): string[] {
  const chains = new Set<string>()
  for (const namespaces of [proposal.requiredNamespaces, proposal.optionalNamespaces]) {
    if (!namespaces) continue
    for (const [key, value] of Object.entries(namespaces)) {
      if (key.startsWith('algorand:')) {
        chains.add(key)
      } else if (key === 'algorand') {
        value.chains?.forEach((chain) => chains.add(chain))
      }
    }
  }
  return Array.from(chains)
}

/**
 * caipChainId here is the `algorand:<reference>` CAIP-2 chain identifier for the
 * safe's active network — the safe's address is exposed as the only account,
 * since this wallet represents the Safe, not the operator's personal signer.
 * Used only as a fallback when the dapp's proposal doesn't name a chain itself.
 */
export async function approveWalletConnectSession(proposal: ProposalTypes.Struct, caipChainId: string, safeAddress: string) {
  const walletKit = await getWalletKit()
  const requestedChains = extractRequestedAlgorandChains(proposal)
  if (requestedChains.length === 0 && !hasAlgorandNamespace(proposal)) {
    throw new Error("This dapp's session proposal did not request the Algorand namespace, so this Safe can't service it.")
  }
  const chains = requestedChains.length > 0 ? requestedChains : [caipChainId]

  const namespaces = buildApprovedNamespaces({
    proposal,
    supportedNamespaces: {
      algorand: {
        chains,
        methods: [ALGORAND_WC_METHOD],
        events: ALGORAND_WC_EVENTS,
        accounts: chains.map((chain) => `${chain}:${safeAddress}`),
      },
    },
  })
  return walletKit.approveSession({ id: proposal.id, namespaces })
}

function hasAlgorandNamespace(proposal: ProposalTypes.Struct): boolean {
  return [proposal.requiredNamespaces, proposal.optionalNamespaces].some(
    (namespaces) => namespaces && Object.keys(namespaces).some((key) => key === 'algorand' || key.startsWith('algorand:')),
  )
}

export async function rejectWalletConnectSession(proposalId: number, message = 'User rejected the session proposal.') {
  const walletKit = await getWalletKit()
  await walletKit.rejectSession({ id: proposalId, reason: { code: 5000, message } })
}

export async function disconnectWalletConnectSession(topic: string) {
  const walletKit = await getWalletKit()
  await walletKit.disconnectSession({ topic, reason: { code: 6000, message: 'User disconnected the session.' } })
}

export async function respondWalletConnectRequest(topic: string, id: number, result: unknown) {
  const walletKit = await getWalletKit()
  await walletKit.respondSessionRequest({ topic, response: { id, jsonrpc: '2.0', result } })
}

export async function rejectWalletConnectRequest(topic: string, id: number, message: string) {
  const walletKit = await getWalletKit()
  await walletKit.respondSessionRequest({
    topic,
    response: { id, jsonrpc: '2.0', error: { code: 5001, message } },
  })
}

export function getActiveWalletConnectSessions(walletKit: InstanceType<typeof WalletKit>): SessionTypes.Struct[] {
  return Object.values(walletKit.getActiveSessions())
}

export type { WalletKitEvent, WalletKitEventArgs }
export { WalletKit }
