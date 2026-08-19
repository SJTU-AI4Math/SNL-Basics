import { analyzeOrderedSlotIndices } from '../snl-syntax-tree/slot-contract'
import type { SnlSyntaxTree } from '../snl-syntax-tree/types'

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'
const XML_NS = 'http://www.w3.org/XML/1998/namespace'
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/'

const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'use',
  'symbol',
  'clipPath',
  'mask',
  'linearGradient',
  'radialGradient',
  'stop',
  'pattern',
  'title',
  'desc',
])

const BANNED_ELEMENTS = new Set([
  'script',
  'style',
  'foreignObject',
  'animate',
  'animateMotion',
  'animateTransform',
  'set',
  'image',
  'audio',
  'video',
  'iframe',
  'object',
  'embed',
])

const ALLOWED_ATTRIBUTES = new Set([
  'aria-hidden',
  'class',
  'clip-path',
  'clip-rule',
  'color',
  'cx',
  'cy',
  'd',
  'data-snl-slot',
  'display',
  'dominant-baseline',
  'dx',
  'dy',
  'fill',
  'fill-opacity',
  'fill-rule',
  'focusable',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'gradientTransform',
  'gradientUnits',
  'height',
  'href',
  'id',
  'mask',
  'maskContentUnits',
  'maskUnits',
  'offset',
  'opacity',
  'overflow',
  'patternContentUnits',
  'patternTransform',
  'patternUnits',
  'points',
  'preserveAspectRatio',
  'r',
  'rect',
  'role',
  'rx',
  'ry',
  'stop-color',
  'stop-opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'stroke-width',
  'text-anchor',
  'transform',
  'vector-effect',
  'viewBox',
  'visibility',
  'width',
  'x',
  'x1',
  'x2',
  'xml:space',
  'y',
  'y1',
  'y2',
])

const LOCAL_URL_ONLY_ATTRIBUTES = new Set([
  'clip-path',
  'mask',
])

const PAINT_OR_URL_ATTRIBUTES = new Set([
  'fill',
  'stroke',
])

const TEXT_CONTAINERS = new Set(['text', 'tspan', 'title', 'desc'])

export interface SvgTemplateSlot {
  index: number
  element: SVGGElement
}

export interface ParsedSvgTemplate {
  viewBox: string
  root: SVGSVGElement
  slots: SvgTemplateSlot[]
}

export interface ParseSanitizedSvgTemplateOptions {
  dynamic_arity?: false
}

function reject(message: string): never {
  throw new Error(message)
}

function parseSvgDocument(source: string): SVGSVGElement {
  if (!source.trim()) reject('SVG template must not be empty')
  const parser = new DOMParser()
  const doc = parser.parseFromString(source, 'image/svg+xml')
  if (doc.querySelector('parsererror')) reject('SVG template is not well-formed XML')
  const root = doc.documentElement
  if (!(root instanceof SVGSVGElement) || root.localName !== 'svg' || root.namespaceURI !== SVG_NS) {
    reject('SVG template must have an <svg> root')
  }
  return root
}

const CSS_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
const CSS_LENGTH = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:%|px|pt|pc|mm|cm|in|em|ex)?$/
const SAFE_STYLE_PROPERTIES = new Set([
  'clip-path', 'mask', 'fill', 'stroke', 'color', 'opacity', 'fill-opacity',
  'stroke-opacity', 'stop-color', 'stop-opacity', 'stroke-width',
  'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'fill-rule',
  'clip-rule', 'display', 'visibility', 'vector-effect', 'text-anchor',
  'dominant-baseline', 'font-size', 'font-style', 'font-weight',
])

function rejectCssEscape(value: string, context: string): void {
  if (value.includes('\\')) reject(`SVG template ${context} must not contain CSS escapes`)
}

