import {
  applySnlHoverHighlight,
  findBinderScopeAncestor,
  findMinimalHoverRoot,
  type ApplySnlHoverHighlightOptions,
} from '../dist-lib/hover.js';
import { ReaderRuntime } from '../dist-lib/runtime.js';
import { createElement } from 'react';
import {
  createFormulaBlockRenderer,
  createSvgTemplateRenderer,
  formulaForeignCapability,
  readSvgTemplateProjection,
  SvgTemplateAssetRegistry,
  paletteToCss,
  ReleasedSvgTemplateAssetError,
  type HoverPopoverBoundsPolicy,
  type HoverPopoverOrigin,
  type HoverPopoverOriginInput,
  type KindPalette,
  type SnlBlockMacroTemplate,
  type SnlBlockRenderer,
  type SnlMacro,
  type SnlSyntaxTreeViewProps,
  type SvgTemplateProjection,
  type SvgTemplateRendererOptions,
} from '../dist-lib/index.js';
import {
  EntrySurface,
  HoverPopoverDismissController,
  SnlDeactivationController,
  type EntryData,
  type EntryKind,
  type EntrySurfaceProps,
  type EntryPreviewProviderProps,
  type HoverPopoverDismissDispatch,
  type HoverPopoverDismissReason,
  type SnlDeactivationDispatch,
  type SnlDeactivationHandler,
} from '../dist-lib/entry.js';
import {
  analyzeLatexTemplatePlaceholders,
  isMacroDocumentV11,
  type SnlMacroTemplate,
} from '../dist-lib/core.js';

