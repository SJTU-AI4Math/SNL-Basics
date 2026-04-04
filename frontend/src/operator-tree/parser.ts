import { annotateBindings } from './annotate-bind'
import { createOperatorNode, type OperatorTree } from './types'

type TokenType =
  | 'IDENT'
  | 'NUMBER'
  | 'EQ'
  | 'LBRACK'
  | 'RBRACK'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'EOF'

interface Token {
  type: TokenType
  value: string
  position: number
}

/** 解析方括号内文本（如 binder）；bvar 由 annotateBindings 按父语境推断，一般不必手写 */
export function parseStyleMeta(raw: string): {
  style: string
  kind: string
  mdata: Record<string, unknown> | null
} {
  const segments = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (segments.length === 0) {
    return { style: '', kind: '', mdata: null }
  }

  const first = segments[0]
  let style: string
  let kvStart: number
  if (first.includes('=')) {
    style = ''
    kvStart = 0
  } else {
    style = first
    kvStart = 1
  }

  const mdata: Record<string, unknown> = {}
  let explicitKind = ''
  for (let i = kvStart; i < segments.length; i += 1) {
    const seg = segments[i]
    const eq = seg.indexOf('=')
    if (eq === -1) {
      continue
    }
    const k = seg.slice(0, eq).trim()
    const v = seg.slice(eq + 1).trim()
    if (k === 'kind') {
      explicitKind = v
    }
  }

  let kind = explicitKind
  if (!kind && style === 'binder') {
    kind = 'binder'
  }
  if (!kind && style === 'bvar') {
    kind = 'bvar'
  }

  const cleaned = Object.keys(mdata).length > 0 ? mdata : null
  return { style, kind, mdata: cleaned }
}

export class OperatorTreeParseError extends Error {
  public readonly position: number

  constructor(message: string, position: number) {
    super(`${message} at position ${position}`)
    this.name = 'OperatorTreeParseError'
    this.position = position
  }
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

    if (/[A-Za-z_]/.test(ch)) {
      const start = i
      i += 1
      // 支持 Lean 风格命名，例如 DivRing.div
      while (i < input.length && /[A-Za-z0-9_.]/.test(input[i])) {
        i += 1
      }
      tokens.push({ type: 'IDENT', value: input.slice(start, i), position: start })
      continue
    }

    if (ch === '[') {
      tokens.push({ type: 'LBRACK', value: ch, position: i })
      i += 1
      continue
    }
    if (ch === ']') {
      tokens.push({ type: 'RBRACK', value: ch, position: i })
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

    throw new OperatorTreeParseError(`Unexpected character "${ch}"`, i)
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

  parse(): OperatorTree {
    const tree = this.parseNode()
    this.expect('EOF')
    return tree
  }

  private parseNode(): OperatorTree {
    // 语法入口：IDENT 后可跟 [style] 与 (children)。
    const ident = this.expect('IDENT')
    const node = createOperatorNode(ident.value)

    if (this.peek().type === 'LBRACK') {
      this.consume('LBRACK')
      const rawStyle = this.parseStyleText()
      this.expect('RBRACK')
      const meta = parseStyleMeta(rawStyle)
      node.style = meta.style
      node.kind = meta.kind
      node.mdata = meta.mdata
    }

    if (this.peek().type === 'LPAREN') {
      this.consume('LPAREN')
      node.children = this.parseNodeList()
      this.expect('RPAREN')
    }

    return node
  }

  private parseStyleText(): string {
    // 方括号内如 binder、bvar 或留空，拼接为原始串再交给 parseStyleMeta。
    const parts: string[] = []
    while (this.peek().type !== 'RBRACK') {
      const token = this.peek()
      if (token.type === 'EOF') {
        throw new OperatorTreeParseError('Unterminated style bracket', token.position)
      }
      if (token.type === 'LBRACK') {
        throw new OperatorTreeParseError('Nested "[" is not allowed in style', token.position)
      }
      this.cursor += 1
      parts.push(token.value)
    }
    return parts.join('').trim()
  }

  private parseNodeList(): OperatorTree[] {
    if (this.peek().type === 'RPAREN') {
      return []
    }

    const children: OperatorTree[] = [this.parseNode()]
    while (this.peek().type === 'COMMA') {
      this.consume('COMMA')
      if (this.peek().type === 'RPAREN') {
        throw new OperatorTreeParseError('Trailing comma is not allowed', this.peek().position)
      }
      children.push(this.parseNode())
    }
    return children
  }

  private expect(type: TokenType): Token {
    const token = this.peek()
    if (token.type !== type) {
      throw new OperatorTreeParseError(`Expected ${type} but got ${token.type}`, token.position)
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

export function parseOperatorTree(input: string): OperatorTree {
  const tokens = tokenize(input)
  const parser = new Parser(tokens)
  const tree = parser.parse()
  annotateBindings(tree)
  return tree
}
