export interface TemplateRecord {
  latex: string
  childCount: number
  kind: string
  description: string
}

export interface OperatorRecord {
  description: string
  styles: Record<string, TemplateRecord>
}

export type TemplateDb = Record<string, OperatorRecord>
