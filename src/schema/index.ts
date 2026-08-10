export { MACRO_SCHEMA_VERSION, TREE_SCHEMA_VERSION, PACKAGE_VERSION } from './versions'
export {
  migrateMacroDocument,
  migrateMacroV6toV7,
  migrateMacroV7toV8,
  migrateMacroV7toV9,
  migrateMacroV9toV10,
  migrateMacroV10toV11,
  migrateMacroV8toV11,
  migrateStyleV6toV7,
  isMacroDocumentV7,
  isMacroDocumentV8,
  isMacroDocumentV9,
  isMacroDocumentV10,
  isMacroDocumentV11,
} from './migrate-macro'
export type {
  MacroV6,
  MacroStyleV6,
  MacroV7,
  MacroV8,
  MacroV9,
  MacroV10,
  MacroV11,
  MacroV8Style,
  MacroStyleV7Base,
  MacroV7ToV8Options,
  MacroV7ToV9Options,
} from './migrate-macro'
export {
  migrateSyntaxTreeDocument,
  migrateTreeNodeV1toV2,
  migrateTreeNodeV2toV3,
  isSyntaxTreeDocumentV2,
  isSyntaxTreeDocumentV3,
} from './migrate-tree'
export type { SyntaxTreeNodeV1, SyntaxTreeNodeV2, SyntaxTreeNodeV3 } from './migrate-tree'
