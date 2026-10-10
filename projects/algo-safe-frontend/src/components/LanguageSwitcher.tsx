import { useTranslation } from 'react-i18next'
import { LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES } from '../i18n/languages'

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation('common')
  return (
    <select
      aria-label={t('language')}
      title={t('language')}
      className="rounded-lg border border-outline-variant bg-surface-container-low px-2 py-1.5 text-sm text-on-surface"
      value={i18n.resolvedLanguage}
      onChange={(e) => {
        try {
          localStorage.setItem(LANGUAGE_STORAGE_KEY, e.target.value)
        } catch {
          // storage unavailable (private mode): choice just won't persist
        }
        void i18n.changeLanguage(e.target.value)
      }}
    >
      {SUPPORTED_LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.name}
        </option>
      ))}
    </select>
  )
}
