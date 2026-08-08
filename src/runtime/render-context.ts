export type ColorScheme = 'light' | 'dark'

export interface RenderContext {
  color_scheme: ColorScheme
}

export type ContextReader = () => RenderContext

export const DEFAULT_CONTEXT_READER: ContextReader = () => ({ color_scheme: 'light' })
