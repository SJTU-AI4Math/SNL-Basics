import { annotateBindings } from './annotate-bind'
import { createSnlSyntaxTreeNode, type SnlSyntaxTree } from './types'

// 2026-07-04-late 猫猫 spec 2 — Parser supports `%`, `$`, `$$`, `@` delimited
// name-forms in addition to the plain identifier form.
//
//   %text%   → name = text between %s, envMode = 'text'
//   $expr$   → name = LaTeX between $s, envMode = 'formula_inline'
//   $$expr$$ → name = LaTeX between $$s, envMode = 'formula_display'
//   @<name>  → node kind = 'binder' (recursively — the whole subtree, so all
//              descendants are binders too). Compatible with any of the above:
//              @foo, @$x + y$, @%my binder%. Bare `@` is equivalent to `@$`
//              (parser reads the following identifier or delimited form).
//
// Delimiter contents are FLAT strings. `%foo $x$ bar%` produces one node whose
// name is the literal string `foo $x$ bar` — the `$x$` inside is NOT a nested
// SNL subtree. KaTeX will render the outer as `\text{...}` and it handles
// nested `$…$` on its own. This matches 猫猫 spec: 「一个 delim 之间的内容
// 一定只属于同一个 Macro 节点」.

type TokenType =
  | 'IDENT'
  | 'NUMBER'
  | 'EQ'
  | 'LPAREN'
  | 'RPAREN'
  | 'LBRACKET'
  | 'RBRACKET'
  | 'COMMA'
  | 'AT'
  | 'PERCENT_DELIMITED'      // %…%
  | 'DOLLAR_DELIMITED'       // $…$
  | 'DOLLAR2_DELIMITED'      // $$…$$
  | 'EOF'

interface Token {
  type: TokenType
  value: string
  position: number
}

/** Error thrown by {@link parseSnlSyntaxTree} on malformed input; carries the 0-based `position`. */
export class SnlSyntaxTreeParseError extends Error {
  public readonly position: number

  constructor(message: string, position: number) {
    super(`${message} at position ${position}`)
    this.name = 'SnlSyntaxTreeParseError'
    this.position = position
  }
}

/** Options passed to {@link parseSnlSyntaxTree}. */
export interface SnlSyntaxTreeParseOptions {
  /**
   * Binder names already in scope OUTSIDE this fragment — used by
   * annotate-bind to decide bvar vs fvar for delimited-name leaves whose
   * name matches an enclosing binder. Defaults to empty (context-free).
   *
   * Consumers that parse a subtree in isolation (e.g. an incremental editor
   * re-parsing one node) should pass the enclosing tree's currently-active
   * binder names here so the sub-parse resolves bvar/fvar correctly.
   */
  activeBinderIds?: string[]
}

/**
 * Try to read `%…%`, `$…$`, or `$$…$$` starting at input[i]. Returns the
 * matched token OR null (i unchanged). Advances `i` past the closing
 * delimiter on success.
 *
 * The scanner is dumb about content: it copies characters verbatim until the
 * matching closing delimiter, WITHOUT recursion or escape handling. That's
 * per-spec — delim contents are flat strings.
 *
 * `$$…$$` MUST be attempted before `$…$` so `$$x$$` isn't misread as `$` + `$x$` + `$`.
 */
