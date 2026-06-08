// src/lib/format.ts
export const fmtEur = (n: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(n)
export const fmtNum = (n: number) => new Intl.NumberFormat('en-US').format(n)
export const shortAddr = (a: string, n = 4) => (a.length > 2 * n ? `${a.slice(0, n)}...${a.slice(-n)}` : a)
