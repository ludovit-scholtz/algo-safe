// src/services/quantoz/quantozClient.ts
// Calls the Quantoz MCP server (JSON-RPC tools/call) with X-API-KEY.
import type { QuantozService } from './QuantozService'
import type { Balance, QuantozTransaction, FundByBankCountry, FundByBankBank, FundingSession } from '../types'
import { env } from '../../lib/env'

async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${env.quantozMcpUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': env.quantozApiKey ?? '' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }),
  })
  if (!res.ok) throw new Error(`Quantoz ${name} HTTP ${res.status}`)
  const json = await res.json()
  if (json.error) throw new Error(`Quantoz ${name}: ${json.error.message ?? 'error'}`)
  // MCP tool results arrive as content[].text (JSON string) — parse the first text part.
  const text = json.result?.content?.find?.((c: { type: string }) => c.type === 'text')?.text
  return (text ? JSON.parse(text) : json.result) as T
}

export const quantozClient: QuantozService = {
  isLive: () => true,
  async getEurdBalance() {
    const r = await callTool<{ balance?: number; amount?: number }>('get_account_balance', { accountCode: env.quantozAccountCode })
    const amount = (r.balance ?? r.amount ?? 0)
    return { symbol: 'EURD', assetId: 1221682136, amount, decimals: 2, label: 'EURD Balance' }
  },
  async getTransactions() {
    const r = await callTool<{ items?: QuantozTransaction[] }>('get_transactions', { accountCode: env.quantozAccountCode, pageSize: 10 })
    return r.items ?? (Array.isArray(r) ? (r as unknown as QuantozTransaction[]) : [])
  },
  async getFundByBankCountries() {
    const r = await callTool<{ items?: FundByBankCountry[] }>('get_fund_by_bank_countries', {})
    return r.items ?? (r as unknown as FundByBankCountry[])
  },
  async getFundByBankBanks(countryCode) {
    const r = await callTool<{ items?: FundByBankBank[] }>('get_fund_by_bank_banks', { countryCode })
    return r.items ?? (r as unknown as FundByBankBank[])
  },
  async createFundByBankSession(a) {
    return callTool<FundingSession>('create_fund_by_bank_session', { countryCode: a.countryCode, bankId: a.bankId, amount: a.amount, redirectUrl: a.redirectUrl, accountCode: env.quantozAccountCode })
  },
}
