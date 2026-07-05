/** LaTeX 文本命令参数内需要转义的字符 */
export function escapeLatexText(raw: string): string {
  return raw.replace(/[\\{}_$%&#^~]/g, (ch) => `\\${ch}`)
}

/**
 * Same as {@link escapeLatexText} but preserves `#N` / `#*` sequences —
 * used by the envMode 'text' path where the payload is a template body
 * (may contain `#0` / `#1` / `#*` placeholders) rather than a plain string.
 * Non-placeholder standalone `#` chars are still escaped.
 */
export function escapeTextButPreservePlaceholders(raw: string): string {
  // Sentinel used to hide placeholder markers from the escape pass.
  const SENTINEL = '\u0001PH\u0001'
  // Save `#0..#99` and `#*`.
  const saved: string[] = []
  const withoutPlaceholders = raw.replace(/#(\d{1,2}|\*)/g, (match) => {
    saved.push(match)
    return SENTINEL
  })
  const escaped = escapeLatexText(withoutPlaceholders)
  // Restore.
  let i = 0
  return escaped.replace(new RegExp(SENTINEL, 'g'), () => saved[i++])
}

/**
 * 裸名函数应用（无 DB 模板）的算子头：\\operatorname{…}，正体多字标识符。
 * 子公式由 resolveNodeLatex 递归后放在括号内、逗号分隔。
 */
export function fvarAppliedHeadLatex(name: string): string {
  return `\\operatorname{${escapeLatexText(name)}}`
}
