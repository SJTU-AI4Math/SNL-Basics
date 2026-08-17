import {
  applySnlHoverHighlight,
  findBinderScopeAncestor,
  findMinimalHoverRoot,
  type ApplySnlHoverHighlightOptions,
} from '../dist-lib/hover.js';
import { ReaderRuntime } from '../dist-lib/runtime.js';
import {
  paletteToCss,
  type HoverPopoverBoundsPolicy,
  type HoverPopoverOrigin,
  type HoverPopoverOriginInput,
  type KindPalette,
  type SnlMacro,
  type SnlSyntaxTreeViewProps,
} from '../dist-lib/index.js';
import {
  HoverPopoverDismissController,
  SnlDeactivationController,
  type EntryKind,
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
const coreTemplate: SnlMacroTemplate = { mode: 'text', body: '#0' };
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