const descriptorBounds: HoverPopoverBoundsPolicy = 'viewport';
const descriptorOrigin: HoverPopoverOrigin = { element: document.body, bounds: descriptorBounds };
const compatibleOrigin: HoverPopoverOriginInput = new DOMRect(0, 0, 1, 1);
const options: ApplySnlHoverHighlightOptions = {};
const releasedAssetError: Error = new ReleasedSvgTemplateAssetError();
if (releasedAssetError instanceof ReleasedSvgTemplateAssetError) {
  const discriminatedReleasedAssetError: ReleasedSvgTemplateAssetError = releasedAssetError;
  void discriminatedReleasedAssetError;
}
const coreTemplate: SnlMacroTemplate = { mode: 'text', body: '#0' };
const svgRegistry = new SvgTemplateAssetRegistry({
  loader: async () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>',
  maxSettled: 1,
});
const svgOptions: SvgTemplateRendererOptions = { assetRegistry: svgRegistry };
const svgRenderer = createSvgTemplateRenderer(svgOptions);
const svgTemplate: SnlBlockMacroTemplate = {
  mode: 'block',
  body: '#0',
  block_template_name: 'consumer-svg',
  svg_template: {
    asset: { source: 'diagram.svg', base_identity: 'consumer', revision: 'r1', request_epoch: 1 },
    generation: 1,
    producer_revision: 'consumer-v1',
    accessibility: { label: 'Consumer diagram' },
    formula_embed: { total_height_em: 2, baseline_ratio: 0.75 },
  },
};
const svgProjection: SvgTemplateProjection = readSvgTemplateProjection(svgTemplate);
const baseFormulaRenderer: SnlBlockRenderer = props => createElement('div', null, props.node.macro_name);
const formulaRenderer = createFormulaBlockRenderer(baseFormulaRenderer, {
  prepare: async candidate => ({
    seed: { widthEm: 2, totalHeightEm: 1.5, baselineRatio: 0.7 },
    producer: 'generic-consumer-v1',
    generation: candidate.node.children.length,
    accessibilityText: 'Generic formula child',
    layout: { width: 'intrinsic', overflow: 'visible' },
  }),
});
const formulaCapability = formulaForeignCapability(formulaRenderer);
const svgFormulaCapability = formulaForeignCapability(svgRenderer);
const typedEntry: EntryData = { id: 'entry', kind: 'definition', title: 'Entry', content: { text: 'Body' } };
const typedEntrySurface: typeof EntrySurface = EntrySurface;
const typedEntrySurfaceProps: Pick<EntrySurfaceProps, 'entry' | 'kind'> = { entry: typedEntry, kind: null };
const legacyMacro: SnlMacro = {
  name: 'Compat.rule',
  description: '0.1.x declaration compatibility',
  source: { entries: [], urls: [] },
  kind: 'rule',
  dynamic_arity: false,
  default_style: { en: 'default' },
  styles: [{
    style_name: 'default',
    template: { mode: 'formula_inline', body: '#0' },
    tags: [],
  }],
  tags: [],
};
const legacyPalette: KindPalette = {
  rule: { stroke: '#123456', background: '#abcdef' },
};
const legacyEntryKind: EntryKind = {
  id: 'definition',
  name: 'Definition',
  coloring: { stroke: '#123456' },
};
const localizedEntryKind: EntryKind = {
  id: 'theorem',
  name: {
    type: 'i18n',
    default_language: 'en',
    values: { en: 'Theorem', 'zh-CN': '定理' },
  },
  description: {
    type: 'i18n',
    default_language: 'en',
    values: { en: 'A proved result.', 'zh-CN': '已经证明的结果。' },
  },
};
const malformedHybridEntryKind: EntryKind = {
  id: 'hybrid',
  name: 'Hybrid',
  coloring: {
    stroke: '#123456',
    // @ts-expect-error flat and theme-aware fields are mutually exclusive
    light: { stroke: '#111111', background: '#eeeeee' },
    // @ts-expect-error flat and theme-aware fields are mutually exclusive
    dark: { stroke: '#eeeeee', background: '#111111' },
  },
};
const incompleteThemeEntryKind: EntryKind = {
  id: 'incomplete-theme',
  name: 'Incomplete theme',
  // @ts-expect-error a theme-aware coloring requires both light and dark
  coloring: { light: { stroke: '#111111', background: '#eeeeee' } },
};
const deactivationController = new SnlDeactivationController<{ consumer: string }, PointerEvent>({
  params: { consumer: 'packed-root' },
  handlers: { explicit: ({ runDefault }) => runDefault() },
});
const typedDeactivationDispatch: SnlDeactivationDispatch<{ consumer: string }, PointerEvent> | null = null;
const typedDeactivationHandler: SnlDeactivationHandler<{ consumer: string }, PointerEvent> = ({ runDefault }) => runDefault();
const typedDismissDispatch: HoverPopoverDismissDispatch<{ consumer: string }, string> | null = null;
const typedDismissReason: HoverPopoverDismissReason = 'explicit-api';
const dismissController = new HoverPopoverDismissController<{ consumer: string }, string>({
  params: { consumer: 'packed-entry' },
  on_request: ({ runDefault }) => runDefault(),
});
const viewControllers: Pick<SnlSyntaxTreeViewProps, 'deactivation_controller'> = {
  deactivation_controller: deactivationController,
};
const entryControllers: Pick<EntryPreviewProviderProps, 'deactivation_controller' | 'dismiss_controller'> = {
  deactivation_controller: deactivationController,
  dismiss_controller: dismissController,
};
void [
  applySnlHoverHighlight,
  findBinderScopeAncestor,
  findMinimalHoverRoot,
  options,
  descriptorOrigin,
  compatibleOrigin,
  coreTemplate,
  svgRegistry,
  svgRenderer,
  svgProjection,
  formulaRenderer,
  formulaCapability,
  svgFormulaCapability,
  typedEntrySurface,
  typedEntrySurfaceProps,
  analyzeLatexTemplatePlaceholders('#0'),
  isMacroDocumentV11,
  legacyMacro,
  legacyEntryKind,
  localizedEntryKind,
  malformedHybridEntryKind,
  incompleteThemeEntryKind,
  viewControllers,
  entryControllers,
  typedDeactivationDispatch,
  typedDeactivationHandler,
  typedDismissDispatch,
  typedDismissReason,
  paletteToCss(legacyPalette),
  new ReaderRuntime({ queries: { query_environment: () => ({ language: 'en' }) } }),
];
