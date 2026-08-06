import {
  applySnlHoverHighlight,
  findBinderScopeAncestor,
  findMinimalHoverRoot,
  type ApplySnlHoverHighlightOptions,
} from '../dist-lib/hover.js';
import { ReaderRuntime } from '../dist-lib/runtime.js';

const options: ApplySnlHoverHighlightOptions = {};
void [
  applySnlHoverHighlight,
  findBinderScopeAncestor,
  findMinimalHoverRoot,
  options,
  new ReaderRuntime({ queries: { query_environment: () => ({ language: 'en' }) } }),
];
