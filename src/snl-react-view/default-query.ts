import { escapeLatexText } from '../snl-syntax-tree/latex-escape'
import type { SnlMacroTemplateQuery } from '../snl-syntax-tree/query'
import type { SnlMacroDb } from '../snl-macro/types'

let dbCache: SnlMacroDb | null = null
let dbCacheUrl: string | null = null

/** 清空 fetch 缓存，便于切换模板 URL 或热更新 */
export function clearSnlMacroDbCache(): void {
  dbCache = null
  dbCacheUrl = null
}

/** 直接注入内存中的模板库（如 import json），避免 fetch */
export function setSnlMacroDbCache(db: SnlMacroDb | null): void {
  dbCache = db
  dbCacheUrl = '__memory__'
}

/** 与示例站点一致：将 JSON 放在站点 public 根目录时的默认路径 */
export const DEFAULT_SNL_MACRO_DB_URL = '/snl-macro-db.json'

function fallbackLatexSymbol(name: string): string {
  if (/^[A-Za-z]+$/.test(name)) {
    return name
  }
  return `\\mathrm{${escapeLatexText(name)}}`
}

async function resolveSnlMacroDb(url: string): Promise<SnlMacroDb> {
  if (dbCache && dbCacheUrl === '__memory__') {
    return dbCache
  }
  if (dbCache && dbCacheUrl === url) {
    return dbCache
  }
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`template db load failed (${res.status}): ${url}`)
  }
  dbCache = (await res.json()) as SnlMacroDb
  dbCacheUrl = url
  return dbCache
}

/**
 * 从 URL 拉取模板库（带缓存）。可与 {@link createDefaultMacroTemplateQuery} 配合；
 * 若已 {@link setSnlMacroDbCache}，则直接返回注入的对象。
 */
export async function loadSnlMacroDb(url: string = DEFAULT_SNL_MACRO_DB_URL): Promise<SnlMacroDb> {
  if (dbCache && dbCacheUrl === '__memory__') {
    return dbCache
  }
  return resolveSnlMacroDb(url)
}

function buildQueryBody(db: SnlMacroDb): SnlMacroTemplateQuery {
  return async ({ name }) => {
    const template = db[name]?.katex_react?.template
    if (template) {
      return template
    }
    // No DB template → bare symbol. The view layer auto-wraps the result in
    // \htmlData with the node's kind (bvar / binder / fvar, set by annotation)
    // and bindRef, so no metadata is written here.
    return fallbackLatexSymbol(name)
  }
}

/**
 * 使用已加载的 {@link SnlMacroDb} 构建查询（无网络、无延迟）。
 * 适合 `import db from './snl-macro-db.json'` 后传入。
 */
export function createMacroTemplateQueryFromDb(db: SnlMacroDb): SnlMacroTemplateQuery {
  return buildQueryBody(db)
}

/** Options for {@link createDefaultMacroTemplateQuery}. */
export interface DefaultMacroTemplateQueryOptions {
  /** 模板库 URL，默认 {@link DEFAULT_SNL_MACRO_DB_URL} */
  templateDbUrl?: string
  /** 模拟异步（与旧 demo 一致）；默认 100ms，设为 0 关闭 */
  artificialDelayMs?: number
}

/**
 * 默认 KaTeX 模板查询：按 DB 中 name/style 取 latex，否则回退 bvar/binder/fvar 等。
 * 首次调用会从 `templateDbUrl` fetch（除非已通过 {@link setSnlMacroDbCache} 注入）。
 */
export function createDefaultMacroTemplateQuery(options?: DefaultMacroTemplateQueryOptions): SnlMacroTemplateQuery {
  const url = options?.templateDbUrl ?? DEFAULT_SNL_MACRO_DB_URL
  const delay = options?.artificialDelayMs ?? 100
  return async (args) => {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    const db = await resolveSnlMacroDb(url)
    return buildQueryBody(db)(args)
  }
}
