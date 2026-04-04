/**
 * @fulcrum-smarterm/operator-katex — 算子树 → KaTeX（htmlData 交互）
 *
 * 样式：import '@fulcrum-smarterm/operator-katex/style.css'
 * KaTeX：import 'katex/dist/katex.min.css'
 */

export type { OperatorTree } from '../operator-tree/types'
export { createOperatorNode, isOperatorTree } from '../operator-tree/types'

export type { TemplateDb, OperatorRecord, TemplateRecord } from '../operator-tree/template-db'

export type { KaTeXTemplateQuery, KaTeXTemplateQueryArgs } from '../operator-tree/query'

export { annotateBindings } from '../operator-tree/annotate-bind'

export {
  clearTemplateDbCache,
  createDefaultTemplateQuery,
  createTemplateQueryFromDb,
  DEFAULT_TEMPLATE_DB_URL,
  loadTemplateDb,
  setTemplateDbCache,
  type DefaultTemplateQueryOptions,
} from './default-query'

export { fillLatexTemplate } from '../operator-tree/template'
export { getEffectiveStyle } from '../operator-tree/effective-style'

export { OperatorTreeKaTeXView } from '../components/OperatorTreeKaTeXView'

export { serializeOperatorTree } from './serialize'

export { tryParseOperatorTree, parseOperatorTree, parseStyleMeta, OperatorTreeParseError } from './parse'

export { OperatorTreeEditor } from '../components/OperatorTreeEditor/OperatorTreeEditor'
