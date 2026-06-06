// src/services/quantoz/QuantozService.ts
import type { Balance, QuantozTransaction, FundByBankCountry, FundByBankBank, FundingSession } from '../types'
export interface QuantozService {
  isLive(): boolean
  getEurdBalance(): Promise<Balance>
  getTransactions(): Promise<QuantozTransaction[]>
  getFundByBankCountries(): Promise<FundByBankCountry[]>
  getFundByBankBanks(countryCode: string): Promise<FundByBankBank[]>
  createFundByBankSession(args: { countryCode: string; bankId: string; amount: number; redirectUrl: string }): Promise<FundingSession>
}
