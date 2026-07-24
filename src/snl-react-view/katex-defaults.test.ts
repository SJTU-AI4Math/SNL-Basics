import { describe, expect, it } from 'vitest'
import type { TrustContext } from 'katex'
import { HTMLDATA_KATEX_DEFAULTS } from './katex-defaults'

function getTrustPolicy(): ((context: TrustContext) => boolean) | undefined {
  const policy: unknown = HTMLDATA_KATEX_DEFAULTS.trust
  return typeof policy === 'function'
    ? (policy as (context: TrustContext) => boolean)
    : undefined
}

describe('HTMLDATA_KATEX_DEFAULTS trust policy', () => {
  it('uses a command-aware trust callback', () => {
    expect(getTrustPolicy()).toBeTypeOf('function')
  })

  it('allows only the HTML extensions required by SNL rendering', () => {
    const trust = getTrustPolicy()
    expect(trust?.({ command: '\\htmlData', attributes: { name: 'FOL.eq' } })).toBe(true)
    expect(trust?.({ command: '\\htmlClass', class: 'snlMissingArg' })).toBe(true)
  })

  it.each([
    { command: '\\href', url: 'javascript:alert(1)', protocol: 'javascript' },
    { command: '\\url', url: 'https://example.com', protocol: 'https' },
    { command: '\\includegraphics', url: 'https://example.com/x.png', protocol: 'https' },
    { command: '\\htmlId', id: 'host-element' },
    { command: '\\htmlStyle', style: 'position:fixed' },
  ] satisfies TrustContext[])('rejects $command', (context) => {
    expect(getTrustPolicy()?.(context)).toBe(false)
  })
})
