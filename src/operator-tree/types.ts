export interface OperatorTree {
  name: string
  style: string
  kind: string
  mdata: unknown
  children: OperatorTree[]
}

export function createOperatorNode(
  name: string,
  options?: Partial<Pick<OperatorTree, 'style' | 'kind' | 'mdata' | 'children'>>,
): OperatorTree {
  return {
    name,
    style: options?.style ?? '',
    kind: options?.kind ?? '',
    mdata: options?.mdata ?? null,
    children: options?.children ?? [],
  }
}

export function isOperatorTree(value: unknown): value is OperatorTree {
  if (!value || typeof value !== 'object') {
    return false
  }

  const node = value as Partial<OperatorTree>
  return (
    typeof node.name === 'string' &&
    typeof node.style === 'string' &&
    typeof node.kind === 'string' &&
    Array.isArray(node.children)
  )
}
