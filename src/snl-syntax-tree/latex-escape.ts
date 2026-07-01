/** LaTeX 文本命令参数内需要转义的字符 */
export function escapeLatexText(raw: string): string {
  return raw.replace(/[\\{}_$%&#^~]/g, (ch) => `\\${ch}`)
}

/**
 * 裸名函数应用（无 DB 模板）的算子头：\\operatorname{…}，正体多字标识符。
 * 子公式由 resolveNodeLatex 递归后放在括号内、逗号分隔。
 */
export function fvarAppliedHeadLatex(name: string): string {
  return `\\operatorname{${escapeLatexText(name)}}`
}
