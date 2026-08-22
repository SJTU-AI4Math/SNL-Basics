import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const scratch = mkdtempSync(join(tmpdir(), 'snl-basics-packed-consumer-'))

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

try {
  const artifacts = join(scratch, 'artifacts')
  const consumer = join(scratch, 'consumer')
  mkdirSync(artifacts)
  mkdirSync(consumer)

  // The packed bytes must come from this candidate source, never a stale dist-lib.
  rmSync(join(root, 'dist-lib'), { recursive: true, force: true })
  execFileSync('npm', ['run', 'build:lib'], { cwd: root, stdio: 'inherit' })
  const packed = JSON.parse(execFileSync('npm', [
    'pack', '--json', '--ignore-scripts', '--pack-destination', artifacts,
  ], { cwd: root, encoding: 'utf8' }))
  const tarball = join(artifacts, packed[0].filename)

  writeFileSync(join(consumer, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
    scripts: { build: 'vite build', typecheck: 'tsc --noEmit' },
  }, null, 2))
  run('npm', [
    'install', '--ignore-scripts', '--no-audit', '--no-fund',
    tarball,
    'react@19', 'react-dom@19', 'katex@0.16',
    'typescript@5.9', 'vite@8', '@types/react@19', '@types/react-dom@19',
  ], consumer)

  const installed = join(consumer, 'node_modules', '@sjtu-ai4math', 'snl-basics')
  const installedManifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
  if (installedManifest.version !== manifest.version) {
    throw new Error(`expected packed ${manifest.version}, got ${installedManifest.version}`)
  }
  if (existsSync(join(installed, 'src'))) throw new Error('packed package must not contain src/')

  const rootCss = readFileSync(join(installed, 'dist-lib', 'style.css'), 'utf8')
  const entryCss = readFileSync(join(installed, 'dist-lib', 'entry.css'), 'utf8')
  for (const selector of ['.snl-foreign-box', '.snl-svg-template']) {
    if (!rootCss.includes(selector)) throw new Error(`packed root CSS is missing ${selector}`)
  }
  if (!rootCss.includes('.snlFormulaForeignMarker') && !rootCss.includes('.snl-formula-foreign-surface')) {
    throw new Error('packed root CSS is missing the formula foreign marker/surface contract')
  }
  if (!entryCss.includes('.snl-markdown-body')) throw new Error('packed Entry CSS is missing .snl-markdown-body')
  if (!rootCss.includes("@import './fonts/noto-serif-sc-400.css'")) throw new Error('packed root CSS is missing the bundled CJK font import')
  if (!entryCss.includes("@import './style.css'")) throw new Error('packed Entry CSS does not compose the public root stylesheet')
  const packedFontDirectory = join(installed, 'dist-lib', 'fonts')
  const packedCjkFonts = readdirSync(packedFontDirectory).filter(name => name.endsWith('.woff2'))
  if (packedCjkFonts.length !== 101) throw new Error(`expected 101 packed CJK WOFF2 subsets, got ${packedCjkFonts.length}`)
  const packedFontCss = readFileSync(join(packedFontDirectory, 'noto-serif-sc-400.css'), 'utf8')
  if (!packedFontCss.includes('SNL Noto Serif SC')) throw new Error('packed CJK CSS has the wrong family')
  if (!readFileSync(join(packedFontDirectory, 'OFL.txt'), 'utf8').includes('SIL OPEN FONT LICENSE Version 1.1')) {
    throw new Error('packed CJK font license is missing')
  }

  const fixture = `
import { createElement } from 'react';
import {
  FORMULA_FOREIGN_RENDERER_CAPABILITY,
  SvgTemplateAssetRegistry,
  createFormulaBlockRenderer,
  createSvgTemplateRenderer,
  formulaForeignCapability,
  readSvgTemplateProjection,
  type SnlBlockMacroTemplate,
  type SnlBlockRenderer,
  type SnlSyntaxTree,
  type SvgTemplateProjection,
  type SvgTemplateRendererOptions,
} from '@sjtu-ai4math/snl-basics';
import {
  EntrySurface,
  type EntryContent,
  type EntryData,
  type EntryKind,
  type EntrySurfaceProps,
} from '@sjtu-ai4math/snl-basics/entry';
import { ReaderRuntime, type LanguageEnvironment } from '@sjtu-ai4math/snl-basics/runtime';
import '@sjtu-ai4math/snl-basics/style.css';
import '@sjtu-ai4math/snl-basics/entry/style.css';

const svgSource = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><g data-snl-slot="0"/></svg>';
const registry = new SvgTemplateAssetRegistry({
  loader: async () => svgSource,
  maxSettled: 2,
});
const svgOptions: SvgTemplateRendererOptions = { assetRegistry: registry };
const svgRenderer = createSvgTemplateRenderer(svgOptions);
const template: SnlBlockMacroTemplate = {
  mode: 'block',
  body: '#0',
  block_template_name: 'consumer-svg',
  svg_template: {
    asset: {
      source: 'diagram.svg', base_identity: 'packed-consumer',
      revision: 'sha256:fixture', request_epoch: 1,
    },
    generation: 1,
    producer_revision: 'packed-v1',
    accessibility: { label: 'Parameterized diagram' },
    formula_embed: { total_height_em: 2, baseline_ratio: 0.75 },
  },
};
const projection: SvgTemplateProjection = readSvgTemplateProjection(template);
const asset = registry.acquire(projection.asset, projection.asset.requestEpoch);
void asset.promise.then(result => {
  if (result.value !== svgSource) throw new Error('public SVG registry returned wrong source');
  asset.release();
});

const baseRenderer: SnlBlockRenderer = props => createElement('div', null, props.node.macro_name);
const formulaRenderer = createFormulaBlockRenderer(baseRenderer, {
  prepare: async candidate => ({
    seed: { widthEm: 3, totalHeightEm: 2, baselineRatio: 0.75 },
    producer: 'packed-generic-v1',
    generation: candidate.node.children.length,
    accessibilityText: 'Generic formula block',
    layout: { width: 'intrinsic', overflow: 'visible' },
  }),
});
if (!formulaForeignCapability(formulaRenderer)) throw new Error('generic formula capability is missing');
if (!(FORMULA_FOREIGN_RENDERER_CAPABILITY in svgRenderer)) throw new Error('SVG formula capability is missing');

const entryContent: EntryContent = { text: 'Packed Entry body' };
const entry: EntryData = { id: 'packed-entry', kind: 'definition', title: 'Packed Entry', content: entryContent };
const entryKind: EntryKind = { id: 'definition', name: 'Definition' };
const surface: typeof EntrySurface = EntrySurface;
const surfaceProps: Pick<EntrySurfaceProps, 'entry' | 'kind'> = { entry, kind: entryKind };
const runtime = new ReaderRuntime<LanguageEnvironment<string>>({
  queries: { query_environment: () => ({ language: 'en' }) },
});
const tree: SnlSyntaxTree = { macro_name: 'consumer-svg', kind: 'const', mdata: {}, children: [] };
void [surface, surfaceProps, runtime, tree, formulaRenderer, svgRenderer, projection];
`
  if (/\.\.\/src\//.test(fixture) || /from\s+['"]\.\.?\//.test(fixture)) {
    throw new Error('packed consumer fixture may not use src/ or repository-relative imports')
  }

  mkdirSync(join(consumer, 'src'))
  writeFileSync(join(consumer, 'src', 'main.ts'), fixture)
  writeFileSync(join(consumer, 'index.html'), '<div id="app"></div><script type="module" src="/src/main.ts"></script>\n')
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      module: 'ESNext', moduleResolution: 'Bundler', target: 'ES2022',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'], strict: true,
      skipLibCheck: false, noEmit: true,
    },
    include: ['src'],
  }, null, 2))

  run(join(consumer, 'node_modules', '.bin', 'tsc'), ['--noEmit'], consumer)
  run(join(consumer, 'node_modules', '.bin', 'vite'), ['build'], consumer)
  const builtAssets = readdirSync(join(consumer, 'dist', 'assets'))
  const builtCss = builtAssets.filter(name => name.endsWith('.css')).map(name => readFileSync(join(consumer, 'dist', 'assets', name), 'utf8')).join('\n')
  if (!builtCss.includes('SNL Noto Serif SC')) throw new Error('consumer build dropped the CJK font faces')
  if (!builtAssets.some(name => name.includes('noto-serif-sc') && name.endsWith('.woff2'))) {
    throw new Error('consumer build did not emit bundled CJK WOFF2 assets')
  }

  const smoke = `
import {
  SvgTemplateAssetRegistry,
  createFormulaBlockRenderer,
  createSvgTemplateRenderer,
  formulaForeignCapability,
  readSvgTemplateProjection,
} from '@sjtu-ai4math/snl-basics';
import { EntrySurface } from '@sjtu-ai4math/snl-basics/entry';
import { ReaderRuntime } from '@sjtu-ai4math/snl-basics/runtime';
const registry = new SvgTemplateAssetRegistry({ loader: async () => '<svg/>', maxSettled: 1 });
const template = {
  mode: 'block', body: '#0', block_template_name: 'consumer-svg',
  svg_template: {
    asset: { source: 'diagram.svg', base_identity: 'packed-consumer', revision: 'r1', request_epoch: 1 },
    generation: 1, producer_revision: 'packed-v1', accessibility: { label: 'Diagram' },
  },
};
const projection = readSvgTemplateProjection(template);
const handle = registry.acquire(projection.asset, projection.asset.requestEpoch);
if ((await handle.promise).value !== '<svg/>') throw new Error('SVG registry smoke failed');
handle.release();
if (typeof createSvgTemplateRenderer({ assetRegistry: registry }) !== 'function') throw new Error('SVG renderer smoke failed');
const generic = createFormulaBlockRenderer(() => null, { prepare: async () => ({
  seed: { widthEm: 2, totalHeightEm: 1, baselineRatio: 0.75 }, producer: 'packed-generic', generation: 1,
  accessibilityText: 'Generic formula', layout: { width: 'intrinsic', overflow: 'visible' },
}) });
const capability = formulaForeignCapability(generic);
if (!capability) throw new Error('formula renderer smoke failed');
const resolved = await capability.prepare({
  node: { macro_name: 'consumer', kind: 'const', mdata: {}, children: [] }, template, treePath: [0], dynamicArity: false,
});
if (resolved.rendererKey !== 'consumer-svg') throw new Error('formula capability resolution failed');
const runtime = new ReaderRuntime({ queries: { query_environment: () => ({ language: 'en' }) } });
if (runtime.query_environment().language !== 'en' || typeof EntrySurface !== 'function') throw new Error('Entry/runtime smoke failed');
console.log('packed public SVG, formula, Entry, and runtime smoke pass');
`;
  if (/\.\.\/src\//.test(smoke) || /from\s+['"]\.\.?\//.test(smoke)) {
    throw new Error('packed runtime smoke may not use src/ or repository-relative imports')
  }
  writeFileSync(join(consumer, 'smoke.mjs'), smoke)
  run(process.execPath, ['smoke.mjs'], consumer)

  console.log(JSON.stringify({
    tarball,
    integrity: packed[0].integrity,
    version: installedManifest.version,
    packedFiles: packed[0].files.length,
    strictTypecheck: true,
    productionBuild: true,
  }))
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
