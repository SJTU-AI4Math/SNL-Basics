import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type FC,
  type ReactElement,
} from 'react'
import type { SnlBlockMacroTemplate } from '../snl-macro/types'
import {
  FORMULA_FOREIGN_RENDERER_CAPABILITY,
  deriveFixedFormulaMetrics,
  readFixedFormulaEmbedPolicy,
  type FormulaForeignCandidate,
  type FormulaForeignCapableRenderer,
} from './formula-foreign-box'
import type { SnlBlockRendererProps } from './hooks'
import { ForeignBoxHost } from './foreign-box-host'
import { ForeignBoxFallback, useForeignBox } from './use-foreign-box'
import {
  bindSvgTemplateChildren,
  instantiateSvgTemplate,
  parseSanitizedSvgTemplate,
} from './svg-template'
import {
  SvgTemplateAssetRegistry,
  type SvgTemplateAssetIdentity,
} from './svg-template-asset-registry'

export interface SvgTemplateProjection {
  readonly asset: SvgTemplateAssetIdentity & { readonly requestEpoch: number }
  readonly generation: number
  readonly producerRevision: string
  readonly accessibilityLabel: string
}

export interface SvgTemplateRendererOptions {
  readonly assetRegistry: SvgTemplateAssetRegistry
}

export type SvgTemplateRendererProps = SnlBlockRendererProps

interface ProjectionRecord {
  readonly asset?: unknown
  readonly generation?: unknown
  readonly producer_revision?: unknown
  readonly accessibility?: unknown
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`SVG template ${label} must be a non-empty string`)
  return value
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`SVG template ${label} must be a non-negative safe integer`)
  }
  return value as number
}

/**
 * Read only the renderer-owned extension on the already-resolved complete
 * TemplateSpec projection. Macro names, ontology, and authored SNL text never
 * participate in asset or producer identity.
 */
export function readSvgTemplateProjection(template: SnlBlockMacroTemplate): SvgTemplateProjection {
  const raw = template.svg_template
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('SVG renderer requires a complete consumer-owned svg_template projection')
  }
  const record = raw as ProjectionRecord
  if (!record.asset || typeof record.asset !== 'object' || Array.isArray(record.asset)) {
    throw new TypeError('SVG template asset identity is required')
  }
  const asset = record.asset as Record<string, unknown>
  const accessibility = record.accessibility
  if (!accessibility || typeof accessibility !== 'object' || Array.isArray(accessibility)) {
    throw new TypeError('SVG template trusted accessibility projection is required')
  }
  const accessibilityRecord = accessibility as Record<string, unknown>
  return Object.freeze({
    asset: Object.freeze({
      source: requiredString(asset.source, 'asset source'),
      baseIdentity: requiredString(asset.base_identity, 'asset base identity'),
      revision: requiredString(asset.revision, 'asset revision'),
      requestEpoch: nonnegativeInteger(asset.request_epoch, 'asset request epoch'),
    }),
    generation: nonnegativeInteger(record.generation, 'foreign generation'),
    producerRevision: requiredString(record.producer_revision, 'producer revision'),
    accessibilityLabel: requiredString(accessibilityRecord.label, 'accessibility label'),
  })
}

function fallback(message: string): ReactElement {
  return (
    <div className="snl-svg-template-fallback" role="alert" data-snl-svg-template-fallback="true">
      SVG template unavailable: {message}
    </div>
  )
}

function projectionKey(projection: SvgTemplateProjection): string {
  return JSON.stringify([
    projection.asset.baseIdentity,
    projection.asset.source,
    projection.asset.revision,
    projection.asset.requestEpoch,
  ])
}

interface AssetState {
  readonly key: string
  readonly status: 'loading' | 'ready' | 'error'
  readonly source?: string
  readonly message?: string
}

interface SlotSurfaceProps {
  readonly marker: SVGGElement
  readonly child: ReactElement
  readonly treePath: string
  readonly generation: number
  readonly producer: string
}

function SlotSurface({ marker, child, treePath, generation, producer }: SlotSurfaceProps): ReactElement {
  const foreign = useForeignBox({
    identity: { treePath, generation, producer },
    child,
    alignment: 'center',
    ssrFallback: child,
  })
  useLayoutEffect(() => {
    foreign.markerRef(marker)
    return () => foreign.markerRef(null)
  }, [foreign.markerRef, marker])
  return (
    <ForeignBoxFallback foreign={foreign} as="div" className="snl-svg-template-slot-fallback">
      {child}
    </ForeignBoxFallback>
  )
}

