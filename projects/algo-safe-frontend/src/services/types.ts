// src/services/types.ts
export type NetworkId = 'mainnet' | 'testnet' | 'localnet'

export interface Safe {
  name: string
  appId: number
  address: string
  network: NetworkId
}

export type AssetSymbol = 'EURD' | 'ALGO' | 'USDC' | string
export interface Balance {
  symbol: AssetSymbol
  assetId?: number
  amount: number      // human units (not micro)
  decimals: number
  label: string
}

export type AgentStatus = 'active' | 'pending_review' | 'paused'
export interface Agent {
  id: string
  alias: string
  address: string
  purpose: string
  primaryAsset: AssetSymbol
  dailyLimit: number
  status: AgentStatus
  groupTier: string   // e.g. "Tier 3 - Automated Execution (1/1)"
}

export interface Policy {
  agentId: string
  dailyLimit: number
  monthlyLimit: number
  dailyUsed: number
  monthlyUsed: number
  minIntervalSec: number
  maxTxPerMin: number
  allowlist: string[]
  multiSigRequired: boolean
}

export type ProposalStatus = 'draft' | 'pending' | 'executed' | 'rejected' | 'expired' | 'blocked'
export interface TxLine { type: 'pay' | 'axfer' | 'appl' | 'keyreg'; summary: string; detail: string }
export interface PolicyCheck { label: string; passed: boolean }
export interface Proposal {
  id: string
  title: string
  description: string
  status: ProposalStatus
  approvals: number
  threshold: number
  amount?: number
  asset?: AssetSymbol
  date: string        // human label e.g. "Today, 14:30"
  txPreview: TxLine[]
  policyChecks: PolicyCheck[]
  blockedReason?: string
}

export interface QuantozTransaction {
  txCode: string
  type: 'Payment' | 'Funding' | 'Payout'
  amount: number
  status: string
  date: string
  counterparty?: string
}

export interface FundByBankCountry { countryCode: string; name: string }
export interface FundByBankBank { bankId: string; name: string }
export interface FundingSession { sessionReference: string; redirectUrl: string; status: string }

export interface RegisterAgentInput {
  alias: string
  address: string
  purpose: string
  groupTier: string
  dailyLimit: number
  primaryAsset: AssetSymbol
}
export interface PolicyChangeInput { agentId: string; policy: Partial<Policy> }

export type SafeTier = string // e.g. "2-of-3 Multisig"
export interface SafeSummary {
  safeId: string
  name: string
  appId: number
  address: string
  tier: SafeTier
  totalValueEur: number
  agentCount: number
  status: 'active' | 'paused'
}

export type AssetHoldingType = 'native' | 'stablecoin' | 'lending'
export interface AssetHolding {
  symbol: AssetSymbol
  name: string          // "Algorand Native", "EURD"
  assetId?: number
  amount: number        // human units
  valueEur: number
  type: AssetHoldingType
  apy?: number          // for lending positions
}

export interface TreasurySummary {
  totalValueEur: number
  availableAlgo: number
  availableEurd: number
}

export interface CreateSafeInput {
  name: string
  threshold: number
  signerCount: number
  initialDepositEurd: number
}
