# Frontend localization

- Library: i18next + react-i18next. Setup: `src/i18n/setup.ts`; language list + namespaces: `src/i18n/languages.ts`.
- Files: `src/locales/<lang>/<namespace>.json` for every language in `SUPPORTED_LANGUAGES` and every namespace in `NAMESPACES`.
- `en` is the source and fallback; all other languages must contain exactly the same keys (enforced by `src/i18n/locales.spec.ts`).
- In components: `const { t } = useTranslation('<ns>')`. In non-React code: `import i18n from '../i18n/instance'` then `i18n.t('<ns>:key', { ... })` evaluated at call time (never at module load).
- Plurals use i18next suffixes (`key_one`, `key_other`, plus `_few`/`_many` for ru/pl, etc. as required by `Intl.PluralRules`).
- Never translate: addresses, contract constants, network ids, the "Algo Safe" brand, ticker symbols.
