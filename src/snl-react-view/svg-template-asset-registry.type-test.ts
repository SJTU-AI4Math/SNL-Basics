import type { ParsedSvgTemplate } from './svg-template'
import type { SvgTemplateAssetRegistry } from './svg-template-asset-registry'

// Cached SVG assets are immutable source strings; consumers parse a fresh DOM after retrieval.
// @ts-expect-error Parsed DOM templates must never be admitted to the shared source cache.
export type ParsedSvgTemplateRegistryMustBeRejected = SvgTemplateAssetRegistry<ParsedSvgTemplate>
