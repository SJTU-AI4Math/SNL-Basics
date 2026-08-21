import type { SnlBlockMacroTemplate } from './types'
import type {
  SnlTableCssColors,
  SnlTableRenderOptions,
} from './types'
export type {
  SnlTableComposition,
  SnlTableCssColors,
  SnlTableCssThemes,
  SnlTableRenderOptions,
} from './types'

const DEFAULT_OPTIONS: SnlTableRenderOptions = Object.freeze({ composition: 'rows' })
const OPTION_KEYS = new Set(['composition', 'css'])
const THEME_KEYS = new Set(['light', 'dark'])
const COLOR_KEYS = new Set(['color', 'background', 'border'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const SAFE_COLOR_FUNCTIONS = new Set([
  'rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch',
  'color', 'color-mix', 'light-dark', 'device-cmyk', 'var', 'calc', 'min',
  'max', 'clamp',
])

function isSafeCssColorToken(token: string): boolean {
  const value = token.trim()
  if (value === '') return true
  if (value.length > 128 || /[\u0000-\u001f\u007f-\u009f;{}\\'"]/.test(value)) return false
  if (/^#[0-9a-f]{3,4}$/i.test(value) || /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) return true
  if (/^[a-z][a-z0-9-]*$/i.test(value)) return true
  if (!/^[a-z0-9_#.%(),+*/\s-]+$/i.test(value)) return false
  const functions = [...value.matchAll(/([a-z][a-z0-9-]*)\s*\(/gi)]
  if (functions.length === 0 || functions[0].index !== 0 ||
      functions.some((match) => !SAFE_COLOR_FUNCTIONS.has(match[1].toLowerCase()))) return false
  let depth = 0
  for (const char of value) {
    if (char === '(') depth += 1
    else if (char === ')' && --depth < 0) return false
  }
  return depth === 0
}

function readColors(value: unknown, label: string): SnlTableCssColors {
  if (!isRecord(value) || Object.keys(value).some((key) => !COLOR_KEYS.has(key)) ||
      typeof value.color !== 'string' || typeof value.background !== 'string' ||
      typeof value.border !== 'string') {
    throw new Error(`table.css.${label} must contain string color, background, and border fields`)
  }
  for (const token of [value.color, value.background, value.border]) {
    if (!isSafeCssColorToken(token)) {
      throw new Error(`table.css.${label} contains an invalid CSS color`)
    }
  }
  return { color: value.color, background: value.background, border: value.border }
}

/** Read and validate the Basics-owned `template.table` renderer contract. */
export function readSnlTableRenderOptions(
  template: SnlBlockMacroTemplate,
): SnlTableRenderOptions {
  const raw = template.table
  if (raw === undefined) return DEFAULT_OPTIONS
  if (!isRecord(raw) || Object.keys(raw).some((key) => !OPTION_KEYS.has(key)) ||
      (raw.composition !== 'rows' && raw.composition !== 'cells')) {
    throw new Error('template.table must select composition "rows" or "cells"')
  }
  if (raw.css === undefined) return { composition: raw.composition }
  if (!isRecord(raw.css) || Object.keys(raw.css).some((key) => !THEME_KEYS.has(key)) ||
      !Object.hasOwn(raw.css, 'light') || !Object.hasOwn(raw.css, 'dark')) {
    throw new Error('template.table.css must contain complete light and dark themes')
  }
  return {
    composition: raw.composition,
    css: {
      light: readColors(raw.css.light, 'light'),
      dark: readColors(raw.css.dark, 'dark'),
    },
  }
}
