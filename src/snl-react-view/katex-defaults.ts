/**
 * KaTeX option defaults required for SNL hover to work.
 *
 * The render templates emit `\htmlData{name=…,kind=…}{…}`, which powers the
 * whole hover/tooltip feature. KaTeX's own defaults (`strict: 'warn'` +
 * `trust: false`) *silently drop* the `\htmlData` extension, leaving no
 * `data-*` attributes in the DOM and thus no hover. `SnlSyntaxTreeView` merges
 * these defaults in before any consumer overrides so hover works out of the box.
 *
 * Consumers who call `katex.renderToString` themselves (e.g. custom block
 * renderers) can spread this preset to get the same behavior:
 *
 * ```typescript
 * import { HTMLDATA_KATEX_DEFAULTS } from '@snl-basics/react'
 * katex.renderToString(latex, { throwOnError: false, ...HTMLDATA_KATEX_DEFAULTS })
 * ```
 */
export const HTMLDATA_KATEX_DEFAULTS = {
  trust: true, // permits \htmlData
  strict: false, // disables the "HTML extension is disabled" warning
} as const
