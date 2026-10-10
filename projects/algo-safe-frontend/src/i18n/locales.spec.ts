import fs from 'node:fs'
import path from 'node:path'
import { NAMESPACES, SUPPORTED_LANGUAGES } from './languages'

const LOCALES_DIR = path.resolve(__dirname, '../locales')

type Json = { [k: string]: Json | string }

const flatten = (obj: Json, prefix = ''): string[] =>
  Object.entries(obj).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`)))

const flattenValues = (obj: Json, prefix = ''): Record<string, string> =>
  Object.entries(obj).reduce<Record<string, string>>((acc, [k, v]) => {
    if (typeof v === 'string') acc[`${prefix}${k}`] = v
    else Object.assign(acc, flattenValues(v, `${prefix}${k}.`))
    return acc
  }, {})

const load = (lng: string, ns: string): Json => JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, lng, `${ns}.json`), 'utf8'))

const placeholders = (s: string) => (s.match(/{{\s*[\w.]+\s*}}|<\/?[a-z0-9]+\s*\/?>/gi) ?? []).map((p) => p.replace(/\s/g, '')).sort()

// Strip plural suffixes so languages with different plural categories compare by base key.
const baseKey = (k: string) => k.replace(/_(zero|one|two|few|many|other)$/, '')

describe.each(NAMESPACES)('locale namespace %s', (ns) => {
  const en = flattenValues(load('en', ns))
  const enBase = [...new Set(Object.keys(en).map(baseKey))].sort()

  it.each(SUPPORTED_LANGUAGES.filter((l) => l.code !== 'en').map((l) => l.code))('%s has the same keys and placeholders as en', (lng) => {
    const other = flattenValues(load(lng, ns))
    expect([...new Set(Object.keys(other).map(baseKey))].sort()).toEqual(enBase)
    expect(flatten(load(lng, ns)).every((k) => other[k].trim().length > 0)).toBe(true)
    // Every plural group must carry exactly the CLDR categories the language needs.
    const categories = new Intl.PluralRules(lng).resolvedOptions().pluralCategories
    const groups: Record<string, string[]> = {}
    for (const k of Object.keys(other)) {
      const m = k.match(/^(.*)_(zero|one|two|few|many|other)$/)
      if (m) (groups[m[1]] ??= []).push(m[2])
    }
    for (const [base, found] of Object.entries(groups)) {
      expect({ base, cats: [...found].sort() }).toEqual({ base, cats: [...categories].sort() })
    }
    for (const [k, v] of Object.entries(other)) {
      const enKey = en[k] !== undefined ? k : Object.keys(en).find((e) => baseKey(e) === baseKey(k))!
      expect(placeholders(v).filter((p) => p !== '{{count}}')).toEqual(placeholders(en[enKey]).filter((p) => p !== '{{count}}'))
    }
  })
})