function tryReadDelimited(
  input: string,
  start: number,
): { token: Token; next: number } | null {
  const rest = input.length - start
  // $$…$$
  if (rest >= 4 && input[start] === '$' && input[start + 1] === '$') {
    const close = input.indexOf('$$', start + 2)
    if (close < 0) {
      throw new SnlSyntaxTreeParseError('Unclosed $$ delimiter', start)
    }
    return {
      token: {
        type: 'DOLLAR2_DELIMITED',
        value: input.slice(start + 2, close),
        position: start,
      },
      next: close + 2,
    }
  }
  // $…$
  if (rest >= 2 && input[start] === '$') {
    const close = input.indexOf('$', start + 1)
    if (close < 0) {
      throw new SnlSyntaxTreeParseError('Unclosed $ delimiter', start)
    }
    return {
      token: {
        type: 'DOLLAR_DELIMITED',
        value: input.slice(start + 1, close),
        position: start,
      },
      next: close + 1,
    }
  }
  // %…%
  if (rest >= 2 && input[start] === '%') {
    const close = input.indexOf('%', start + 1)
    if (close < 0) {
      throw new SnlSyntaxTreeParseError('Unclosed % delimiter', start)
    }
    return {
      token: {
        type: 'PERCENT_DELIMITED',
        value: input.slice(start + 1, close),
        position: start,
      },
      next: close + 1,
    }
  }
  return null
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < input.length) {
    const ch = input[i]

    if (/\s/.test(ch)) {
      i += 1
      continue
    }

    // Delimited name forms — must be tried BEFORE the plain-identifier
    // branch so `%foo%` isn't rejected as "unexpected character %".
    if (ch === '%' || ch === '$') {
      const delim = tryReadDelimited(input, i)
      if (delim) {
        tokens.push(delim.token)
        i = delim.next
        continue
      }
    }

    if (ch === '@') {
      tokens.push({ type: 'AT', value: ch, position: i })
      i += 1
      continue
    }

    if (/[A-Za-z_\\]/.test(ch)) {
      const start = i
      i += 1
      // 支持 Lean 风格命名 + 点缀后缀（原 style），如 DivRing.div.inlineDiv。
      // 允许开头的反斜杠（`\i` / `\operatorname` 等 LaTeX 命令名 as leaf id）。
      // 允许 `-` (hyphen) — 2026-07-04-late 猫猫 spec fix: macro names may
      // contain hyphens. Earlier a defensive check rejected them for fear
      // KaTeX would treat `-` as a math binary-minus inside \htmlData attr
      // values, but empirical verification (see git log) shows KaTeX
      // passes hyphens through verbatim.
      while (i < input.length && /[A-Za-z0-9_.\-]/.test(input[i])) {
        i += 1
      }
      tokens.push({ type: 'IDENT', value: input.slice(start, i), position: start })
      continue
    }

    if (ch === '[') {
      tokens.push({ type: 'LBRACKET', value: ch, position: i })
      i += 1
      continue
    }
    if (ch === ']') {
      tokens.push({ type: 'RBRACKET', value: ch, position: i })
      i += 1
      continue
    }
    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: ch, position: i })
      i += 1
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ch, position: i })
      i += 1
      continue
    }
    if (ch === ',') {
      tokens.push({ type: 'COMMA', value: ch, position: i })
      i += 1
      continue
    }

    if (ch === '=') {
      tokens.push({ type: 'EQ', value: ch, position: i })
      i += 1
      continue
    }

    if (/\d/.test(ch)) {
      const start = i
      while (i < input.length && /\d/.test(input[i])) {
        i += 1
      }
      tokens.push({ type: 'NUMBER', value: input.slice(start, i), position: start })
      continue
    }

    throw new SnlSyntaxTreeParseError(`Unexpected character "${ch}"`, i)
  }

  tokens.push({ type: 'EOF', value: '', position: input.length })
  return tokens
}

class Parser {
  private cursor = 0
  private readonly tokens: Token[]

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  parse(): SnlSyntaxTree {
    const tree = this.parseNode()
    this.expect('EOF')
    return tree
  }

