// src/services/index.ts
import { createContext, useContext } from 'react'
import type { SafeService } from './SafeService'
import type { QuantozService } from './quantoz/QuantozService'
import { safeMock } from './mock/safeMock'
import { quantozMock } from './quantoz/quantozMock'
import { quantozClient } from './quantoz/quantozClient'
import { quantozEnabled } from '../lib/env'

// Wrap each live Quantoz method so any failure falls back to mock (and reports not-live).
function withFallback(live: QuantozService, mock: QuantozService): QuantozService {
  const wrap = <K extends keyof QuantozService>(k: K) =>
    (async (...args: unknown[]) => {
      try {
        return await (live[k] as (...a: unknown[]) => Promise<unknown>)(...args)
      } catch {
        return (mock[k] as (...a: unknown[]) => Promise<unknown>)(...args)
      }
    }) as QuantozService[K]
  return {
    isLive: () => true,
    getEurdBalance: wrap('getEurdBalance'),
    getTransactions: wrap('getTransactions'),
    getFundByBankCountries: wrap('getFundByBankCountries'),
    getFundByBankBanks: wrap('getFundByBankBanks'),
    createFundByBankSession: wrap('createFundByBankSession'),
  }
}

export interface Services {
  safe: SafeService
  quantoz: QuantozService
  quantozLive: boolean
}
export const services: Services = {
  safe: safeMock,
  quantoz: quantozEnabled() ? withFallback(quantozClient, quantozMock) : quantozMock,
  quantozLive: quantozEnabled(),
}

const ServiceContext = createContext<Services>(services)
export const ServiceProvider = ServiceContext.Provider
export const useServices = () => useContext(ServiceContext)
