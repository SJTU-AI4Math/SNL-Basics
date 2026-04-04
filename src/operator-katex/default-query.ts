import { bindRefAttrFragment, getBindRef } from '../operator-tree/binding'
import { escapeLatexText } from '../operator-tree/latex-escape'
import type { KaTeXTemplateQuery } from '../operator-tree/query'
import type { TemplateDb } from '../operator-tree/template-db'

let dbCache: TemplateDb | null = null
let dbCacheUrl: string | null = null

/** 清空 fetch 缓存，便于切换模板 URL 或热更新 */
export function clearTemplateDbCache(): void {
  dbCache = null
  dbCacheUrl = null
}

/** 直接注入内存中的模板库（如 import json），避免 fetch */
export function setTemplateDbCache(db: TemplateDb | null): void {
  dbCache = db
  dbCacheUrl = '__memory__'
}

/** 与示例站点一致：将 JSON 放在站点 public 根目录时的默认路径 */
export const DEFAULT_TEMPLATE_DB_URL = '/katex-template-db.json'

function fallbackLatexSymbol(name: string): string {
  if (/^[A-Za-z]+$/.test(name)) {
    return name
  }
  return `\\mathrm{${escapeLatexText(name)}}`
}

async function resolveTemplateDb(url: string): Promise<TemplateDb> {
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
  dbCache = (await res.json()) as TemplateDb
  dbCacheUrl = url
  return dbCache
}

/**
 * 从 URL 拉取模板库（带缓存）。可与 {@link createDefaultTemplateQuery} 配合；
 * 若已 {@link setTemplateDbCache}，则直接返回注入的对象。
 */
export async function loadTemplateDb(url: string = DEFAULT_TEMPLATE_DB_URL): Promise<TemplateDb> {
  if (dbCache && dbCacheUrl === '__memory__') {
    return dbCache
  }
  return resolveTemplateDb(url)
}

function buildQueryBody(db: TemplateDb): KaTeXTemplateQuery {
  return async ({ name, style, node }) => {
    const byName = db[name]
    const template = style && byName?.styles?.[style]?.latex
    if (template) {
      return template
    }
    if (style === 'app' && node.children.length === 1) {
      const sym =
        /^[A-Za-z]+$/.test(name) && name.length === 1
          ? name
          : `\\mathrm{${escapeLatexText(name)}}`
      return `\\htmlData{name=@NAME@,style=@STYLE@,kind=const}{\\htmlData{name=@NAME@,style=@STYLE@,kind=@KIND@}{${sym}}\\left(@CHILD1@\\right)}`
    }
    const br = bindRefAttrFragment(getBindRef(node))
    if (node.kind === 'bvar') {
      return `\\htmlData{name=@NAME@,style=@STYLE@,kind=bvar${br}}{${fallbackLatexSymbol(name)}}`
    }
    if (node.kind === 'binder') {
      return `\\htmlData{name=@NAME@,style=@STYLE@,kind=binder${br}}{${fallbackLatexSymbol(name)}}`
    }
    return `\\htmlData{name=@NAME@,style=@STYLE@,kind=fvar}{${fallbackLatexSymbol(name)}}`
  }
}

/**
 * 使用已加载的 {@link TemplateDb} 构建查询（无网络、无延迟）。
 * 适合 `import db from './katex-template-db.json'` 后传入。
 */
export function createTemplateQueryFromDb(db: TemplateDb): KaTeXTemplateQuery {
  return buildQueryBody(db)
}

export interface DefaultTemplateQueryOptions {
  /** 模板库 URL，默认 {@link DEFAULT_TEMPLATE_DB_URL} */
  templateDbUrl?: string
  /** 模拟异步（与旧 demo 一致）；默认 100ms，设为 0 关闭 */
  artificialDelayMs?: number
}

/**
 * 默认 KaTeX 模板查询：按 DB 中 name/style 取 latex，否则回退 bvar/binder/fvar 等。
 * 首次调用会从 `templateDbUrl` fetch（除非已通过 {@link setTemplateDbCache} 注入）。
 */
export function createDefaultTemplateQuery(options?: DefaultTemplateQueryOptions): KaTeXTemplateQuery {
  const url = options?.templateDbUrl ?? DEFAULT_TEMPLATE_DB_URL
  const delay = options?.artificialDelayMs ?? 100
  return async (args) => {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    const db = await resolveTemplateDb(url)
    return buildQueryBody(db)(args)
  }
}
