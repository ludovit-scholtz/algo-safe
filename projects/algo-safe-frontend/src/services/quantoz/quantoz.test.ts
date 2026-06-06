// src/services/quantoz/quantoz.test.ts
import { quantozMock } from './quantozMock'
test('quantoz mock reports not-live and returns a seeded EURD balance', async () => {
  expect(quantozMock.isLive()).toBe(false)
  const bal = await quantozMock.getEurdBalance()
  expect(bal.symbol).toBe('EURD')
  expect(bal.amount).toBeGreaterThan(0)
})
