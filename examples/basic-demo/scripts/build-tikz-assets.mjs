import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const demoRoot = resolve(scriptDir, '..')
const tikzRoot = join(demoRoot, 'tikz')
const sourcePath = join(tikzRoot, 'higher-category.tex')
const outputDir = join(tikzRoot, 'generated')
const scratch = mkdtempSync(join(tmpdir(), 'snl-tikz-demo-'))
const useShell = process.platform === 'win32'

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit', shell: useShell })
}

function extractTemplate(full) {
  const anchors = new Map()
  for (const match of full.matchAll(/<g data-snl-anchor='(\d+)' data-snl-bbox='([^']+)'\/>/g)) {
    const values = match[2].trim().split(/\s+/).map(Number)
    if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
      throw new Error(`invalid TikZ formula bbox for slot ${match[1]}: ${match[2]}`)
    }
    anchors.set(Number(match[1]), values)
  }
  const indices = [...anchors.keys()].sort((left, right) => left - right)
  if (indices.some((index, position) => index !== position)) {
    throw new Error(`TikZ formula anchors must be contiguous from zero: ${indices.join(', ')}`)
  }

  const formulaIndices = [...full.matchAll(/<g data-snl-formula='(\d+)'>/g)].map((match) => Number(match[1]))
  if (formulaIndices.length !== indices.length || formulaIndices.some((index, position) => index !== indices[position])) {
    throw new Error(`TikZ formula groups do not match anchors: ${formulaIndices.join(', ')}`)
  }

  const viewBox = full.match(/\bviewBox='([^']+)'/)?.[1]
  const page = full.match(/<g id='page1'>([\s\S]*)<\/g>\s*<\/svg>/)?.[1]
  if (!viewBox || page === undefined) throw new Error('dvisvgm output is missing its viewBox or page group')
  const viewBoxValues = viewBox.trim().split(/\s+/).map(Number)
  if (viewBoxValues.length !== 4 || viewBoxValues.some((value) => !Number.isFinite(value))) {
    throw new Error(`invalid dvisvgm viewBox: ${viewBox}`)
  }
  const padding = 36
  const templateViewBox = [
    viewBoxValues[0] - padding,
    viewBoxValues[1] - padding,
    viewBoxValues[2] + 2 * padding,
    viewBoxValues[3] + 2 * padding,
  ].join(' ')

  let artwork = page
  for (const index of indices) {
    const formula = new RegExp(`<g data-snl-formula='${index}'>\\s*<g transform='[^']*'>[\\s\\S]*?<\\/g>\\s*<\\/g>`, 'g')
    const before = artwork
    artwork = artwork.replace(formula, '')
    if (artwork === before) throw new Error(`failed to extract rendered TikZ formula group ${index}`)
  }
  artwork = artwork.replace(/<g data-snl-anchor='\d+' data-snl-bbox='[^']+'\/>/g, '')
  artwork = artwork.replace(/\s+stroke-miterlimit='[^']*'/g, '')
  if (/<(?:use|text)\b|data-snl-(?:formula|anchor)/.test(artwork)) {
    throw new Error('formula extraction left rendered glyphs or private markers in SVG artwork')
  }

  const slots = indices.map((index) => {
    const [x, y, width, height] = anchors.get(index)
    const centerX = Number((x + width / 2).toFixed(6))
    const centerY = Number((y + height / 2).toFixed(6))
    return `<g data-snl-slot="${index}" transform="translate(${centerX} ${centerY})"/>`
  }).join('\n')

  artwork = artwork.trim().replaceAll("'", '"')
  return [
    '<!-- Generated from tikz/higher-category.tex by scripts/build-tikz-assets.mjs. -->',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${templateViewBox}">`,
    '<g>',
    artwork,
    slots,
    '</g>',
    '</svg>',
    '',
  ].join('\n')
}

try {
  mkdirSync(outputDir, { recursive: true })
  copyFileSync(sourcePath, join(scratch, basename(sourcePath)))
  run('latex', ['-interaction=nonstopmode', '-halt-on-error', basename(sourcePath)], scratch)
  run('dvisvgm', ['--no-fonts', '--exact', '--bbox=min', '-o', 'higher-category.full.svg', 'higher-category.dvi'], scratch)

  const full = readFileSync(join(scratch, 'higher-category.full.svg'), 'utf8')
  const template = extractTemplate(full)
  writeFileSync(join(outputDir, 'higher-category.full.svg'), full)
  writeFileSync(join(outputDir, 'higher-category.template.svg'), template)
  console.log(JSON.stringify({
    source: sourcePath,
    full: join(outputDir, 'higher-category.full.svg'),
    template: join(outputDir, 'higher-category.template.svg'),
    slots: [...template.matchAll(/data-snl-slot="(\d+)"/g)].length,
  }))
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
