import { StrictMode, useEffect, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import {
  HoverPopoverProvider,
  useCurrentPopoverId,
  useHoverPopovers,
  type HoverPopover,
} from '../../src/snl-react-view/hover-popovers'

type Subject = 'root' | 'child' | 'direct' | 'settling'
type Snapshot = {
  id: string
  subject: Subject
  parentId: string | null
  frozen: boolean
  phase: string
  originRect: { left: number; top: number; width: number; height: number }
  anchorId: string | null
}

declare global {
  interface Window {
    __popoverProbe: {
      snapshots: Snapshot[]
      live(): Array<Snapshot & { left: number; top: number; width: number; bounds: string | null }>
      moveOrigin(dx: number, dy: number): void
      dismissAll(): void
    }
  }
}

const snapshots: Snapshot[] = []
let dismissAll = () => {}

function descriptor(element: HTMLElement) {
  return { element, bounds: 'viewport' as const }
}

function Origin({ subject, parentId = null }: { subject: Subject; parentId?: string | null }): ReactElement {
  const api = useHoverPopovers<Subject>()
  useEffect(() => { dismissAll = api.dismissAll }, [api])
  return (
    <button
      id={`origin-${subject}`}
      data-origin-subject={subject}
      onPointerMove={(event) => api.preview(subject, descriptor(event.currentTarget), event.clientX, event.clientY, parentId)}
      onClick={(event) => api.pin(subject, descriptor(event.currentTarget), event.clientX, event.clientY, parentId)}
    >{subject}</button>
  )
}

function SettlingBody(): ReactElement {
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), 50)
    return () => clearTimeout(timer)
  }, [])
  return <div className={`popover-body settling ${settled ? 'settled' : 'loading'}`}>{settled ? 'settled' : 'loading'}</div>
}

function PopoverBody({ popover }: { popover: HoverPopover<Subject> }): ReactElement {
  const currentId = useCurrentPopoverId()
  if (popover.subject === 'settling') return <SettlingBody />
  return (
    <div className="popover-body" data-subject={popover.subject}>
      {popover.subject}
      {popover.subject === 'root' ? <Origin subject="child" parentId={currentId} /> : null}
    </div>
  )
}

function App(): ReactElement {
  return (
    <HoverPopoverProvider<Subject>
      options={{ openDelayMs: 0, fadeMs: 0, offset: 12, viewportMargin: 8 }}
      style={(popover) => popover.subject === 'settling'
        ? { height: 44, boxSizing: 'border-box' }
        : { width: 100, height: 44, boxSizing: 'border-box' }}
      renderPopover={(popover) => {
        snapshots.push({
          id: popover.id,
          subject: popover.subject,
          parentId: popover.parentId,
          frozen: popover.frozen,
          phase: popover.phase,
          originRect: {
            left: popover.originRect.left,
            top: popover.originRect.top,
            width: popover.originRect.width,
            height: popover.originRect.height,
          },
          anchorId: popover.originElement?.id ?? null,
        })
        return <PopoverBody popover={popover} />
      }}
    >
      <Origin subject="root" />
      <Origin subject="direct" />
      <Origin subject="settling" />
    </HoverPopoverProvider>
  )
}

Object.assign(document.body.style, { margin: '0', minHeight: '700px' })
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)

window.__popoverProbe = {
  snapshots,
  live: () => [...document.querySelectorAll<HTMLElement>('[data-popover-id]')].map((element) => {
    const id = element.dataset.popoverId!
    const snapshot = [...snapshots].reverse().find((item) => item.id === id)!
    const rect = element.getBoundingClientRect()
    return { ...snapshot, left: rect.left, top: rect.top, width: rect.width, bounds: 'viewport' }
  }),
  moveOrigin(dx, dy) {
    const element = document.getElementById('origin-root')!
    element.style.transform = `translate(${dx}px, ${dy}px)`
  },
  dismissAll: () => dismissAll(),
}

const style = document.createElement('style')
style.textContent = `
  #root { position: relative; height: 700px; }
  [data-origin-subject="root"] { position: absolute; left: calc(100vw - 80px); top: 80px; width: 52px; height: 28px; }
  [data-origin-subject="direct"] { position: absolute; left: 24px; top: 180px; width: 52px; height: 28px; }
  [data-origin-subject="settling"] { position: absolute; left: 64px; top: 260px; width: 24px; height: 28px; }
  [data-popover-id] { background: white; border: 1px solid black; }
  [data-popover-id]:has(.settling) { border: 0; }
  .settling { height: 44px; box-sizing: border-box; }
  .settling.loading { width: 304px; }
  .settling.settled { width: 224px; }
  [data-popover-id] [data-origin-subject="child"] { width: 52px; height: 24px; }
`
document.head.append(style)
