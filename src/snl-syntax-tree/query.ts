import type { SnlSyntaxTree } from './types'

/** Arguments passed to a {@link SnlMacroTemplateQuery}. */
export interface SnlMacroTemplateQueryArgs {
  /** Macro name being resolved. */
  name: string
  /** The node requesting a template (for kind/binding-aware fallbacks). */
  node: SnlSyntaxTree
}

/** Resolves a macro name + node to its KaTeX template string (may be async). */
export type SnlMacroTemplateQuery = (args: SnlMacroTemplateQueryArgs) => Promise<string>
