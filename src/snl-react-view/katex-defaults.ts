import type { TrustContext } from 'katex'

/**
 * KaTeX option defaults required for SNL hover and placeholder styling.
 *
 * SNL emits `\htmlData` wrappers for hover metadata and `\htmlClass` for
 * placeholder styling. Keep those two extensions enabled while rejecting URL,
 * image, id, and inline-style commands from workspace-authored templates.
 *
 * Consumers who call `katex.renderToString` themselves (e.g. custom block
 * renderers) can spread this preset to get the same behavior:
 *
 * ```typescript
 * import { HTMLDATA_KATEX_DEFAULTS } from '@sjtu-ai4math/snl-basics'
 * katex.renderToString(latex, { throwOnError: false, ...HTMLDATA_KATEX_DEFAULTS })
 * ```
 */
export const HTMLDATA_KATEX_DEFAULTS = {
  trust: (context: TrustContext) =>
    context.command === '\\htmlData' || context.command === '\\htmlClass',
  strict: false, // disables the "HTML extension is disabled" warning
} as const
