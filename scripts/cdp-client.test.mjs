import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { Cdp } from './cdp-client.mjs'

const servers = new Set()
const sockets = new Set()

function websocketServer(onSocket) {
  const server = createServer()
  servers.add(server)
  server.on('upgrade', (request, socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    const accept = createHash('sha1')
      .update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    onSocket(socket)
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    resolve({ server, url: `ws://127.0.0.1:${port}` })
  }))
}

function closeFrame() { return Buffer.from([0x88, 0x00]) }

afterEach(async () => {
  for (const socket of sockets) socket.destroy()
  sockets.clear()
  await Promise.all([...servers].map(server => new Promise(resolve => server.close(resolve))))
  servers.clear()
})

describe('bounded CDP client', () => {
  it('rejects a pending command when the peer closes before responding', async () => {
    const { url } = await websocketServer(socket => socket.once('data', () => socket.end(closeFrame())))
    const cdp = new Cdp(url, { connectTimeoutMs: 500, commandTimeoutMs: 500, closeTimeoutMs: 100 })
    await cdp.ready()
    await expect(cdp.send('Page.enable')).rejects.toThrow(/closed|disconnect/i)
    await cdp.close()
  })

  it('rejects ready when the transport errors or closes before opening', async () => {
    const probe = createServer()
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
    const { port } = probe.address()
    await new Promise(resolve => probe.close(resolve))
    const cdp = new Cdp(`ws://127.0.0.1:${port}`, { connectTimeoutMs: 500 })
    await expect(cdp.ready()).rejects.toThrow()
    await cdp.close()
  })

  it('times out a command and removes its pending entry', async () => {
    const { url } = await websocketServer(() => {})
    const cdp = new Cdp(url, { connectTimeoutMs: 500, commandTimeoutMs: 30, closeTimeoutMs: 50 })
    await cdp.ready()
    await expect(cdp.send('Runtime.evaluate')).rejects.toThrow(/timed out/i)
    expect(cdp.pending.size).toBe(0)
    await cdp.close()
  })

  it('closes idempotently while rejecting pending work without unhandled rejections', async () => {
    const { url } = await websocketServer(() => {})
    const cdp = new Cdp(url, { connectTimeoutMs: 500, commandTimeoutMs: 1_000, closeTimeoutMs: 50 })
    await cdp.ready()
    const pending = cdp.send('Page.captureScreenshot')
    const observed = expect(pending).rejects.toThrow(/closed/i)
    await Promise.all([cdp.close(), cdp.close()])
    await observed
    await cdp.close()
    expect(cdp.pending.size).toBe(0)
  })
})
