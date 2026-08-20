import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { closeOwnedVite, startOwnedVite } from './verifier-infrastructure.mjs'

const servers = new Set()
afterEach(async () => {
  await Promise.all([...servers].map(server => new Promise(resolve => server.close(resolve))))
  servers.clear()
})

describe('owned verifier Vite server', () => {
  it('uses an ephemeral owned port even when the historical fixed port is impersonated', async () => {
    const impostor = createServer((_request, response) => response.end('impostor'))
    servers.add(impostor)
    await new Promise((resolve, reject) => impostor.once('error', reject).listen(43190, '127.0.0.1', resolve))

    const owned = await startOwnedVite(new URL('../test-fixtures/parameterized-svg/', import.meta.url).pathname)
    expect(owned.port).not.toBe(43190)
    expect(owned.port).not.toBe(5173)
    expect(await (await fetch(owned.url)).text()).not.toBe('impostor')
    await closeOwnedVite(owned)
    await expect(fetch(owned.url)).rejects.toThrow()
  })

  it('narrowly allows the real KaTeX font directory and serves a real font', async () => {
    const fixture = new URL('../test-fixtures/parameterized-svg/', import.meta.url).pathname
    const owned = await startOwnedVite(fixture)
    const expected = realpathSync(new URL('../node_modules/katex/dist/fonts/', import.meta.url).pathname)
    expect(owned.katexFontDir).toBe(expected)
    expect(owned.server.config.server.fs.allow).toContain(expected)
    expect(owned.server.config.server.fs.allow).not.toContain('/')
    const fontUrl = new URL(`/@fs/${join(expected, 'KaTeX_Main-Regular.woff2')}`, owned.url)
    const response = await fetch(fontUrl)
    expect(response.status).toBe(200)
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(10_000)
    await closeOwnedVite(owned)
  })

  it('turns every Vite warning or error into a lifecycle failure', async () => {
    const owned = await startOwnedVite(new URL('../test-fixtures/parameterized-svg/', import.meta.url).pathname)
    owned.server.config.logger.warn('synthetic unexpected Vite warning')
    await expect(owned.failure).rejects.toThrow(/synthetic unexpected Vite warning/)
    expect(owned.viteMessages).toEqual([{ level: 'warn', message: 'synthetic unexpected Vite warning' }])
    await closeOwnedVite(owned)
  })

  it('keeps server listen and close awaited in the browser verifier', () => {
    const source = readFileSync(new URL('./verify-parameterized-svg.mjs', import.meta.url), 'utf8')
    expect(source).toContain('await startOwnedVite(')
    expect(source).toContain('await closeOwnedVite(vite)')
    expect(source).not.toContain('43190')
    expect(source).not.toContain('viteLog')
    expect(source).toContain("await cdp.send('Network.enable')")
    expect(source).toContain("cdp.on('Network.loadingFailed'")
    expect(source).toContain("document.fonts.check('16px KaTeX_Main')")
    expect(source).toContain("document.fonts.check('italic 16px KaTeX_Math')")
    expect(source).toContain('fontRequests')
    expect(source).toContain('vite.viteMessages')
  })
})
