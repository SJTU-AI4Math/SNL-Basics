import type { OperatorTree } from './types'

/** 编译期 annotate 写入的绑定实例 id；KaTeX \\htmlData 键 bindRef 会变成属性 data-bindRef，读 DOM 时需兼容 dataset.bindref / data-bind-ref */
export function getBindRef(node: OperatorTree): string | undefined {
  if (!node.mdata || typeof node.mdata !== 'object') {
    return undefined
  }
  const v = (node.mdata as { bindRef?: unknown }).bindRef
  if (v === undefined || v === null) {
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
