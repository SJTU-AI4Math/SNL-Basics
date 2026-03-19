import { createOperatorNode, type OperatorTree } from './types'

type TokenType = 'IDENT' | 'LBRACK' | 'RBRACK' | 'LPAREN' | 'RPAREN' | 'COMMA' | 'EOF'

interface Token {
  type: TokenType
  value: string
  position: number
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
      node.style = this.parseStyleText()
      this.expect('RBRACK')
    }

    if (this.peek().type === 'LPAREN') {
      this.consume('LPAREN')
      node.children = this.parseNodeList()
      this.expect('RPAREN')
    }

    return node
  }

  private parseStyleText(): string {
    // 保留 style 原文（去掉外层 []），暂不做更细粒度语义解析。
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
  return parser.parse()
}
