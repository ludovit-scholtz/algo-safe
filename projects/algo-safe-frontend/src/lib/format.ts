// src/lib/format.ts
import { currentLocale } from '../i18n/instance'

export const fmtEur = (n: number) => new Intl.NumberFormat(currentLocale(), { style: 'currency', currency: 'EUR' }).format(n)
export const fmtNum = (n: number) => new Intl.NumberFormat(currentLocale()).format(n)
export const shortAddr = (a: string, n = 4) => (a.length > 2 * n ? `${a.slice(0, n)}...${a.slice(-n)}` : a)

/**
 * Locale-aware rendering of an exact base-unit amount (no float rounding): groups the whole part
 * and uses the locale's decimal separator for the fraction.
 */
export const fmtUnits = (amount: bigint, decimals: number) => {
  const negative = amount < 0n
  const padded = (negative ? -amount : amount).toString().padStart(decimals + 1, '0')
  const whole = decimals === 0 ? padded : padded.slice(0, -decimals)
  const fraction = decimals === 0 ? '' : padded.slice(-decimals).replace(/0+$/, '')
  const nf = new Intl.NumberFormat(currentLocale())
  const decimal = nf.formatToParts(1.1).find((part) => part.type === 'decimal')?.value ?? '.'
  return `${negative ? '-' : ''}${nf.format(BigInt(whole))}${fraction ? decimal + fraction : ''}`
}