interface ReadySurfaceProps extends SvgTemplateRendererProps {
  readonly source: string
  readonly projection: SvgTemplateProjection
}

function ReadySurface(props: ReadySurfaceProps): ReactElement {
  const instanceId = useId()
  const instanceScope = useMemo(
    () => `snl-svg-${instanceId.replace(/[^A-Za-z0-9_.-]/g, '-')}`,
    [instanceId],
  )
  // Parsing/sanitization is consumer-local, but the instantiated artwork is
  // stable for the lifetime of one asset identity. Child projection changes
  // must not replace the mounted SVG DOM.
  const artwork = useMemo(() => {
    try {
      const parsed = parseSanitizedSvgTemplate(props.source)
      const root = instantiateSvgTemplate(parsed, instanceScope)
      root.setAttribute('role', 'img')
      root.setAttribute('focusable', 'false')
      root.classList.add('snl-svg-template-artwork')
      const markersByIndex = new Map<number, SVGGElement>()
      for (const marker of Array.from(root.querySelectorAll<SVGGElement>('g[data-snl-slot]'))) {
        const index = Number(marker.getAttribute('data-snl-slot'))
        if (markersByIndex.has(index)) throw new Error(`duplicate instantiated slot ${index}`)
        markersByIndex.set(index, marker)
      }
      return { parsed, root, markersByIndex, error: null as string | null }
    } catch (reason) {
      return {
        parsed: null,
        root: null,
        markersByIndex: new Map<number, SVGGElement>(),
        error: reason instanceof Error ? reason.message : String(reason),
      }
    }
  }, [instanceScope, props.source])

  useLayoutEffect(() => {
    artwork.root?.setAttribute('aria-label', props.projection.accessibilityLabel)
  }, [artwork, props.projection.accessibilityLabel])

  const prepared = useMemo(() => {
    if (!artwork.parsed || !artwork.root) return { slots: [], error: artwork.error }
    try {
      const rendered = bindSvgTemplateChildren(artwork.parsed, props.node.children, (child, index) => {
        if (props.childMode(child) === 'block') {
          throw new Error(`block-mode child at SVG slot ${index} is not supported`)
        }
        if (!props.childContainsBlock) {
          throw new Error(`recursive block capability at SVG slot ${index} is unavailable`)
        }
        if (props.childContainsBlock(child)) {
          throw new Error(`descendant block content at SVG slot ${index} is not supported`)
        }
        return <div className="snl-svg-template-slot-content">{props.renderChild(child, index)}</div>
      })
      const slots = rendered.map(({ slot, rendered: child }) => {
        const marker = artwork.markersByIndex.get(slot.index)
        if (!marker) throw new Error(`instantiated SVG slot ${slot.index} is missing`)
        return { index: slot.index, marker, child }
      })
      if (artwork.markersByIndex.size !== slots.length) throw new Error('instantiated SVG slot set changed after sanitization')
      return { slots, error: null as string | null }
    } catch (reason) {
      return { slots: [], error: reason instanceof Error ? reason.message : String(reason) }
    }
  }, [artwork, props.node.children, props.renderChild, props.childMode, props.childContainsBlock])

  const mountSvg = (host: HTMLDivElement | null): void => {
    if (!host || !artwork.root) return
    if (host.firstChild !== artwork.root || host.childNodes.length !== 1) host.replaceChildren(artwork.root)
  }

  if (prepared.error || !artwork.root) return fallback(prepared.error ?? artwork.error ?? 'sanitized SVG could not be instantiated')
  const producer = JSON.stringify([
    props.projection.asset.baseIdentity,
    props.projection.asset.source,
    props.projection.asset.revision,
    props.projection.asset.requestEpoch,
    props.projection.producerRevision,
  ])
  return (
    <ForeignBoxHost className="snl-svg-template">
      <div className="snl-svg-template-canvas" ref={mountSvg} />
      {prepared.slots.map(({ index, marker, child }) => (
        <SlotSurface
          key={index}
          marker={marker}
          child={child}
          treePath={props.treePath ? `${props.treePath}.${index}` : `${index}`}
          generation={props.projection.generation}
          producer={producer}
        />
      ))}
    </ForeignBoxHost>
  )
}

