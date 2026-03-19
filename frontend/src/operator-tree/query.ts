import type { OperatorTree } from './types'

export interface KaTeXTemplateQueryArgs {
  name: string
  style: string
  node: OperatorTree
}

export type KaTeXTemplateQuery = (args: KaTeXTemplateQueryArgs) => Promise<string>
