import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('built-in demo shell', () => {
  it('mounts React into the element exposed by index.html', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    const main = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8')
    const rootId = html.match(/<div id="([^"]+)"\s*><\/div>/)?.[1]
    expect(rootId).toBeTruthy()
    expect(main).toContain(`document.getElementById('${rootId}')`)
  })
})
