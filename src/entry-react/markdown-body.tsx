import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

export interface MarkdownBodyProps { source: string }

export function MarkdownBody({ source }: MarkdownBodyProps): React.ReactElement {
  return <div className="snl-markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{source}</ReactMarkdown></div>
}
