// src/services/quantoz/quantozMock.ts
import i18n from '../../i18n/instance'
import type { QuantozService } from './QuantozService'
const delay = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 150))
export const quantozMock: QuantozService = {
  isLive: () => false,
  getEurdBalance: () =>
    delay({ symbol: 'EURD', assetId: 1221682136, amount: 2450000, decimals: 2, label: i18n.t('agents:quantoz.eurdBalance') }),
  getTransactions: () =>
    delay([
      {
        txCode: 'QP2026...A1',
        type: 'Payment',
        amount: 15000,
        status: i18n.t('agents:quantoz.statusCompleted'),
        date: i18n.t('agents:quantoz.dateYesterday'),
        counterparty: i18n.t('agents:quantoz.counterpartyAudit'),
      },
      {
        txCode: 'QP2026...B2',
        type: 'Funding',
        amount: 50000,
        status: i18n.t('agents:quantoz.statusCompleted'),
        date: i18n.t('agents:quantoz.dateOct22'),
      },
    ]),
  getFundByBankCountries: () =>
    delay([
      { countryCode: 'NL', name: i18n.t('agents:quantoz.countryNL') },
      { countryCode: 'DE', name: i18n.t('agents:quantoz.countryDE') },
    ]),
  getFundByBankBanks: () =>
    delay([
      { bankId: 'ideal-ing', name: 'ING' },
      { bankId: 'ideal-rabo', name: 'Rabobank' },
    ]),
  createFundByBankSession: (a) => delay({ sessionReference: 'demo-session', redirectUrl: `${a.redirectUrl}?demo=1`, status: 'Open' }),
}
