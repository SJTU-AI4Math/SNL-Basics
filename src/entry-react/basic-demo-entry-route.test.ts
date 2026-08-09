import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('basic demo Entry integration route', () => {
  it('renders and previews through the public Entry path rather than the bare syntax-tree view', () => {
    const app = readFileSync(new URL('../../examples/basic-demo/src/App.tsx', import.meta.url), 'utf8')
    const main = readFileSync(new URL('../../examples/basic-demo/src/main.tsx', import.meta.url), 'utf8')
    expect(app).toContain('EntryPreviewProvider')
    expect(app).toContain('EntrySurface')
    expect(app).toContain('EntryDataDriver')
    expect(app).not.toContain('SnlSyntaxTreeView')
    expect(main).toContain('@sjtu-ai4math/snl-basics/entry/style.css')
  })
})
