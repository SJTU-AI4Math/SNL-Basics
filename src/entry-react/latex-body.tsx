import { useMemo, type ReactElement } from 'react'
import katex from 'katex'

export interface LatexBodyProps { source: string }

export function LatexBody({ source }: LatexBodyProps): ReactElement {
  const html = useMemo(() => katex.renderToString(source, { displayMode: true, throwOnError: false, strict: 'ignore', trust: false }), [source])
  return <div className="snl-latex-body" dangerouslySetInnerHTML={{ __html: html }} />
}
