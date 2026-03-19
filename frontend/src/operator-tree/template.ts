export function fillLatexTemplate(
  template: string,
  values: Record<string, string | number | undefined>,
): string {
  const byBraces = template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const value = values[key]
    return value === undefined ? '' : String(value)
  })

  // 兼容数据库模板格式：@CHILD1@、@CHILD2@
  return byBraces.replace(/@([A-Z0-9_]+)@/g, (_, key: string) => {
    const normalized = key.toLowerCase()
    // CHILD1 -> child0，CHILD2 -> child1
    const childMatch = /^child(\d+)$/.exec(normalized)
    if (!childMatch) {
      const value = values[normalized]
      return value === undefined ? '' : String(value)
    }
    const index = Number(childMatch[1]) - 1
    const value = values[`child${index}`]
    return value === undefined ? '' : String(value)
  })
}
