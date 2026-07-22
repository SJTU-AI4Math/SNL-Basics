import type { SnlMacroRecord } from './types'
import rawDb from '../../public/snl-macro-db.json'

/**
 * Bundled core macro DB — typed. Consumers can `import { bundledMacroDb }
 * from '@snl-basics/react'` to skip the fetch-and-parse dance.
 */
export const bundledMacroDb: SnlMacroRecord = rawDb as SnlMacroRecord
