import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
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

  it('keeps server listen and close awaited in the browser verifier', () => {
    const source = readFileSync(new URL('./verify-parameterized-svg.mjs', import.meta.url), 'utf8')
    expect(source).toContain('await startOwnedVite(')
    expect(source).toContain('await closeOwnedVite(vite)')
    expect(source).not.toContain('43190')
  })
})
