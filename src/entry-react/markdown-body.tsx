import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

export interface MarkdownBodyProps {
  source: string
  image_url_transform?: (source: string) => string
}

export function MarkdownBody({ source, image_url_transform }: MarkdownBodyProps): React.ReactElement {
  const components = image_url_transform ? {
    img: ({ node: _node, src, ...props }: React.ComponentPropsWithoutRef<'img'> & { node?: unknown }) => (
      <img {...props} src={src ? image_url_transform(src) : src} />
    ),
  } : undefined
  return <div className="snl-markdown-body"><ReactMarkdown components={components} remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{source}</ReactMarkdown></div>
}
