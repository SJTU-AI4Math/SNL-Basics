import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, extname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'

/** Production-only fixture server: no dev transforms, HMR or source fallback. */
export async function startProductionFixture(root) {
  const outDir = mkdtempSync(join(tmpdir(), `snl-prod-${basename(root)}-`))
  await build({
    configFile: false, root, plugins: [react()],
    build: {
      outDir, emptyOutDir: true, assetsInlineLimit: 0, chunkSizeWarningLimit: 2000,
      rollupOptions: { output: { assetFileNames: 'assets/[name][extname]' } },
    },
  })
  const hashes = {}
  function inventory(dir) {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name)
      if (statSync(file).isDirectory()) inventory(file)
      else hashes[file.slice(outDir.length + 1)] = createHash('sha256').update(readFileSync(file)).digest('hex')
    }
  }
  inventory(outDir)
  writeFileSync(join(outDir, 'build-manifest.json'), JSON.stringify(hashes, null, 2))
  console.log(JSON.stringify({ productionFixture: root, outDir, hashes }))
  let rejectFailure
  const failure = new Promise((_resolve, reject) => { rejectFailure = reject })
  failure.catch(() => {})
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' }
  const server = createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      const file = resolve(outDir, `.${pathname === '/' ? '/index.html' : pathname}`)
      if (!file.startsWith(outDir + sep)) throw new Error('outside fixture')
      const bytes = readFileSync(file)
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }).end(bytes)
    } catch {
      res.writeHead(404).end('Not found')
    }
  })
  const owned = { closing: false, failure, viteMessages: [], outDir }
  server.on('error', rejectFailure)
  server.once('close', () => { if (!owned.closing) rejectFailure(new Error('production fixture closed unexpectedly')) })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  owned.port = server.address().port
  owned.url = `http://127.0.0.1:${owned.port}/`
  owned.server = { close: () => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  }) }
  return owned
}
