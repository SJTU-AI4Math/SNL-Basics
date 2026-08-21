import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const demoRoot = resolve(scriptDir, '..')
const tikzRoot = join(demoRoot, 'tikz')
const sourcePath = join(tikzRoot, 'higher-category.tex')
const outputDir = join(tikzRoot, 'generated')
const useShell = process.platform === 'win32'
export const EXPECTED_FORMULA_IDS = Object.freeze(Array.from({ length: 9 }, (_, index) => index))

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit', shell: useShell })
}

function requireExactFormulaIds(actual, label) {
  if (actual.length !== EXPECTED_FORMULA_IDS.length || actual.some((id, index) => id !== EXPECTED_FORMULA_IDS[index])) {
    throw new Error(`${label} must be exactly ${EXPECTED_FORMULA_IDS.join(', ')}; received ${actual.join(', ')}`)
  }
}

const EXACT_WHITE = /^(?:#fff(?:fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))$/i
const EXACT_BLACK = /^(?:#000(?:000)?|black|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))$/i

function attribute(tag, name) {
  return tag.match(new RegExp(`\\s${name}=(['"])(.*?)\\1`, 'i'))?.[2]
}

function setAttribute(tag, name, value) {
  const pattern = new RegExp(`\\s${name}=(['"])(.*?)\\1`, 'i')
  if (pattern.test(tag)) return tag.replace(pattern, ` ${name}="${value}"`)
  return tag.replace(/\s*\/>$/, ` ${name}="${value}"/>`)
}

function paintOnly(tag, channel, paint) {
  let result = setAttribute(tag, 'fill', channel === 'fill' ? paint : 'none')
  result = setAttribute(result, 'stroke', channel === 'stroke' ? paint : 'none')
  return result
}

/** Preserve source painter order while treating exact white as transparent paper. */
export function postprocessTikzArtwork(source, viewBoxValues) {
  const masks = []
  let composite = ''
  let cursor = 0
  const paintElement = /<(?:path|rect|circle|ellipse|line|polyline|polygon)\b[^>]*\/>/gi
  for (const match of source.matchAll(paintElement)) {
    composite += source.slice(cursor, match.index)
    cursor = match.index + match[0].length
    const tag = match[0]
    const operations = [
      ['fill', attribute(tag, 'fill') ?? '#000'],
      ['stroke', attribute(tag, 'stroke') ?? 'none'],
    ]
    for (const [channel, authoredPaint] of operations) {
      if (authoredPaint.toLowerCase() === 'none') continue
      if (EXACT_WHITE.test(authoredPaint)) {
        const id = `snl-paper-knockout-${masks.length}`
        const [x, y, width, height] = viewBoxValues
        masks.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${width}" height="${height}"><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="white"/>${paintOnly(tag, channel, '#000')}</mask>`)
        composite = `<g mask="url(#${id})">${composite}</g>`
      } else {
        const paint = EXACT_BLACK.test(authoredPaint) ? 'currentColor' : authoredPaint
        composite += paintOnly(tag, channel, paint)
      }
    }
  }
  composite += source.slice(cursor)
  if (/(?:fill|stroke)=(['"])(?:#fff(?:fff)?|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))\1/i.test(composite)) {
    throw new Error('TikZ white-paper postprocessing left exact-white ordinary artwork')
  }
  return { artwork: composite, defs: masks.length ? `<defs>${masks.join('')}</defs>` : '' }
}

function extractTemplateWithPaperMode(full, paperMode) {
  const anchors = new Map()
  const anchorIndices = []
  for (const match of full.matchAll(/<g data-snl-anchor='(\d+)' data-snl-bbox='([^']+)'\/>/g)) {
    const values = match[2].trim().split(/\s+/).map(Number)
    if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
      throw new Error(`invalid TikZ formula bbox for slot ${match[1]}: ${match[2]}`)
    }
    const index = Number(match[1])
    anchorIndices.push(index)
    anchors.set(index, values)
  }
  requireExactFormulaIds(anchorIndices, 'TikZ formula anchors')
  const indices = EXPECTED_FORMULA_IDS

  const formulaIndices = [...full.matchAll(/<g data-snl-formula='(\d+)'>/g)].map((match) => Number(match[1]))
  requireExactFormulaIds(formulaIndices, 'TikZ formula groups')

  const viewBox = full.match(/\bviewBox='([^']+)'/)?.[1]
  const page = full.match(/<g id='page1'>([\s\S]*)<\/g>\s*<\/svg>/)?.[1]
  if (!viewBox || page === undefined) throw new Error('dvisvgm output is missing its viewBox or page group')
  const viewBoxValues = viewBox.trim().split(/\s+/).map(Number)
  if (viewBoxValues.length !== 4 || viewBoxValues.some((value) => !Number.isFinite(value))) {
    throw new Error(`invalid dvisvgm viewBox: ${viewBox}`)
  }
  const padding = 36
  const templateViewBoxValues = [
    viewBoxValues[0] - padding,
    viewBoxValues[1] - padding,
    viewBoxValues[2] + 2 * padding,
    viewBoxValues[3] + 2 * padding,
  ]
  const templateViewBox = templateViewBoxValues.join(' ')

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

  const processed = paperMode === 'knockout'
    ? postprocessTikzArtwork(artwork.trim(), templateViewBoxValues)
    : { artwork: artwork.trim(), defs: '' }
  const normalizedArtwork = processed.artwork.replaceAll("'", '"')
  return [
    '<!-- Generated from tikz/higher-category.tex by scripts/build-tikz-assets.mjs. -->',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${templateViewBox}">`,
    processed.defs,
    '<g>',
    normalizedArtwork,
    slots,
    '</g>',
    '</svg>',
    '',
  ].filter((line) => line !== '').join('\n') + '\n'
}

export function extractTemplate(full) {
  return extractTemplateWithPaperMode(full, 'knockout')
}

/** Test oracle: the extracted template before white-paper/currentColor postprocessing. */
export function extractLiteralWhiteReference(full) {
  return extractTemplateWithPaperMode(full, 'literal-white')
}

export function buildTikzAssets() {
  const scratch = mkdtempSync(join(tmpdir(), 'snl-tikz-demo-'))
  const stagedFull = join(outputDir, '.higher-category.full.svg.next')
  const stagedTemplate = join(outputDir, '.higher-category.template.svg.next')
  try {
    mkdirSync(outputDir, { recursive: true })
    copyFileSync(sourcePath, join(scratch, basename(sourcePath)))
    run('latex', ['-interaction=nonstopmode', '-halt-on-error', basename(sourcePath)], scratch)
    run('dvisvgm', ['--no-fonts', '--exact', '--bbox=min', '-o', 'higher-category.full.svg', 'higher-category.dvi'], scratch)

    const full = readFileSync(join(scratch, 'higher-category.full.svg'), 'utf8')
    const template = extractTemplate(full)
    writeFileSync(stagedFull, full)
    writeFileSync(stagedTemplate, template)
    renameSync(stagedFull, join(outputDir, 'higher-category.full.svg'))
    renameSync(stagedTemplate, join(outputDir, 'higher-category.template.svg'))
    console.log(JSON.stringify({
      source: sourcePath,
      full: join(outputDir, 'higher-category.full.svg'),
      template: join(outputDir, 'higher-category.template.svg'),
      slots: [...template.matchAll(/data-snl-slot="(\d+)"/g)].length,
    }))
  } finally {
    rmSync(stagedFull, { force: true })
    rmSync(stagedTemplate, { force: true })
    rmSync(scratch, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) buildTikzAssets()
