import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const demoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = resolve(demoRoot, '../..')
const useShell = process.platform === 'win32'

function run(args) {
  const result = spawnSync('npm', args, {
    cwd: packageRoot,
    stdio: 'inherit',
    shell: useShell,
  })
  if (result.error) {
    console.error(`[basic-demo] failed to start npm ${args.join(' ')}: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (!existsSync(join(packageRoot, 'node_modules', 'vite', 'package.json'))) {
  console.log('[basic-demo] installing SNL-Basics build dependencies...')
  run(['install', '--ignore-scripts'])
}

console.log('[basic-demo] building the local SNL-Basics package...')
run(['run', 'build:lib'])
