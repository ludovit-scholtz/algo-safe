import type { ButtonHTMLAttributes } from 'react'
type V = 'primary' | 'secondary' | 'ghost' | 'danger'
const styles: Record<V, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-container',
  secondary: 'bg-transparent text-primary border border-primary hover:bg-surface-container-high',
  ghost: 'text-on-surface-variant hover:bg-surface-container-high',
  danger: 'bg-error-container text-on-error-container hover:opacity-90',
}
export const Button = ({ variant = 'primary', className = '', ...p }: { variant?: V } & ButtonHTMLAttributes<HTMLButtonElement>) =>
  <button className={`inline-flex items-center justify-center gap-2 rounded-sm px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${styles[variant]} ${className}`} {...p} />