  /**
   * node := '@'? nameForm ('@' IDENT)? ('[' IDENT ']')? ('(' args ')')?
   * nameForm := IDENT | PERCENT_DELIMITED | DOLLAR_DELIMITED | DOLLAR2_DELIMITED
   *
   * When `@` prefix is present, the returned node (and RECURSIVELY every
   * descendant) has kind = 'binder'.
   *
   * When a POSTFIX `@IDENT` is present (cat 2026-07-09 context-entry
   * spec), it attaches `mdata.src` = that identifier — a cross-entry
   * reference pointing at another entry id. `src` is a universal
   * attribute on ref-like nodes; lookup / rendering / lint decide what
   * to do with it based on the node's resolved kind (bvar → context
   * entry decl lookup; anything else → reserved for future use).
   */
  private parseNode(): SnlSyntaxTree {
    const isBinder = this.peek().type === 'AT'
    if (isBinder) {
      this.consume('AT')
      // `@` adds the binder tag WITHOUT changing which name-form path is
      // taken. `@f(x)` is `f(x)` with kind=binder (fallback path), and
      // `@$expr$` is `$expr$` with kind=binder (envMode path). The bare
      // `@` alone is a syntax error — a name-form must follow.
    }

    const nameTok = this.peek()
    let node: SnlSyntaxTree
    if (nameTok.type === 'IDENT') {
      this.consume('IDENT')
      node = createSnlSyntaxTreeNode(nameTok.value)
    } else if (nameTok.type === 'PERCENT_DELIMITED') {
      this.consume('PERCENT_DELIMITED')
      node = createSnlSyntaxTreeNode(nameTok.value)
      node.envMode = 'text'
    } else if (nameTok.type === 'DOLLAR_DELIMITED') {
      this.consume('DOLLAR_DELIMITED')
      node = createSnlSyntaxTreeNode(nameTok.value)
      node.envMode = 'formula_inline'
    } else if (nameTok.type === 'DOLLAR2_DELIMITED') {
      this.consume('DOLLAR2_DELIMITED')
      node = createSnlSyntaxTreeNode(nameTok.value)
      node.envMode = 'formula_display'
    } else {
      throw new SnlSyntaxTreeParseError(
        `Expected macro name (IDENT or %…% / $…$ / $$…$$)` +
          ` but got ${nameTok.type}`,
        nameTok.position,
      )
    }

    // Postfix `@IDENT` = src (cross-entry reference). Distinguishable
    // from a new-node `@ident` in an argument slot because arguments
    // must be COMMA-separated: at this point in the grammar we've just
    // consumed a nameForm and the next node boundary is `,` / `)` /
    // `EOF` / `[` / `(`. An `AT` here can only be a src postfix.
    if (this.peek().type === 'AT') {
      this.consume('AT')
      const srcTok = this.expect('IDENT')
      const baseMdata =
        node.mdata && typeof node.mdata === 'object' ? node.mdata : {}
      node.mdata = { ...(baseMdata as Record<string, unknown>), src: srcTok.value }
    }

    if (this.peek().type === 'LBRACKET') {
      this.consume('LBRACKET')
      const styleTok = this.expect('IDENT')
      node.style = styleTok.value
      this.expect('RBRACKET')
    }

    if (this.peek().type === 'LPAREN') {
      this.consume('LPAREN')
      node.children = this.parseNodeList()
      this.expect('RPAREN')
    }

    if (isBinder) {
      // Recursively mark this node + all descendants as binders.
      markBinderRecursive(node)
    }
    return node
  }

  private parseNodeList(): SnlSyntaxTree[] {
    if (this.peek().type === 'RPAREN') {
      return []
    }

    const children: SnlSyntaxTree[] = [this.parseNode()]
    while (this.peek().type === 'COMMA') {
      this.consume('COMMA')
      if (this.peek().type === 'RPAREN') {
        throw new SnlSyntaxTreeParseError('Trailing comma is not allowed', this.peek().position)
      }
      children.push(this.parseNode())
    }
    return children
  }

  private expect(type: TokenType): Token {
    const token = this.peek()
    if (token.type !== type) {
      throw new SnlSyntaxTreeParseError(`Expected ${type} but got ${token.type}`, token.position)
    }
    this.cursor += 1
    return token
  }

  private consume(type: TokenType): Token {
    return this.expect(type)
  }

  private peek(): Token {
    return this.tokens[this.cursor]
  }
}

/** Mark the node and every descendant with kind='binder'. */
function markBinderRecursive(node: SnlSyntaxTree): void {
  node.kind = 'binder'
  for (const child of node.children) {
    markBinderRecursive(child)
  }
}

/**
 * Parse SNL source into a {@link SnlSyntaxTree} and annotate binder scoping.
 *
 * Grammar (informal):
 *   node   := '@'? nameForm ('[' IDENT ']')? ('(' args ')')?
 *   nameForm := IDENT              — plain identifier (dotted allowed)
 *             | '%' text '%'       — text envMode (payload is literal text)
 *             | '$' latex '$'      — formula_inline envMode (payload is LaTeX)
 *             | '$$' latex '$$'    — formula_display envMode (payload is LaTeX)
 *   args   := node (',' node)*
 *
 * `@` prefix makes the node AND every descendant a binder (kind='binder').
 *
 * @param options.activeBinderIds — pre-existing binder names in scope, used
 *   by annotate-bind for delimited-leaf bvar/fvar resolution when this input
 *   is a fragment of a larger tree.
 *
 * @throws {SnlSyntaxTreeParseError} on malformed input.
 */
export function parseSnlSyntaxTree(
  input: string,
  options: SnlSyntaxTreeParseOptions = {},
): SnlSyntaxTree {
  const tokens = tokenize(input)
  const parser = new Parser(tokens)
  const tree = parser.parse()
  annotateBindings(tree, options.activeBinderIds ?? [])
  return tree
}
