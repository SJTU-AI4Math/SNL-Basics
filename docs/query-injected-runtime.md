# Query-Injected Runtime Standard

SNL-Basics is storage- and host-agnostic. Any behavior whose result depends on
consumer runtime state—locale, theme, motion preferences, editor settings,
request context, permissions, or similar environment—must follow this standard.

## Rule

1. Model the environment-dependent calculation as `ReaderM<Environment, Value>`.
2. Expose a class initialized with a `queries` object; the consumer owns every
   query implementation.
3. The class must not read VS Code settings, browser globals, local storage,
   files, environment variables, or process-wide singletons.
4. Do not offer a second snapshot/record fallback beside the query backend.
   One capability has one source.
5. Query freshness and caching are explicit parts of the driver contract.
   `ReaderRuntime` deliberately queries on every `run_reader` so live settings
   changes become visible immediately.

This matches `MacroDataDriver`, `EntryDataDriver`, and
`SnlInteractionDriver`: Basics defines required capabilities; adapters choose
JSON, RPC, VS Code Settings, React state, test fixtures, or another backend.

## Runtime environment example

```ts
import {
  ReaderRuntime,
  read_localized,
  type I18n,
  type ReaderM,
} from '@sjtu-ai4math/snl-basics'

interface Preferences {
  language: 'en' | 'zh-CN'
  theme: 'light' | 'dark'
}

const runtime = new ReaderRuntime<Preferences>({
  queries: {
    query_environment: () => readConsumerPreferences(),
  },
})

const label: I18n<Preferences['language']> = {
  type: 'i18n',
  default_language: 'en',
  values: { en: 'Save', 'zh-CN': '保存' },
}

const render_label: ReaderM<Preferences, string> = (preferences) =>
  read_localized(label)(preferences)

runtime.run_reader(render_label)
```

## Reader boundaries

Keep parsers, schema migrations, identity logic, and computations that do not
actually depend on runtime state as ordinary pure functions. ReaderM is for
explicit environment dependencies, not a universal wrapper.

React and host frameworks should run Readers at their adapter boundary:

- React: a Context/provider supplies an environment query or runtime instance.
- VS Code: an adapter implements `query_environment` using Extension Settings
  and theme/language APIs.
- RPC/server: the query reads request-scoped context.
- Tests: the query returns a controlled fixture.

## I18n storage

`I18n<Language, Value>` is represented by a discriminated, JSON-serializable
language map. A plain value is invariant across languages. The selected
language is resolved in this order: exact language, `default_language`, first
available value; an empty map is an error.

Never use native JavaScript `Map` in persisted or cross-message data. Never use
the boxed TypeScript `String` type; use `string`.
