const root = await import('../dist-lib/index.js')
const runtime = await import('../dist-lib/runtime.js')
const hover = await import('../dist-lib/hover.js')

for (const [subpath, api] of [['runtime', runtime], ['hover', hover]]) {
  for (const [name, value] of Object.entries(api)) {
    if (!(name in root)) throw new Error(`${subpath}.${name} is absent from the root API`)
    if (root[name] !== value) {
      throw new Error(`${subpath}.${name} does not preserve root runtime identity`)
    }
  }
}

console.log('subpath runtime identities match root exports')
