import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('lean subpath declaration boundaries', () => {
  it('does not type DOM-only runtime subpaths as the full React barrel', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      exports: Record<string, { types?: string }>;
      typesVersions: Record<string, Record<string, string[]>>;
      scripts: Record<string, string>;
    };
    expect(pkg.exports['./hover']?.types).toBe('./dist-lib/hover.d.ts');
    expect(pkg.exports['./runtime']?.types).toBe('./dist-lib/runtime.d.ts');
    expect(pkg.typesVersions['*'].hover).toEqual(['dist-lib/hover.d.ts']);
    expect(pkg.typesVersions['*'].runtime).toEqual(['dist-lib/runtime.d.ts']);
    expect(pkg.scripts['build:lib']).toContain('scripts/copy-lib-assets.mjs');
  });

  it('keeps the generated core declaration aligned with host-safe schema exports', () => {
    const generator = readFileSync(new URL('../../scripts/copy-lib-assets.mjs', import.meta.url), 'utf8');
    expect(generator).toContain('migrateMacroDocument,');
    expect(generator).toContain("writeFileSync(join(root, 'dist-lib/core.d.ts')");
  });
});
