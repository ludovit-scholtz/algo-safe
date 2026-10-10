import i18n from './instance'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, NAMESPACES, SUPPORTED_LANGUAGES } from './languages'

type Resources = Record<string, Record<string, Record<string, unknown>>>

// Bundle every locale JSON (eager: small and avoids a flash of untranslated keys).
const modules = import.meta.glob('../locales/*/*.json', { eager: true, import: 'default' }) as Record<string, Record<string, unknown>>

const resources: Resources = {}
for (const [path, content] of Object.entries(modules)) {
  const match = path.match(/locales\/([^/]+)\/([^/]+)\.json$/)
  if (!match) continue
  const [, lng, ns] = match
  resources[lng] ??= {}
  resources[lng][ns] = content
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    nonExplicitSupportedLngs: true, // de-AT -> de, zh-CN -> zh
    load: 'languageOnly',
    ns: [...NAMESPACES],
    defaultNS: 'common',
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: [], // persisted only on an explicit choice (see LanguageSwitcher)
    },
    returnNull: false,
  })

const syncHtmlLang = (lng: string) => {
  if (typeof document !== 'undefined') document.documentElement.lang = lng
}
syncHtmlLang(i18n.resolvedLanguage ?? DEFAULT_LANGUAGE)
i18n.on('languageChanged', syncHtmlLang)

export default i18n
