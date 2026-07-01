/**
 * @snl-basics/react — SNL 语法树 → KaTeX（htmlData 交互）
 *
 * 样式：import '@snl-basics/react/style.css'
 * KaTeX：import 'katex/dist/katex.min.css'
 */

export type { SnlSyntaxTree } from '../snl-syntax-tree/types'
export { createSnlSyntaxTreeNode, isSnlSyntaxTree } from '../snl-syntax-tree/types'

// v1 前瞻类型（mode 判别联合）——尚未由 parser 产出，供消费者/后续阶段使用
export type {
  SnlSyntaxTreeBase,
  SnlSyntaxTreeMathNode,
  SnlSyntaxTreeTextNode,
  SnlSyntaxTreeBlockNode,
} from '../snl-syntax-tree/node-types'

export type { SnlMacro, SnlMacroDb } from '../snl-macro/types'

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

export { SnlSyntaxTreeView } from '../components/SnlSyntaxTreeView'

export { defaultRenderHooks } from './hooks'
export type {
  SnlRenderHooks,
  SnlHoverEvent,
  SnlMacroInfo,
  SnlResolvedSource,
  SnlTooltipState,
} from './hooks'

export { serializeSnlSyntaxTree } from './serialize'

export { tryParseSnlSyntaxTree, parseSnlSyntaxTree, SnlSyntaxTreeParseError } from './parse'

export { SnlSyntaxTreeEditor } from '../components/SnlSyntaxTreeEditor/SnlSyntaxTreeEditor'

// 输出后端（typst / latex / markdown / text）——Phase 2.5+ 前为占位实现
export {
  toTypst,
  buildTypstPreamble,
  toLatex,
  buildLatexPreamble,
  toMarkdown,
  toText,
} from '../snl-output'
export type { TypstOutputOptions, LatexOutputOptions } from '../snl-output'
