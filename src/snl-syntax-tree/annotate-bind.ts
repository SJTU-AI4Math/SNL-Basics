import type { SnlSyntaxTree } from './types'

/** 编译期为量词子树分配 bindRef，按变量名把 bvar 与引入处配对（不依赖 de Bruijn level） */
export function annotateBindings(root: SnlSyntaxTree): void {
  let id = 0
  const nextRef = () => `b${++id}`

  function walk(node: SnlSyntaxTree, stack: Array<{ name: string; ref: string }>): void {
    if (node.name === 'FOL.forall' || node.name === 'FOL.exists') {
      const ref = nextRef()
      const base = node.mdata && typeof node.mdata === 'object' ? node.mdata : {}
      node.mdata = { ...base, bindRef: ref }
      const ch = node.children
      if (ch.length >= 1) {
        const v = ch[0]
        const vb = v.mdata && typeof v.mdata === 'object' ? v.mdata : {}
        v.mdata = { ...vb, bindRef: ref }
      }
      if (ch.length === 2) {
        walk(ch[0], stack)
        walk(ch[1], [...stack, { name: ch[0].name, ref }])
      } else if (ch.length >= 3) {
        walk(ch[0], stack)
        walk(ch[1], stack)
        walk(ch[2], [...stack, { name: ch[0].name, ref }])
      }
      return
    }

    if (node.kind === 'bvar' && node.children.length === 0) {
      const frame = [...stack].reverse().find((f) => f.name === node.name)
      const base = node.mdata && typeof node.mdata === 'object' ? node.mdata : {}
      if (frame) {
        node.mdata = { ...base, bindRef: frame.ref }
      } else {
        node.mdata = Object.keys(base).length ? base : null
      }
      return
    }

    // 无 [bvar] 标注的裸名叶子：在父语境中按名字查找 binder，有则 bvar，否则 fvar。
    if (node.children.length === 0 && !node.style && !node.kind) {
      const frame = [...stack].reverse().find((f) => f.name === node.name)
      const base = node.mdata && typeof node.mdata === 'object' ? node.mdata : {}
      if (frame) {
        node.kind = 'bvar'
        node.mdata = { ...base, bindRef: frame.ref }
      } else {
        node.kind = 'fvar'
        node.mdata = Object.keys(base).length ? base : null
      }
      return
    }

    for (const c of node.children) {
      walk(c, stack)
    }
  }

  walk(root, [])
}
