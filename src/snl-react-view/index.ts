/**
 * @snl-basics/react — SNL 语法树 → KaTeX（htmlData 交互）
 *
 * 样式：import '@snl-basics/react/style.css'
 * KaTeX：import 'katex/dist/katex.min.css'
 */

export type { SnlSyntaxTree } from '../snl-syntax-tree/types'
export { createSnlSyntaxTreeNode, isSnlSyntaxTree } from '../snl-syntax-tree/types'

export type { SnlMacroDb, SnlMacroDbEntry, SnlMacroTemplateRecord } from '../snl-syntax-tree/template-db'

export type { SnlMacroTemplateQuery, SnlMacroTemplateQueryArgs } from '../snl-syntax-tree/query'

export { annotateBindings } from '../snl-syntax-tree/annotate-bind'

export {
  clearSnlMacroDbCache,
  createDefaultMacroTemplateQuery,
  createMacroTemplateQueryFromDb,
  DEFAULT_SNL_MACRO_DB_URL,
  loadSnlMacroDb,
  setSnlMacroDbCache,
  type DefaultMacroTemplateQueryOptions,
} from './default-query'

export { fillLatexTemplate } from '../snl-syntax-tree/template'
export { getEffectiveStyle } from '../snl-syntax-tree/effective-style'

export { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'

export { serializeSnlSyntaxTree } from './serialize'

export { tryParseSnlSyntaxTree, parseSnlSyntaxTree, parseStyleMeta, SnlSyntaxTreeParseError } from './parse'

export { SnlSyntaxTreeEditor } from '../components/SnlSyntaxTreeEditor/SnlSyntaxTreeEditor'
