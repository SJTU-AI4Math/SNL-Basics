import type { SnlBlockMacroTemplate, SnlSvgTemplateRenderOptions } from './types'

/** Historical intrinsic width for ordinary SVG block/popover canvases. */
export const DEFAULT_SNL_SVG_BLOCK_WIDTH_PX = 680
/** Prevent untrusted projections from creating impractically large layout surfaces. */
export const MAX_SNL_SVG_BLOCK_WIDTH_PX = 4096

/**
 * Read the renderer-owned intrinsic width for an ordinary SVG block canvas.
 * Formula-embedded geometry is intentionally read from `formula_embed` instead.
 */
export function readSnlSvgBlockWidthPx(template: SnlBlockMacroTemplate): number {
  const raw = template.svg_template
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('SVG renderer requires a complete consumer-owned svg_template projection')
  }
  const value = (raw as SnlSvgTemplateRenderOptions).block_width_px
  if (value === undefined) return DEFAULT_SNL_SVG_BLOCK_WIDTH_PX
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_SNL_SVG_BLOCK_WIDTH_PX) {
    throw new TypeError(`SVG template block_width_px must be a finite number greater than zero and at most ${MAX_SNL_SVG_BLOCK_WIDTH_PX}`)
  }
  return value
}
