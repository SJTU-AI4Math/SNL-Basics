/** A pure computation that reads an environment supplied by the consumer. */
export type ReaderM<Environment, Value> = (environment: Environment) => Value

/** Map a ReaderM result without choosing where its environment comes from. */
export function map_reader<Environment, Value, Next>(
  reader: ReaderM<Environment, Value>,
  map: (value: Value) => Next,
): ReaderM<Environment, Next> {
  return (environment) => map(reader(environment))
}

/** Flat-map ReaderM computations while sharing the same environment. */
export function flat_map_reader<Environment, Value, Next>(
  reader: ReaderM<Environment, Value>,
  bind: (value: Value) => ReaderM<Environment, Next>,
): ReaderM<Environment, Next> {
  return (environment) => bind(reader(environment))(environment)
}

/** Lift an environment-independent value into ReaderM. */
export function pure_reader<Environment, Value>(
  value: Value,
): ReaderM<Environment, Value> {
  return () => value
}

/** Consumer-owned environment source. SNL-Basics never chooses its backend. */
export interface ReaderRuntimeQueries<Environment> {
  query_environment(): Environment
}

export interface ReaderRuntimeOptions<Environment> {
  queries: ReaderRuntimeQueries<Environment>
}

/**
 * Executes ReaderM computations against an injected environment query.
 *
 * The query is invoked for every run: consumers may back it with live settings,
 * React state, a request context, tests, or any other source without Basics
 * caching or presuming that source.
 */
export class ReaderRuntime<Environment> {
  private readonly queries: ReaderRuntimeQueries<Environment>

  constructor(options: ReaderRuntimeOptions<Environment>) {
    this.queries = options.queries
  }

  query_environment(): Environment {
    return this.queries.query_environment()
  }

  run_reader<Value>(reader: ReaderM<Environment, Value>): Value {
    return reader(this.query_environment())
  }
}

/** Serializable language map. The discriminator avoids confusing domain objects with I18n. */
export interface I18n<Language extends string, Value = string> {
  type: 'i18n'
  default_language: Language
  values: Partial<Record<Language, Value>>
}

/** A value can be language-invariant or explicitly localized. */
export type Localized<Language extends string, Value = string> =
  | Value
  | I18n<Language, Value>

export interface LanguageEnvironment<Language extends string> {
  language: Language
}

export function is_i18n<Language extends string, Value>(
  value: Localized<Language, Value>,
): value is I18n<Language, Value> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as unknown as Record<string, unknown>
  return (
    candidate.type === 'i18n' &&
    typeof candidate.default_language === 'string' &&
    typeof candidate.values === 'object' &&
    candidate.values !== null &&
    !Array.isArray(candidate.values)
  )
}

/** Resolve a Localized value using the environment language and deterministic fallback. */
export function read_localized<Language extends string, Value>(
  value: Localized<Language, Value>,
): ReaderM<LanguageEnvironment<Language>, Value> {
  return ({ language }) => {
    if (!is_i18n(value)) return value
    const exact = value.values[language]
    if (exact !== undefined) return exact
    const fallback = value.values[value.default_language]
    if (fallback !== undefined) return fallback
    for (const candidate of Object.keys(value.values)) {
      const resolved = value.values[candidate as Language]
      if (resolved !== undefined) return resolved
    }
    throw new Error('I18n map has no values')
  }
}