function LiveRenderer(
  props: SvgTemplateRendererProps & { readonly projection: SvgTemplateProjection; readonly registry: SvgTemplateAssetRegistry },
): ReactElement {
  const key = projectionKey(props.projection)
  const [state, setState] = useState<AssetState>(() => ({ key, status: 'loading' }))
  useEffect(() => {
    let alive = true
    setState({ key, status: 'loading' })
    const handle = props.registry.acquire(props.projection.asset, props.projection.asset.requestEpoch)
    void handle.promise.then(
      (result) => {
        if (alive) setState({ key, status: 'ready', source: result.value })
      },
      (reason: unknown) => {
        if (alive) setState({
          key,
          status: 'error',
          message: reason instanceof Error ? reason.message : String(reason),
        })
      },
    )
    return () => {
      alive = false
      handle.release()
    }
  }, [props.registry, key])

  const current = state.key === key ? state : { key, status: 'loading' as const }
  if (current.status === 'error') return fallback(current.message ?? 'asset load failed')
  if (current.status !== 'ready' || current.source === undefined) {
    return <div className="snl-svg-template-loading" role="status">Loading SVG template…</div>
  }
  return <ReadySurface {...props} source={current.source} />
}

/** Build an opt-in consumer renderer. The default renderer registry is unchanged. */
export function createSvgTemplateRenderer(options: SvgTemplateRendererOptions): FC<SvgTemplateRendererProps> {
  const SvgTemplateRenderer: FC<SvgTemplateRendererProps> & FormulaForeignCapableRenderer = (props): ReactElement => {
    let projection: SvgTemplateProjection
    try {
      projection = readSvgTemplateProjection(props.template)
      if (props.dynamicArity) throw new Error('SVG templates support fixed arity only; dynamic arity is not supported')
    } catch (reason) {
      return fallback(reason instanceof Error ? reason.message : String(reason))
    }
    return <LiveRenderer {...props} projection={projection} registry={options.assetRegistry} />
  }
  Object.defineProperty(SvgTemplateRenderer, FORMULA_FOREIGN_RENDERER_CAPABILITY, {
    enumerable: false,
    configurable: false,
    value: Object.freeze({
      async prepare(candidate: FormulaForeignCandidate) {
        if (candidate.dynamicArity) throw new Error('SVG formula embedding supports fixed arity only')
        const projection = readSvgTemplateProjection(candidate.template)
        const policy = readFixedFormulaEmbedPolicy(candidate.template)
        if (candidate.signal?.aborted) throw new DOMException('SVG formula embedding aborted', 'AbortError')
        const handle = options.assetRegistry.acquire(projection.asset, projection.asset.requestEpoch)
        let removeAbortListener = () => {}
        try {
          const abort = candidate.signal
            ? new Promise<never>((_resolve, reject) => {
                const signal = candidate.signal!
                const onAbort = () => reject(new DOMException('SVG formula embedding aborted', 'AbortError'))
                signal.addEventListener('abort', onAbort, { once: true })
                removeAbortListener = () => signal.removeEventListener('abort', onAbort)
                if (signal.aborted) onAbort()
              })
            : new Promise<never>(() => {})
          const result = await Promise.race([handle.promise, abort])
          const parsed = parseSanitizedSvgTemplate(result.value)
          const metrics = deriveFixedFormulaMetrics(parsed.viewBox, policy)
          const producer = JSON.stringify([
            projection.asset.baseIdentity,
            projection.asset.source,
            projection.asset.revision,
            projection.asset.requestEpoch,
            projection.producerRevision,
          ])
          return Object.freeze({
            identity: JSON.stringify([candidate.treePath, projection.generation, producer]),
            metrics,
            rendererKey: candidate.template.block_template_name ?? '',
            producer,
            generation: projection.generation,
            accessibilityLabel: projection.accessibilityLabel,
            dynamicMetrics: policy.dynamicMeasurement,
          })
        } finally {
          removeAbortListener()
          handle.release()
        }
      },
    }),
  })
  return SvgTemplateRenderer
}
