export { MACRO_SCHEMA_VERSION, TREE_SCHEMA_VERSION, PACKAGE_VERSION } from './versions'
export {
  migrateMacroDocument,
  migrateMacroV6toV7,
  migrateStyleV6toV7,
  isMacroDocumentV7,
} from './migrate-macro'
export type { MacroV6, MacroStyleV6 } from './migrate-macro'
export {
  migrateSyntaxTreeDocument,
  migrateTreeNodeV1toV2,
  isSyntaxTreeDocumentV2,
} from './migrate-tree'
export type { SyntaxTreeNodeV1 } from './migrate-tree'
