import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const entryTypes = join(root, 'dist-lib/entry-types')

function makeDeclarationsNodeNextCompatible(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      makeDeclarationsNodeNextCompatible(path)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.d.ts')) continue
    const declaration = readFileSync(path, 'utf8')
    const nodeNextCompatible = declaration.replace(
      /(from\s+['"]|import\(['"])(\.[^'"]+?)(['"]\)?)/g,
      (match, prefix, specifier, suffix) => {
        if (/\.(?:[cm]?js|json)$/.test(specifier)) return match
        const resolved = join(dirname(path), specifier)
        const normalized = resolved.replaceAll('\\', '/')
        if (
          normalized.includes('/dist-lib/entry-types/runtime') ||
          normalized.endsWith('/dist-lib/entry-types/snl-macro/macro-data-driver')
        ) {
          const rootDeclaration = relative(dirname(path), join(root, 'dist-lib/index.js'))
            .replaceAll('\\', '/')
          const publicSpecifier = rootDeclaration.startsWith('.')
            ? rootDeclaration
            : `./${rootDeclaration}`
          return `${prefix}${publicSpecifier}${suffix}`
        }
        const target = existsSync(resolved) && statSync(resolved).isDirectory()
          ? `${specifier}/index.js`
          : `${specifier}.js`
        return `${prefix}${target}${suffix}`
      },
    )
    writeFileSync(path, nodeNextCompatible)
  }
}

makeDeclarationsNodeNextCompatible(entryTypes)

mkdirSync(join(root, 'dist-lib'), { recursive: true })
copyFileSync(join(root, 'src/snl-react-view/style.css'), join(root, 'dist-lib/style.css'))
copyFileSync(join(root, 'src/entry-react/style.css'), join(root, 'dist-lib/entry.css'))
writeFileSync(join(root, 'dist-lib/style-css.d.ts'), 'declare const css: string\nexport default css\n')
writeFileSync(join(root, 'dist-lib/entry.d.ts'), "export * from './entry-types/entry-react/index.js'\n")
writeFileSync(join(root, 'dist-lib/core.d.ts'), `export {
  MacroDataDriver,
  SnlDslFormatter,
  SnlSyntaxTreeParseError,
  analyzeSnlTreeSources,
  annotateBindings,
  createEmptySnlSyntaxTreeNode,
  createSnlSyntaxTreeNode,
  fillLatexTemplate,
  isEmptySnlSyntaxTreeNode,
  isSnlIdentifier,
  isSnlSyntaxTree,
  isMacroDocumentV10,
  migrateMacroDocument,
  migrateSyntaxTreeDocument,
  isSyntaxTreeDocumentV3,
  parseSnlSyntaxTree,
  serializeSnlSyntaxTree,
  tryParseSnlSyntaxTree,
} from './index.js'
export type {
  MacroDataDriverOptions,
  MacroQueryArgs,
  SnlMacro,
  SnlMacroRecord,
  SnlMacroSource,
  SnlMacroSourceLookup,
  SnlMacroStyle,
  SnlSourceMetrics,
  SnlSyntaxTree,
} from './index.js'
export {
  applyContextSource,
  extractExportedBinders,
} from './entry-types/entry-react/context-source.js'
`)
writeFileSync(join(root, 'dist-lib/runtime.d.ts'), `export {
  ReaderRuntime,
  flat_map_reader,
  is_i18n,
  map_reader,
  pure_reader,
  read_localized,
  write_localized,
} from './index.js'
export type {
  I18n,
  LanguageEnvironment,
  Localized,
  ReaderM,
  ReaderRuntimeOptions,
  ReaderRuntimeQueries,
} from './index.js'
`)
writeFileSync(join(root, 'dist-lib/hover.d.ts'), `export {
  applySnlHoverHighlight,
  buildBvarScopeIndex,
  clearSnlHoverHighlight,
  defaultHighlightStrategy,
  findBinderScopeAncestor,
  findMinimalHoverRoot,
  readBindRefFromDom,
  readSrcFromDom,
  SNL_BASE_TEXT_COLOR_VAR,
  SNL_HOVER_CLASS,
} from './index.js'
export type {
  ApplySnlHoverHighlightOptions,
  BvarScopeEntry,
  SnlHighlightSet,
  SnlHighlightStrategy,
} from './index.js'
`)
rmSync(join(root, 'dist-lib/snl-macro-db.json'), { force: true })
rmSync(join(root, 'dist-lib/snl-macro-db-samples.json'), { force: true })
