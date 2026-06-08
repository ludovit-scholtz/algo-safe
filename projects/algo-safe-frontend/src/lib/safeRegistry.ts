import algosdk from 'algosdk'
import type { NetworkId, Safe, SafeSummary } from '../services/types'

export type SafeRegistryEntry = {
  safeId: string
  name: string
  appId: number
  address: string
  network: NetworkId
  creatorAddress: string
}

const STORAGE_KEY = 'algo-safe.registry'

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function readEntries() {
  if (!canUseStorage()) return [] as SafeRegistryEntry[]

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed.filter((entry): entry is SafeRegistryEntry => {
      return (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as SafeRegistryEntry).safeId === 'string' &&
        typeof (entry as SafeRegistryEntry).name === 'string' &&
        typeof (entry as SafeRegistryEntry).appId === 'number' &&
        typeof (entry as SafeRegistryEntry).address === 'string' &&
        typeof (entry as SafeRegistryEntry).network === 'string' &&
        typeof (entry as SafeRegistryEntry).creatorAddress === 'string'
      )
    })
  } catch {
    return []
  }
}

function writeEntries(entries: SafeRegistryEntry[]) {
  if (!canUseStorage()) return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

function getCanonicalAppAddress(appId: number) {
  return algosdk.getApplicationAddress(appId).toString()
}

function toSafeId(appId: number, network: NetworkId) {
  return `${network}-${appId}`
}

export function normalizeNetworkId(network: string | null | undefined): NetworkId {
  const value = String(network ?? '').toLowerCase()
  if (value === 'voimain') return 'voimain'
  if (value === 'aramidmain') return 'aramidmain'
  if (value === 'localnet') return 'localnet'
  if (value === 'testnet') return 'testnet'
  return 'mainnet'
}

export function listSafeRegistryEntries() {
  return readEntries()
}

export function getSafeRegistryEntryBySafeId(safeId: string) {
  return readEntries().find((entry) => entry.safeId === safeId)
}

export function listSafeRegistryEntriesForWallet(filters: { creatorAddress?: string | null; network?: NetworkId | null }) {
  return readEntries().filter((entry) => {
    if (filters.creatorAddress && entry.creatorAddress !== filters.creatorAddress) return false
    if (filters.network && entry.network !== filters.network) return false
    return true
  })
}

export function upsertSafeRegistryEntry(entry: Omit<SafeRegistryEntry, 'safeId'> & { safeId?: string }) {
  const safeId = entry.safeId ?? toSafeId(entry.appId, entry.network)
  const nextEntry: SafeRegistryEntry = {
    ...entry,
    safeId,
    address: getCanonicalAppAddress(entry.appId),
  }
  const entries = readEntries()
  const existingIndex = entries.findIndex((item) => item.safeId === safeId)

  if (existingIndex >= 0) {
    entries[existingIndex] = nextEntry
  } else {
    entries.unshift(nextEntry)
  }

  writeEntries(entries)
  return nextEntry
}

export function safeRegistryEntryToSafe(entry: SafeRegistryEntry): Safe {
  return {
    name: entry.name,
    appId: entry.appId,
    address: getCanonicalAppAddress(entry.appId),
    network: entry.network,
  }
}

export function safeRegistryEntryToSummary(entry: SafeRegistryEntry): SafeSummary {
  return {
    safeId: entry.safeId,
    name: entry.name,
    appId: entry.appId,
    address: getCanonicalAppAddress(entry.appId),
    tier: 'On-chain Safe',
    totalValueEur: 0,
    agentCount: 0,
    status: 'active',
  }
}
