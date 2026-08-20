import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expectedVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const scratch = mkdtempSync(join(tmpdir(), 'snl-basics-packed-entry-i18n-'));
try {
  execFileSync('npm', ['run', 'build:lib'], { cwd: root, stdio: 'inherit' });
  const artifacts = join(scratch, 'artifacts');
  const consumer = join(scratch, 'consumer');
  mkdirSync(artifacts);
  mkdirSync(consumer);
  const packed = JSON.parse(execFileSync('npm', [
    'pack', '--json', '--pack-destination', artifacts
  ], { cwd: root, encoding: 'utf8' }));
  const tarball = join(artifacts, packed[0].filename);

  writeFileSync(join(consumer, 'package.json'), JSON.stringify({
    private: true, type: 'module'
  }, null, 2));
  execFileSync('npm', [
    'install', '--ignore-scripts', '--no-audit', '--no-fund',
    tarball, 'react@19', 'react-dom@19', '@types/react@19', '@types/react-dom@19', 'katex@0.16', 'typescript@5.9'
  ], { cwd: consumer, stdio: 'inherit' });
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022',
      strict: true, skipLibCheck: false, outDir: 'dist'
    },
    include: ['fixture.mts']
  }, null, 2));
  writeFileSync(join(consumer, 'fixture.mts'), `
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReaderRuntime } from '@sjtu-ai4math/snl-basics/runtime';
import {
  MarkdownBody,
  resolve_entry_kind,
  type EntryKind,
} from '@sjtu-ai4math/snl-basics/entry';

const localized: EntryKind = {
  id: 'theorem',
  name: {
    type: 'i18n', default_language: 'en',
    values: { en: 'Theorem', 'zh-CN': '定理' },
  },
  description: {
    type: 'i18n', default_language: 'en',
    values: { en: 'A proved result.', 'zh-CN': '已经证明的结果。' },
  },
};
const runtime = new ReaderRuntime({
  queries: { query_environment: () => ({ language: 'zh-CN' }) },
});
const resolved = resolve_entry_kind(localized, runtime);
if (resolved.name !== '定理' || resolved.description !== '已经证明的结果。') {
  throw new Error('packed localized Entry Kind projection failed');
}
const legacy: EntryKind = { id: 'definition', name: 'Definition' };
if (resolve_entry_kind(legacy).name !== 'Definition') {
  throw new Error('packed legacy Entry Kind compatibility failed');
}
const markdown = renderToStaticMarkup(createElement(MarkdownBody, {
  source: '~~~lean4\\ntheorem packed : True := by trivial\\n~~~\\n\\n~~~typescript\\nconst packed = 42\\n~~~',
  color_scheme: 'dark',
}));
if (!markdown.includes('data-color-scheme="dark"') ||
    !markdown.includes('language-lean4') ||
    !markdown.includes('hljs-keyword') ||
    !markdown.includes('language-typescript')) {
  throw new Error('packed Markdown syntax highlighting failed');
}
console.log('packed Entry Kind I18n, Markdown highlighting, and legacy scalar compatibility pass');
`);
  execFileSync(join(consumer, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.json'], {
    cwd: consumer, stdio: 'inherit'
  });
  execFileSync(process.execPath, [join(consumer, 'dist', 'fixture.mjs')], {
    cwd: consumer, stdio: 'inherit'
  });
  const packageJson = JSON.parse(readFileSync(join(consumer, 'node_modules', '@sjtu-ai4math', 'snl-basics', 'package.json'), 'utf8'));
  if (packageJson.version !== expectedVersion) throw new Error(`expected packed ${expectedVersion}, got ${packageJson.version}`);
  console.log(JSON.stringify({ tarball, integrity: packed[0].integrity, version: packageJson.version }));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
