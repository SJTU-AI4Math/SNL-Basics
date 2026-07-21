import type { SnlSyntaxTree } from './types'

// annotate-bind: after the parser produces a tree, walk it to assign bindRef
// links and to resolve delimited-name leaves as bvar / fvar based on the
// enclosing binder scope.
//
// A "binder" is either:
//   (a) a legacy hardcoded Type.forall / FOL.exists quantifier (see below).
//       The first child is the introduction site of the bound variable and
//       gets kind='binder' + bindRef, and its name becomes an active binder
//       for the quantifier body's parse.
//   (b) a node the parser tagged with kind='binder' via the `@` prefix
//       (2026-07-04-late spec 2). `@` recursively marks a node AND every
//       descendant as binder, so a nested @-subtree contributes MULTIPLE
//       binder names to the enclosing scope (all descendants' names).
//
// After all binders are stamped, a naked leaf (no kind, no children — or an
// envMode-carrying delimited leaf whose kind wasn't decided by the parser)
// is resolved: if its `name` is in the enclosing binder stack, it becomes a
// bvar with the matching bindRef; otherwise it becomes an fvar. This mirrors
// how KaTeX / textbook binder-scoping works.

/** 量词宏（原 Type.forall / FOL.exists，v1 后带点缀后缀如 Type.forall.binder） */
function isLegacyQuantifierName(name: string): boolean {
  return (
    name === 'Type.forall' ||
    name === 'FOL.exists' ||
    name.startsWith('Type.forall.') ||
    name.startsWith('FOL.exists.')
  )
}

/**
 * Collect every kind='binder' node in a subtree — including binders buried
 * deep inside non-binder ancestors. This is intentionally aggressive: a
 * `@T` at `def-hyp(hyp-list(Type.judge(@T, Type), …), …)` must be visible
 * as a binder to `def-hyp`'s later siblings, even though the path from
 * `@T` back up to `def-hyp` goes through non-binder nodes (Type.judge,
 * hyp-list). 猫猫 spec (2026-07-04-late): "其他地方的这些字母... 向最近
 * 的子树寻找同 id 的 binder 从而变成 bvar" — the scope of a binder is any
 * position that comes LATER in DFS order, unbounded by its immediate
 * container.
 */
function collectBinderNames(node: SnlSyntaxTree): string[] {
  const acc: string[] = []
  if (node.kind === 'binder') acc.push(node.name)
  for (const child of node.children) {
    acc.push(...collectBinderNames(child))
  }
  return acc
}

/**
 * Annotate a tree in place with bvar / fvar / binder / bindRef metadata.
 *
 * @param root — the tree to annotate.
 * @param initialStack — binder names already in scope OUTSIDE this fragment.
 *   Empty for a full top-level parse; populated when re-parsing a subtree of
 *   a larger tree (see SnlSyntaxTreeParseOptions.activeBinderIds).
 */
export function annotateBindings(
  root: SnlSyntaxTree,
  initialStack: string[] = [],
): void {
  let id = 0
  const nextRef = () => `b${++id}`

  // The stack frame keeps both name and ref so a bvar can point to a
  // specific bindRef. Initial-stack entries have no bindRef (they were
  // stamped in an earlier parse invocation), so their frames use a sentinel
  // ref of '' — bvar-scope-index treats that as "external", ignoring it.
  interface Frame {
    name: string
    ref: string
  }
  const initFrames: Frame[] = initialStack.map((name) => ({ name, ref: '' }))

  function walk(node: SnlSyntaxTree, stack: Frame[]): void {
    // --- (a) Legacy Type.forall / FOL.exists quantifier ---
    // Preserve the existing behavior: first child is the introduction site;
    // subsequent siblings see it in scope.
    if (isLegacyQuantifierName(node.name)) {
      const ref = nextRef()
      const base = node.mdata && typeof node.mdata === 'object' ? node.mdata : {}
      node.mdata = { ...base, bindRef: ref }
      node.scope = 'binder'
      if (!node.kind) {
        node.kind = 'rule'
      }
      const ch = node.children
      if (ch.length >= 1) {
        const v = ch[0]
        const vb = v.mdata && typeof v.mdata === 'object' ? v.mdata : {}
        v.mdata = { ...vb, bindRef: ref }
        v.kind = 'binder'
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

    // --- (b) Non-quantifier: walk children left-to-right. Each child
    // that ends up as a binder (either @-marked by the parser or explicit
    // kind='binder' from some other source) contributes its subtree's
    // binder names to the scope of its LATER siblings. ---
    let localStack = stack
    for (const child of node.children) {
      walk(child, localStack)
      const contributed = collectBinderNames(child)
      if (contributed.length > 0) {
        // Extend for subsequent siblings only. Every contributed name gets
        // a fresh bindRef stamp (the child's `@` didn't allocate one).
        for (const name of contributed) {
          localStack = [...localStack, { name, ref: nextRef() }]
        }
      }
    }

    // --- Leaf resolution ---
    // A node with no children and no explicit kind gets bvar/fvar decided
    // from the enclosing binder stack.
    //
    // Delimited-name leaves (envMode set) go through the same lookup: the
    // parser deliberately didn't stamp their kind so the resolution runs
    // here where the enclosing stack is authoritative.
    //
    // A pre-existing kind='bvar' is honored — the caller pre-decided this
    // is bound, we just need to attach the matching bindRef when we find
    // one in scope.
    if (node.children.length === 0) {
      if (node.kind === 'bvar') {
        const frame = [...stack].reverse().find((f) => f.name === node.name)
        const base = node.mdata && typeof node.mdata === 'object' ? node.mdata : {}
        if (frame && frame.ref) {
          node.mdata = { ...base, bindRef: frame.ref }
        } else {
          node.mdata = Object.keys(base).length ? base : null
        }
        return
      }
      if (node.kind !== 'binder' && (!node.kind || node.envMode)) {
        // Undecided leaf: consult the stack.
        //
        // 猫猫 spec (2026-07-04-late): for delimited names, "整段代码都当
        // 名字" — the whole delim payload is the lookup key. Complex payloads
        // typically won't match, hence usually fvar. Simple single-token
        // payloads (`$f$`) match cleanly when `f` was introduced as a binder.
        const frame = [...stack].reverse().find((f) => f.name === node.name)
        const base = node.mdata && typeof node.mdata === 'object' ? node.mdata : {}
        if (frame) {
          node.kind = 'bvar'
          if (frame.ref) {
            node.mdata = { ...base, bindRef: frame.ref }
          } else {
            // In-scope binder from initialStack (no ref) — mark bvar but
            // leave mdata alone; the outer parse owns the bindRef.
            node.mdata = Object.keys(base).length ? base : null
          }
        } else {
          // NOT bound. Leave kind unset (empty string) so the view's
          // wrapHtmlData chain sees the macro's DB-declared kind (e.g.
          // Type → 'rule') instead of getting shadowed by 'fvar'. If
          // there's no db entry at all, wrapHtmlData's final fallback is
          // still 'fvar', so unbound identifiers without db entries keep
          // rendering as free variables.
          //
          // The one exception is envMode leaves — those bypass the db
          // (synthetic macros), so if the payload isn't bound we DO want
          // to stamp fvar explicitly (there's no db entry to look up).
          if (node.envMode) {
            node.kind = 'fvar'
          }
          node.mdata = Object.keys(base).length ? base : null
        }
      }
    }
  }

  walk(root, initFrames)
}
