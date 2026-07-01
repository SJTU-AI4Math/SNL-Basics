import type { SnlSyntaxTree } from './types'

export interface SnlMacroTemplateQueryArgs {
  name: string
  style: string
  node: SnlSyntaxTree
}

export type SnlMacroTemplateQuery = (args: SnlMacroTemplateQueryArgs) => Promise<string>
