import type { ButtonHTMLAttributes } from 'react'
type V = 'primary' | 'secondary' | 'ghost' | 'danger'
const styles: Record<V, string> = {
  primary: 'bg-ink-900 text-white hover:bg-ink-700',
  secondary: 'bg-white text-ink-900 border border-surface-border hover:bg-surface-muted',
  ghost: 'text-ink-700 hover:bg-surface-muted',
  danger: 'bg-danger text-white hover:opacity-90',
}
export const Button = ({ variant = 'primary', className = '', ...p }: { variant?: V } & ButtonHTMLAttributes<HTMLButtonElement>) =>
  <button className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${styles[variant]} ${className}`} {...p} />
