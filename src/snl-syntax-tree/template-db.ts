export interface SnlMacroTemplateRecord {
  latex: string
  childCount: number
  kind: string
  description: string
}

export interface SnlMacroDbEntry {
  description: string
  styles: Record<string, SnlMacroTemplateRecord>
}

export type SnlMacroDb = Record<string, SnlMacroDbEntry>
