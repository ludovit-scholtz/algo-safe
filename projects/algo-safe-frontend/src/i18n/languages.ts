export interface LanguageInfo {
  code: string
  /** Endonym shown in the language switcher (never translated). */
  name: string
}

export const SUPPORTED_LANGUAGES: readonly LanguageInfo[] = [
  { code: 'en', name: 'English' },
  { code: 'sk', name: 'Slovenčina' },
  { code: 'pl', name: 'Polski' },
  { code: 'hu', name: 'Magyar' },
  { code: 'it', name: 'Italiano' },
  { code: 'ru', name: 'Русский' },
  { code: 'zh', name: '中文' },
  { code: 'ko', name: '한국어' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
]

export const LANGUAGE_STORAGE_KEY = 'algo-safe-lang'

export const DEFAULT_LANGUAGE = 'en'

/** Namespaces; each maps to src/locales/<lang>/<ns>.json. */
export const NAMESPACES = ['common', 'layout', 'safes', 'signers', 'proposals', 'agents', 'walletconnect', 'upgrade', 'treasury'] as const

export type Namespace = (typeof NAMESPACES)[number]
