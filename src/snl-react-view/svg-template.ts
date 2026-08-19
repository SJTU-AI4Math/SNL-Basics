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
  element: SVGElement
}

export interface ParsedSvgTemplate {
  viewBox: string
  root: SVGSVGElement
  slots: SvgTemplateSlot[]
}

export interface ParseSanitizedSvgTemplateOptions {
  dynamic_arity?: boolean
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

function sanitizeLocalUrl(value: string, attrName: string): string {
  const trimmed = value.trim()
  if (trimmed === 'none') return trimmed
  if (!/^url\(\s*#[A-Za-z_][\w:.-]*\s*\)$/.test(trimmed)) {
    reject(`SVG template ${attrName} must use only local url(#id) references`)
  }
  return trimmed
}

function sanitizeHref(value: string): string {
  const trimmed = value.trim()
  if (!/^#[A-Za-z_][\w:.-]*$/.test(trimmed)) {
    reject('SVG template href must be a local fragment reference')
  }
  return trimmed
}

function sanitizeStyle(value: string): string {
  if (/@import|@font-face|expression\s*\(/i.test(value)) {
    reject('SVG template style attribute contains unsupported active content')
  }
  const parts = value.split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  const sanitized: string[] = []
  for (const part of parts) {
    const colon = part.indexOf(':')
    if (colon <= 0) reject('SVG template style attribute is malformed')
    const name = part.slice(0, colon).trim()
    const cssValue = part.slice(colon + 1).trim()
    if (!ALLOWED_ATTRIBUTES.has(name)) {
      reject(`SVG template style property "${name}" is not supported`)
    }
    if (cssValue.length === 0) reject(`SVG template style property "${name}" is empty`)
    if (LOCAL_URL_ONLY_ATTRIBUTES.has(name)) {
      sanitized.push(`${name}:${sanitizeLocalUrl(cssValue, name)}`)
      continue
    }
    if (PAINT_OR_URL_ATTRIBUTES.has(name) && /url\s*\(/i.test(cssValue)) {
      sanitized.push(`${name}:${sanitizeLocalUrl(cssValue, name)}`)
      continue
    }
    if (/\b(?:javascript:|data:|https?:|file:|ftp:)\b/i.test(cssValue)) {
      reject(`SVG template style property "${name}" contains an external URL`)
    }
    sanitized.push(`${name}:${cssValue}`)
  }
  return sanitized.join('; ')
}

function sanitizeAttribute(attr: Attr): { name: string; value: string; namespace: string | null } | null {
  if (attr.namespaceURI === XMLNS_NS) return null
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
  if (PAINT_OR_URL_ATTRIBUTES.has(attr.name) && /url\s*\(/i.test(attr.value)) {
    return { name: attr.name, value: sanitizeLocalUrl(attr.value, attr.name), namespace: null }
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
  const sanitized = ownerDocument.createElementNS(SVG_NS, element.localName)
  for (const attr of Array.from(element.attributes)) {
    const sanitizedAttr = sanitizeAttribute(attr)
    if (!sanitizedAttr) continue
    sanitized.setAttributeNS(sanitizedAttr.namespace, sanitizedAttr.name, sanitizedAttr.value)
  }
  const slotValue = sanitized.getAttribute('data-snl-slot')
  if (slotValue !== null) {
    slots.push({ index: Number(slotValue), element: sanitized as SVGElement })
  }
  for (const child of Array.from(element.childNodes)) {
    const sanitizedChild = sanitizeNode(child, ownerDocument, slots, element.localName)
    if (sanitizedChild) sanitized.appendChild(sanitizedChild)
  }
  return sanitized
}

export function parseSanitizedSvgTemplate(
  source: string,
  options: ParseSanitizedSvgTemplateOptions = {},
): ParsedSvgTemplate {
  const parsedRoot = parseSvgDocument(source)
  const viewBox = parsedRoot.getAttribute('viewBox')?.trim()
  if (!viewBox) reject('SVG template must declare a non-empty viewBox')

  const slots: SvgTemplateSlot[] = []
  const sanitizedRoot = sanitizeNode(parsedRoot, document, slots, null)
  if (!(sanitizedRoot instanceof SVGSVGElement)) reject('SVG template root did not sanitize to <svg>')

  slots.sort((left, right) => left.index - right.index)
  const contract = analyzeOrderedSlotIndices(
    slots.map((slot) => slot.index),
    options.dynamic_arity ?? false,
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
  return template.slots.map((slot) => {
    const child = children[slot.index]
    if (!child) reject(`SVG template slot ${slot.index} has no corresponding child subtree`)
    return {
      slot,
      rendered: renderChild(child, slot.index),
    }
  })
}
