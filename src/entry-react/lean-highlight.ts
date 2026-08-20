import type { LanguageFn } from 'lowlight'

/**
 * Deliberately lexical Lean 4 highlighting.
 *
 * This recognizes stable surface syntax only. Name resolution, elaborator
 * categories, tactic state, errors, and semantic token classes require a Lean
 * language server and are intentionally outside this renderer.
 */
export const leanLanguage: LanguageFn = (hljs) => ({
  name: 'Lean 4',
  aliases: ['lean', 'lean4'],
  unicodeRegex: true,
  keywords: {
    $pattern: /[\p{L}\p{M}\p{N}_']+/u,
    keyword: [
      'abbrev', 'axiom', 'class', 'constant', 'def', 'deriving', 'do', 'else',
      'end', 'example', 'export', 'extends', 'for', 'forall', 'from', 'fun',
      'have', 'if', 'import', 'in', 'include', 'inductive', 'infix', 'infixl',
      'infixr', 'instance', 'let', 'macro', 'match', 'namespace', 'notation',
      'opaque', 'open', 'partial', 'private', 'protected', 'section', 'show',
      'structure', 'syntax', 'then', 'theorem', 'universe', 'variable', 'where',
      'with', 'by',
    ].join(' '),
    built_in: [
      'apply', 'assumption', 'calc', 'cases', 'constructor', 'contradiction',
      'exact', 'first', 'funext', 'induction', 'infer_instance', 'intro', 'intros',
      'left', 'next', 'nomatch', 'rfl', 'right', 'rw', 'simp', 'simpa', 'solve',
      'subst', 'trivial',
    ].join(' '),
    type: 'Any Array Bool Char Empty Fin Float Int IO List Nat Option Prop Sort String Subtype Type UInt Unit',
    literal: 'false true',
  },
  contains: [
    hljs.COMMENT('--', '$'),
    hljs.COMMENT('/-', '-/', { contains: ['self'] }),
    {
      scope: 'meta',
      begin: /#[A-Za-z_][A-Za-z0-9_']*/,
      relevance: 10,
    },
    {
      scope: 'symbol',
      begin: /@[A-Za-z_][A-Za-z0-9_']*/,
    },
    hljs.QUOTE_STRING_MODE,
    {
      scope: 'string',
      match: /(?<![\p{L}\p{N}_'])'(?:\\(?:u\{[0-9A-Fa-f]+\}|.)|[^\\'])'(?![\p{L}\p{N}_'])/u,
    },
    hljs.C_NUMBER_MODE,
  ],
})

export default leanLanguage
