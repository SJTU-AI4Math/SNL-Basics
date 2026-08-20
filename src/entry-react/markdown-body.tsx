import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { common } from 'lowlight'
import type { ColorScheme } from '../runtime'
import { leanLanguage } from './lean-highlight'

const HIGHLIGHT_OPTIONS = {
  aliases: { lean: ['lean4'] },
  detect: false,
  languages: { ...common, lean: leanLanguage },
  plainText: ['text', 'txt', 'plaintext'],
} as const

export interface MarkdownBodyProps {
  source: string
  image_url_transform?: (source: string) => string
  color_scheme?: ColorScheme
}

export function MarkdownBody({ source, image_url_transform, color_scheme }: MarkdownBodyProps): React.ReactElement {
  const components = image_url_transform ? {
    img: ({ node: _node, src, ...props }: React.ComponentPropsWithoutRef<'img'> & { node?: unknown }) => (
      <img {...props} src={src ? image_url_transform(src) : src} />
    ),
  } : undefined
  return (
    <div className="snl-markdown-body" data-color-scheme={color_scheme}>
      <ReactMarkdown
        components={components}
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, HIGHLIGHT_OPTIONS]]}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
