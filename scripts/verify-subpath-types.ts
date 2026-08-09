import {
  applySnlHoverHighlight,
  findBinderScopeAncestor,
  findMinimalHoverRoot,
  type ApplySnlHoverHighlightOptions,
} from '../dist-lib/hover.js';
import { ReaderRuntime } from '../dist-lib/runtime.js';
import { paletteToCss, type KindPalette, type SnlMacro } from '../dist-lib/index.js';
import type { EntryKind } from '../dist-lib/entry.js';

const options: ApplySnlHoverHighlightOptions = {};
const legacyMacro: SnlMacro = {
  name: 'Compat.rule',
  description: '0.1.x declaration compatibility',
  source: { entries: [], urls: [] },
  kind: 'rule',
  dynamic_arity: false,
  default_style: { en: 'default' },
  styles: [{ style_name: 'default', mode: 'formula_inline', template: '#0', tags: [] }],
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
void [
  applySnlHoverHighlight,
  findBinderScopeAncestor,
  findMinimalHoverRoot,
  options,
  legacyMacro,
  legacyEntryKind,
  malformedHybridEntryKind,
  incompleteThemeEntryKind,
  paletteToCss(legacyPalette),
  new ReaderRuntime({ queries: { query_environment: () => ({ language: 'en' }) } }),
];
