import type { SnlSyntaxTree } from './types'

/** 编译期 annotate 写入的绑定实例 id；KaTeX \\htmlData 键 bindRef 会变成属性 data-bindRef，读 DOM 时需兼容 dataset.bindref / data-bind-ref */
export function getBindRef(node: SnlSyntaxTree): string | undefined {
  if (!node.mdata || typeof node.mdata !== 'object') {
    return undefined
  }
  const v = (node.mdata as { bindRef?: unknown }).bindRef
  if (v === undefined || v === null) {
    return undefined
  }
  return String(v)
}

/**
 * Cross-entry source reference (cat 2026-07-09 spec §src-postfix). The
 * parser attaches `mdata.src` for the `x@foo` postfix; renderer surfaces
 * it via a KaTeX `\htmlData{src=…}` attribute so the extension side can
 * bind hover / navigate / warn handlers.
 *
 * Nothing in SNL-Basics interprets the string — the extension's
 * EntryRender resolves it against the workspace entry pool.
 */
export function getSrc(node: SnlSyntaxTree): string | undefined {
  if (!node.mdata || typeof node.mdata !== 'object') {
    return undefined
  }
  const v = (node.mdata as { src?: unknown }).src
  if (v === undefined || v === null || v === '') {
    return undefined
  }
  return String(v)
}

export function bindRefAttrFragment(ref: string | undefined): string {
  return ref ? `,bindRef=${ref}` : ''
}

/** 从已渲染的 KaTeX span 读取 bindRef（与 querySelector([data-bind-ref]) 不可靠） */
export function readBindRefFromDom(el: HTMLElement): string {
  const ds = el.dataset as Record<string, string | undefined>
  return (
    ds.bindRef ??
    ds.bindref ??
    el.getAttribute('data-bindRef') ??
    el.getAttribute('data-bindref') ??
    el.getAttribute('data-bind-ref') ??
    ''
  )
}

/**
 * Symmetric DOM reader for `data-src` — the cross-entry reference set by
 * `getSrc()` at render time. Cross-checked against the same casing quirks
 * as `readBindRefFromDom` because KaTeX likewise normalizes attribute
 * casing inconsistently across browser versions.
 */
export function readSrcFromDom(el: HTMLElement): string {
  const ds = el.dataset as Record<string, string | undefined>
  return (
    ds.src ??
    el.getAttribute('data-src') ??
    ''
  )
}
