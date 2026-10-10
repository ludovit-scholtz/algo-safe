import i18n from 'i18next'

// Bare i18next instance with no bundled resources, safe to import from services,
// libs and Jest tests. Resources are registered by ./setup (imported once from main.tsx).
export default i18n

/** Active language code, usable for Intl formatters. */
export const currentLocale = () => i18n.resolvedLanguage ?? 'en'

/** Neutralize angle brackets in untrusted values passed to <Trans values>, which are parsed as markup after interpolation. */
export const stripMarkup = (value: string) => value.replace(/[<>]/g, '')
