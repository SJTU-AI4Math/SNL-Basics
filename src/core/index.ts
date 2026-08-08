// Non-React core: parser, formatter, serializer, source metrics, macro types.
//
// Everything reachable from here is plain data manipulation — no React, no
// KaTeX. Panels that only need to parse SNL or compute metrics import this
// instead of the package barrel, whose React views drag the whole math engine
// into the bundle. Cat 2026-07-25: "各个 Panel 开起来都非常慢".
//
// Keep this file free of any import that reaches ../components or
// ../entry-react; `bundle-leanness.test.ts` enforces it.

export {
  createEmptySnlSyntaxTreeNode,
  createSnlSyntaxTreeNode,
  isEmptySnlSyntaxTreeNode,
  isSnlSyntaxTree,
  type SnlPostfix,
  type SnlResolvedSource,
  type SnlSyntaxTree,
} from '../snl-syntax-tree/types'

export {
  SnlSyntaxTreeParseError,
  parseSnlSyntaxTree,
} from '../snl-syntax-tree/parser'
export { isSnlIdentifier } from '../snl-syntax-tree/identifier'

export { serializeSnlSyntaxTree } from '../snl-react-view/serialize'
export { tryParseSnlSyntaxTree } from '../snl-react-view/parse'
export { SnlDslFormatter } from '../snl-syntax-tree/formatter'
export { annotateBindings } from '../snl-syntax-tree/annotate-bind'
export {
  resolveSnlSemantics,
  type SnlDiagnostic,
  type SnlSemanticResolution,
} from '../snl-syntax-tree/semantic-resolver'
export { fillLatexTemplate } from '../snl-syntax-tree/template'

export {
  analyzeSnlTreeSources,
  type SnlMacroSourceLookup,
  type SnlSourceMetrics,
} from '../snl-syntax-tree/source-metrics'

export {
  MacroDataDriver,
  type MacroDataDriverOptions,
  type MacroQueryArgs,
} from '../snl-macro/macro-data-driver'
export type {
  SnlMacro,
  SnlMacroRecord,
  SnlMacroSource,
  SnlMacroStyle,
} from '../snl-macro/types'

export {
  migrateMacroDocument,
  isMacroDocumentV10,
} from '../schema/migrate-macro'

export {
  applyContextSource,
  extractExportedBinders,
} from '../entry-react/context-source'
