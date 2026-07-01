export function fillLatexTemplate(
  template: string,
  values: Record<string, string | number | undefined>,
): string {
  const byBraces = template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const value = values[key]
    return value === undefined ? '' : String(value)
  })

  // 兼容数据库模板格式：@CHILD0@、@CHILD1@（0-indexed，与 TS 数组下标对齐），以及变参 @CHILDREN@
  return byBraces.replace(/@([A-Z0-9_]+)@/g, (_, key: string) => {
    const normalized = key.toLowerCase()
    // 变参：@CHILDREN@ -> values.children_joined（无则空串）
    if (normalized === 'children') {
      const joined = values['children_joined']
      return joined === undefined ? '' : String(joined)
    }
    // CHILD0 -> child0，CHILD1 -> child1（直接对齐）
    const childMatch = /^child(\d+)$/.exec(normalized)
    if (!childMatch) {
      const value = values[normalized]
      return value === undefined ? '' : String(value)
    }
    const value = values[`child${Number(childMatch[1])}`]
    return value === undefined ? '' : String(value)
  })
}
