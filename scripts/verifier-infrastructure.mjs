import { createConnection, createServer as createNetServer } from 'node:net'
import { createServer } from 'vite'

function deferred() {
  let reject
  const promise = new Promise((_resolve, rej) => { reject = rej })
  promise.catch(() => {})
  return { promise, reject }
}

async function reserveEphemeralPort() {
  const reservation = createNetServer()
  await new Promise((resolve, reject) => reservation.once('error', reject).listen(0, '127.0.0.1', resolve))
  const address = reservation.address()
  if (!address || typeof address === 'string') throw new Error('failed to reserve an ephemeral loopback port')
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))
  return address.port
}

export async function startOwnedVite(root) {
  // Vite 8 normalizes port 0 to its default 5173. Reserve an OS-assigned
  // ephemeral port, release it, then claim exactly that port with strictPort.
  // A racing external listener can only make startup fail; it cannot be accepted.
  const port = await reserveEphemeralPort()
  const lifecycle = deferred()
  const owned = {
    server: await createServer({
      root,
      logLevel: 'error',
      server: { host: '127.0.0.1', port, strictPort: true },
    }),
    closing: false,
    failure: lifecycle.promise,
  }
  owned.server.httpServer?.once('close', () => {
    if (!owned.closing) lifecycle.reject(new Error('owned Vite server closed unexpectedly'))
  })
  try {
    await owned.server.listen()
    const address = owned.server.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('Vite did not expose an owned TCP address')
    owned.port = address.port
    owned.url = `http://127.0.0.1:${address.port}/`
    return owned
  } catch (error) {
    owned.closing = true
    await owned.server.close().catch(() => {})
    throw error
  }
}

export async function assertPortClosed(port, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const connected = await new Promise(resolve => {
      const socket = createConnection({ host: '127.0.0.1', port })
      socket.setTimeout(100)
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => resolve(false))
      socket.once('timeout', () => { socket.destroy(); resolve(false) })
    })
    if (!connected) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`owned Vite port ${port} remained open after close`)
}

export async function closeOwnedVite(owned) {
  if (!owned || owned.closed) return
  owned.closing = true
  await owned.server.close()
  await assertPortClosed(owned.port)
  owned.closed = true
}

export function raceVerifierLifecycle(ownedVite, ownedBrowser, promise) {
  return Promise.race([Promise.resolve(promise), ownedVite.failure, ownedBrowser.failure])
}
