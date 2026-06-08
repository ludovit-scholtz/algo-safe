// src/services/quantoz/quantozMock.ts
import type { QuantozService } from './QuantozService'
const delay = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 150))
export const quantozMock: QuantozService = {
  isLive: () => false,
  getEurdBalance: () => delay({ symbol: 'EURD', assetId: 1221682136, amount: 2450000, decimals: 2, label: 'EURD Balance' }),
  getTransactions: () =>
    delay([
      { txCode: 'QP2026...A1', type: 'Payment', amount: 15000, status: 'Completed', date: 'Yesterday', counterparty: 'Security Audit' },
      { txCode: 'QP2026...B2', type: 'Funding', amount: 50000, status: 'Completed', date: 'Oct 22' },
    ]),
  getFundByBankCountries: () =>
    delay([
      { countryCode: 'NL', name: 'Netherlands' },
      { countryCode: 'DE', name: 'Germany' },
    ]),
  getFundByBankBanks: () =>
    delay([
      { bankId: 'ideal-ing', name: 'ING' },
      { bankId: 'ideal-rabo', name: 'Rabobank' },
    ]),
  createFundByBankSession: (a) => delay({ sessionReference: 'demo-session', redirectUrl: `${a.redirectUrl}?demo=1`, status: 'Open' }),
}
