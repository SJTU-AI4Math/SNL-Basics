/**
 * @fulcrum-smarterm/operator-katex — 算子树 → KaTeX（htmlData 交互）
 *
 * 样式：import '@fulcrum-smarterm/operator-katex/style.css'
 * KaTeX：import 'katex/dist/katex.min.css'
 */

export type { OperatorTree } from '../snl-syntax-tree/types'
export { createOperatorNode, isOperatorTree } from '../snl-syntax-tree/types'

export type { TemplateDb, OperatorRecord, TemplateRecord } from '../snl-syntax-tree/template-db'

export type { KaTeXTemplateQuery, KaTeXTemplateQueryArgs } from '../snl-syntax-tree/query'

export { annotateBindings } from '../snl-syntax-tree/annotate-bind'

export {
  clearTemplateDbCache,
  createDefaultTemplateQuery,
  createTemplateQueryFromDb,
  DEFAULT_TEMPLATE_DB_URL,
  loadTemplateDb,
  setTemplateDbCache,
  type DefaultTemplateQueryOptions,
} from './default-query'

export { fillLatexTemplate } from '../snl-syntax-tree/template'
export { getEffectiveStyle } from '../snl-syntax-tree/effective-style'

export { OperatorTreeKaTeXView } from '../components/SnlSyntaxTreeView'

export { serializeOperatorTree } from './serialize'

export { tryParseOperatorTree, parseOperatorTree, parseStyleMeta, OperatorTreeParseError } from './parse'

export { OperatorTreeEditor } from '../components/SnlSyntaxTreeEditor/SnlSyntaxTreeEditor'