function sanitizePaint(value: string, name: string): string {
  const trimmed = value.trim()
  rejectCssEscape(trimmed, name)
  if (/^url\s*\(/i.test(trimmed)) return sanitizeLocalUrl(trimmed, name)
  if (/^(?:none|currentColor|transparent)$/i.test(trimmed)) return trimmed
  if (/^#[0-9a-f]{3,4}(?:[0-9a-f]{3,4})?$/i.test(trimmed)) return trimmed
  if (/^[a-z][a-z0-9-]*$/i.test(trimmed)) return trimmed
  reject(`SVG template ${name} contains an unsupported paint value`)
}

function sanitizeOpacity(value: string, name: string): string {
  const trimmed = value.trim()
  if (!CSS_NUMBER.test(trimmed)) reject(`SVG template ${name} must be numeric`)
  const number = Number(trimmed)
  if (!Number.isFinite(number) || number < 0 || number > 1) reject(`SVG template ${name} must be between 0 and 1`)
  return trimmed
}

function sanitizeStyleValue(name: string, value: string): string {
  const trimmed = value.trim()
  rejectCssEscape(trimmed, `style property "${name}"`)
  if (PAINT_OR_URL_ATTRIBUTES.has(name) || name === 'color' || name === 'stop-color') {
    return sanitizePaint(trimmed, name)
  }
  if (LOCAL_URL_ONLY_ATTRIBUTES.has(name)) return sanitizeLocalUrl(trimmed, name)
  if (name.endsWith('opacity') || name === 'opacity') return sanitizeOpacity(trimmed, name)
  if (name === 'stroke-width' || name === 'stroke-dashoffset' || name === 'font-size') {
    if (!CSS_LENGTH.test(trimmed)) reject(`SVG template style property "${name}" must be a safe length`)
    return trimmed
  }
  const keywordValues: Record<string, RegExp> = {
    'stroke-linecap': /^(?:butt|round|square)$/,
    'stroke-linejoin': /^(?:miter|round|bevel)$/,
    'fill-rule': /^(?:nonzero|evenodd)$/,
    'clip-rule': /^(?:nonzero|evenodd)$/,
    display: /^(?:inline|none)$/,
    visibility: /^(?:visible|hidden|collapse)$/,
    'vector-effect': /^(?:none|non-scaling-stroke)$/,
    'text-anchor': /^(?:start|middle|end)$/,
    'dominant-baseline': /^[a-z-]+$/,
    'font-style': /^(?:normal|italic|oblique)$/,
    'font-weight': /^(?:normal|bold|[1-9]00)$/,
  }
  if (keywordValues[name]?.test(trimmed)) return trimmed
  reject(`SVG template style property "${name}" contains an unsupported value`)
}

function parseViewBox(value: string): void {
  const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?'
  const match = new RegExp(`^\\s*(${number})[\\s,]+(${number})[\\s,]+(${number})[\\s,]+(${number})\\s*$`).exec(value)
  if (!match) reject('SVG template viewBox must contain exactly four finite numbers')
  const values = match.slice(1).map(Number)
  if (!values.every(Number.isFinite) || values[2] <= 0 || values[3] <= 0) {
    reject('SVG template viewBox width and height must be positive finite numbers')
  }
}

function sanitizeLocalUrl(value: string, attrName: string): string {
  const trimmed = value.trim()
  rejectCssEscape(trimmed, attrName)
  if (trimmed === 'none') return trimmed
  if (!/^url\(\s*#[A-Za-z_][\w:.-]*\s*\)$/.test(trimmed)) {
    reject(`SVG template ${attrName} must use only local url(#id) references`)
  }
  return trimmed
}

function sanitizeHref(value: string): string {
  const trimmed = value.trim()
  rejectCssEscape(trimmed, 'href')
  if (!/^#[A-Za-z_][\w:.-]*$/.test(trimmed)) {
    reject('SVG template href must be a local fragment reference')
  }
  return trimmed
}

function sanitizeStyle(value: string): string {
  rejectCssEscape(value, 'style attribute')
  const parts = value.split(';').map((part) => part.trim()).filter(Boolean)
  const sanitized: string[] = []
  for (const part of parts) {
    const colon = part.indexOf(':')
    if (colon <= 0 || part.indexOf(':', colon + 1) >= 0) reject('SVG template style attribute is malformed')
    const name = part.slice(0, colon).trim()
    const cssValue = part.slice(colon + 1).trim()
    if (!SAFE_STYLE_PROPERTIES.has(name)) reject(`SVG template style property "${name}" is not supported`)
    if (!cssValue) reject(`SVG template style property "${name}" is empty`)
    sanitized.push(`${name}:${sanitizeStyleValue(name, cssValue)}`)
  }
  return sanitized.join('; ')
}

function sanitizeAttribute(attr: Attr): { name: string; value: string; namespace: string | null } | null {
  if (attr.namespaceURI === XMLNS_NS) return null
  rejectCssEscape(attr.value, `attribute "${attr.name}"`)
  if (attr.name.startsWith('on')) reject(`SVG template event attribute "${attr.name}" is not allowed`)
  if (attr.prefix && attr.name !== 'xml:space' && attr.name !== 'xlink:href') {
    reject(`SVG template attribute namespace "${attr.name}" is not allowed`)
  }
  if (attr.namespaceURI && attr.namespaceURI !== XLINK_NS && attr.namespaceURI !== XML_NS) {
    reject(`SVG template attribute namespace "${attr.name}" is not allowed`)
  }
  if (attr.name === 'style') {
    return { name: 'style', value: sanitizeStyle(attr.value), namespace: null }
  }
  if (!ALLOWED_ATTRIBUTES.has(attr.name) && attr.name !== 'xlink:href') {
    reject(`SVG template attribute "${attr.name}" is not supported`)
  }
  if (attr.name === 'href' || attr.name === 'xlink:href') {
    return { name: 'href', value: sanitizeHref(attr.value), namespace: null }
  }
  if (attr.name === 'data-snl-slot') {
    if (!/^(0|[1-9]\d?)$/.test(attr.value)) reject('SVG template slot markers must be integers from 0 to 99')
    return { name: attr.name, value: attr.value, namespace: null }
  }
  if (LOCAL_URL_ONLY_ATTRIBUTES.has(attr.name)) {
    return { name: attr.name, value: sanitizeLocalUrl(attr.value, attr.name), namespace: null }
  }
  if (PAINT_OR_URL_ATTRIBUTES.has(attr.name) || attr.name === 'color' || attr.name === 'stop-color') {
    return { name: attr.name, value: sanitizePaint(attr.value, attr.name), namespace: null }
  }
  if (/\b(?:javascript:|data:|https?:|file:|ftp:)\b/i.test(attr.value)) {
    reject(`SVG template attribute "${attr.name}" contains an external URL`)
  }
  return { name: attr.name, value: attr.value, namespace: null }
}

function sanitizeNode(
  node: Node,
  ownerDocument: Document,
  slots: SvgTemplateSlot[],
  parentTag: string | null,
): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? ''
    if (text.trim().length === 0 || (parentTag && TEXT_CONTAINERS.has(parentTag))) {
      return ownerDocument.createTextNode(text)
    }
    reject('SVG template contains text outside supported text elements')
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null
  const element = node as Element
  if (element.namespaceURI !== SVG_NS || element.prefix) {
    reject(`SVG template element "${element.tagName}" must stay in the SVG namespace`)
  }
  if (BANNED_ELEMENTS.has(element.localName)) {
    reject(`SVG template element "${element.localName}" is not allowed`)
  }
  if (!ALLOWED_ELEMENTS.has(element.localName)) {
    reject(`SVG template element "${element.localName}" is not supported`)
  }
  if (element.hasAttribute('data-snl-slot')) {
    if (element.localName !== 'g') reject('SVG template slot anchors must be <g> elements')
    if (element.childNodes.length !== 0) reject('SVG template slot <g> anchors must be empty')
  }
  const sanitized = ownerDocument.createElementNS(SVG_NS, element.localName)
  for (const attr of Array.from(element.attributes)) {
    const sanitizedAttr = sanitizeAttribute(attr)
    if (!sanitizedAttr) continue
    sanitized.setAttributeNS(sanitizedAttr.namespace, sanitizedAttr.name, sanitizedAttr.value)
  }
  const slotValue = sanitized.getAttribute('data-snl-slot')
  if (slotValue !== null) {
    slots.push({ index: Number(slotValue), element: sanitized as SVGGElement })
  }
  for (const child of Array.from(element.childNodes)) {
    const sanitizedChild = sanitizeNode(child, ownerDocument, slots, element.localName)
    if (sanitizedChild) sanitized.appendChild(sanitizedChild)
  }
  return sanitized
}

function localReferenceIds(root: SVGSVGElement): string[] {
  const references: string[] = []
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attr of Array.from(element.attributes)) {
      if (attr.name === 'href') references.push(attr.value.slice(1))
      for (const match of attr.value.matchAll(/url\(\s*#([A-Za-z_][\w:.-]*)\s*\)/g)) references.push(match[1])
    }
  }
  return references
}

function elementsWithId(root: SVGSVGElement): Element[] {
  return [
    ...(root.hasAttribute('id') ? [root] : []),
    ...Array.from(root.querySelectorAll('[id]')),
  ]
}

function validateLocalReferences(root: SVGSVGElement): void {
  const ids = new Set<string>()
  for (const element of elementsWithId(root)) {
    if (ids.has(element.id)) reject(`SVG template contains duplicate id "${element.id}"`)
    ids.add(element.id)
  }
  for (const target of localReferenceIds(root)) {
    if (!ids.has(target)) reject(`SVG template local fragment target "#${target}" does not exist inside the sanitized root`)
  }
}

export function instantiateSvgTemplate(template: ParsedSvgTemplate, instanceScope: string): SVGSVGElement {
  if (!/^[A-Za-z_][\w.-]*$/.test(instanceScope)) reject('SVG template instance scope must be a safe identifier')
  const root = template.root.cloneNode(true) as SVGSVGElement
  const rewritten = new Map<string, string>()
  for (const element of elementsWithId(root)) {
    const scoped = `${instanceScope}--${element.id}`
    rewritten.set(element.id, scoped)
    element.id = scoped
  }
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attr of Array.from(element.attributes)) {
      let value = attr.value
      if (attr.name === 'href' && value.startsWith('#')) value = `#${rewritten.get(value.slice(1))}`
      value = value.replace(/url\(\s*#([A-Za-z_][\w:.-]*)\s*\)/g, (_whole, id: string) => `url(#${rewritten.get(id)})`)
      if (value !== attr.value) element.setAttribute(attr.name, value)
    }
  }
  return root
}

export function parseSanitizedSvgTemplate(
  source: string,
  options: ParseSanitizedSvgTemplateOptions = {},
): ParsedSvgTemplate {
  const parsedRoot = parseSvgDocument(source)
  if ((options as { dynamic_arity?: boolean }).dynamic_arity === true) {
    reject('SVG templates support fixed arity only; dynamic arity has no variadic slot syntax')
  }
  const viewBox = parsedRoot.getAttribute('viewBox')?.trim()
  if (!viewBox) reject('SVG template must declare a non-empty viewBox')
  parseViewBox(viewBox)

  const slots: SvgTemplateSlot[] = []
  const sanitizedRoot = sanitizeNode(parsedRoot, document, slots, null)
  if (!(sanitizedRoot instanceof SVGSVGElement)) reject('SVG template root did not sanitize to <svg>')
  validateLocalReferences(sanitizedRoot)

  slots.sort((left, right) => left.index - right.index)
  const contract = analyzeOrderedSlotIndices(
    slots.map((slot) => slot.index),
    false,
  )
  if (contract.invalid) reject('SVG template slot markers must form a contiguous positional set')

  return {
    viewBox,
    root: sanitizedRoot,
    slots,
  }
}

export function bindSvgTemplateChildren<T>(
  template: ParsedSvgTemplate,
  children: readonly SnlSyntaxTree[],
  renderChild: (child: SnlSyntaxTree, index: number) => T,
): Array<{ slot: SvgTemplateSlot; rendered: T }> {
  if (children.length !== template.slots.length) {
    reject(`SVG template requires exactly ${template.slots.length} children; received ${children.length}`)
  }
  return template.slots.map((slot) => {
    const child = children[slot.index]
    if (!child) reject(`SVG template slot ${slot.index} has no corresponding child subtree`)
    return {
      slot,
      rendered: renderChild(child, slot.index),
    }
  })
}
