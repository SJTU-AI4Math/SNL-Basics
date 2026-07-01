export interface SnlSyntaxTree {
  name: string
  style: string
  kind: string
  mdata: unknown
  children: SnlSyntaxTree[]
}

export function createSnlSyntaxTreeNode(
  name: string,
  options?: Partial<Pick<SnlSyntaxTree, 'style' | 'kind' | 'mdata' | 'children'>>,
): SnlSyntaxTree {
  return {
    name,
    style: options?.style ?? '',
    kind: options?.kind ?? '',
    mdata: options?.mdata ?? null,
    children: options?.children ?? [],
  }
}

export function isSnlSyntaxTree(value: unknown): value is SnlSyntaxTree {
  if (!value || typeof value !== 'object') {
    return false
  }

  const node = value as Partial<SnlSyntaxTree>
  return (
    typeof node.name === 'string' &&
    typeof node.style === 'string' &&
    typeof node.kind === 'string' &&
    Array.isArray(node.children)
  )
}
