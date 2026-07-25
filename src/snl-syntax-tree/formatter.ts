import { parseSnlSyntaxTree } from './parser'
import type { SnlSyntaxTree } from './types'

const MAX_INDENT_SPACES = 256

/**
 * Join formatted arguments with commas, inserting `gap` only between two
 * NON-empty arguments. An unfilled slot formats to the empty string, so
 * `f(a,,b)` must not become `f(a, , b)` — the padding would read as though
 * something were there. Cat 2026-07-25.
 */
function joinArgumentList(formattedArguments: readonly string[], gap: string): string {
  return formattedArguments.reduce((accumulator, current, index) => {
    if (index === 0) return current
    const previous = formattedArguments[index - 1]
    const separator = previous !== '' && current !== '' ? `,${gap}` : ','
    return `${accumulator}${separator}${current}`
  }, '')
}

/** Pretty-printer for the SNL DSL. */
export class SnlDslFormatter {
  /** Number of spaces added for each expanded parenthesis level. */
  public readonly indentSpaces: number
  /** Maximum parenthesis depth of a subtree that remains on one line. */
  public readonly inlineParenthesisDepth: number

  /**
   * @param indentSpaces Number of spaces per indentation level (0–256). Defaults to 4.
   * @param inlineParenthesisDepth Maximum subtree parenthesis depth kept inline. Defaults to 3.
   */
  public constructor(indentSpaces = 4, inlineParenthesisDepth = 3) {
    this.assertIntegerInRange(indentSpaces, 'indentSpaces', MAX_INDENT_SPACES)
    this.assertIntegerInRange(
      inlineParenthesisDepth,
      'inlineParenthesisDepth',
      Number.MAX_SAFE_INTEGER,
    )
    this.indentSpaces = indentSpaces
    this.inlineParenthesisDepth = inlineParenthesisDepth
  }

  /** Parse and format an SNL DSL expression. */
  public format(source: string): string {
    return this.formatNode(parseSnlSyntaxTree(source), 0)
  }

  private formatNode(node: SnlSyntaxTree, indentationLevel: number): string {
    const name = this.formatNodeHead(node)
    if (node.children.length === 0) {
      return name
    }

    if (this.parenthesisDepth(node) <= this.inlineParenthesisDepth) {
      const children = node.children.map((child) => this.formatNode(child, 0))
      // An empty slot formats to the empty string, so `f(a,,b)` round trips.
      // Joining with ', ' would emit `f(a, , b)`; that reparses identically
      // but reads worse, so empty slots keep a tight comma.
      return `${name}(${joinArgumentList(children, ' ')})`
    }

    const indentation = ' '.repeat(this.indentSpaces * (indentationLevel + 1))
    const children = node.children.map((child) =>
      `${indentation}${this.formatNode(child, indentationLevel + 1)}`,
    )
    return `${name}(\n${children.join(',\n')}\n${' '.repeat(this.indentSpaces * indentationLevel)})`
  }

  private formatNodeHead(node: SnlSyntaxTree): string {
    const binderPrefix = node.binder_explicit ? '@' : ''
    let name: string
    switch (node.env_mode) {
      case 'text':
        name = `%${node.macro_name}%`
        break
      case 'formula_inline':
        name = `$${node.macro_name}$`
        break
      case 'formula_display':
        name = `$$${node.macro_name}$$`
        break
      default:
        name = node.macro_name
    }

    const src = this.sourceReference(node)
    const sourceSuffix = src === undefined ? '' : `@${src}`
    const styleSuffix = node.style_name === undefined ? '' : `[${node.style_name}]`
    return `${binderPrefix}${name}${sourceSuffix}${styleSuffix}`
  }

  private sourceReference(node: SnlSyntaxTree): string | undefined {
    if (!node.mdata || typeof node.mdata !== 'object') {
      return undefined
    }
    const src = (node.mdata as { src?: unknown }).src
    return typeof src === 'string' ? src : undefined
  }

  private assertIntegerInRange(value: number, parameterName: string, maximum: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
      throw new RangeError(
        `${parameterName} must be a non-negative integer no greater than ${maximum}`,
      )
    }
  }

  private parenthesisDepth(node: SnlSyntaxTree): number {
    let maximumChildDepth = -1
    for (const child of node.children) {
      maximumChildDepth = Math.max(maximumChildDepth, this.parenthesisDepth(child))
    }
    return maximumChildDepth + 1
  }
}
