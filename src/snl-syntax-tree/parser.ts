import { annotateBindings } from './annotate-bind'
import { createSnlSyntaxTreeNode, type SnlSyntaxTree } from './types'

type TokenType =
  | 'IDENT'
  | 'NUMBER'
  | 'EQ'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
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
      // 支持 Lean 风格命名 + 点缀后缀（原 style），如 DivRing.div.inlineDiv。
      // 不允许连字符：KaTeX 的 \htmlData 会把 '-' 当作二元减号，破坏属性值。
      while (i < input.length && /[A-Za-z0-9_.]/.test(input[i])) {
        i += 1
      }
      tokens.push({ type: 'IDENT', value: input.slice(start, i), position: start })
      continue
    }

    if (ch === '[' || ch === ']') {
      throw new SnlSyntaxTreeParseError(
        `'[' is no longer allowed (style syntax removed in v1). Use dotted suffix: "foo.bar(x)" instead of "foo[bar](x)".`,
        i,
      )
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

  private parseNode(): SnlSyntaxTree {
    // 语法入口：IDENT（含点缀后缀）后可跟 (children)。方括号 [style] 语法已废弃。
    const ident = this.expect('IDENT')
    const node = createSnlSyntaxTreeNode(ident.value)

    if (this.peek().type === 'LPAREN') {
      this.consume('LPAREN')
      node.children = this.parseNodeList()
      this.expect('RPAREN')
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

/**
 * Parse SNL source (`name(child1,child2(…))`) into a {@link SnlSyntaxTree}.
 * @throws {SnlSyntaxTreeParseError} on malformed input.
 */
export function parseSnlSyntaxTree(input: string): SnlSyntaxTree {
  const tokens = tokenize(input)
  const parser = new Parser(tokens)
  const tree = parser.parse()
  annotateBindings(tree)
  return tree
}
