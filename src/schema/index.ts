export { MACRO_SCHEMA_VERSION, TREE_SCHEMA_VERSION, PACKAGE_VERSION } from './versions'
export {
  migrateMacroDocument,
  migrateMacroV6toV7,
  migrateMacroV7toV8,
  migrateMacroV7toV9,
  migrateStyleV6toV7,
  isMacroDocumentV7,
  isMacroDocumentV8,
  isMacroDocumentV9,
} from './migrate-macro'
export type {
  MacroV6,
  MacroStyleV6,
  MacroV7,
  MacroV8,
  MacroV8Style,
  MacroStyleV7Base,
  MacroV7ToV8Options,
  MacroV7ToV9Options,
} from './migrate-macro'
export {
  migrateSyntaxTreeDocument,
  migrateTreeNodeV1toV2,
  isSyntaxTreeDocumentV2,
} from './migrate-tree'
export type { SyntaxTreeNodeV1 } from './migrate-tree'
