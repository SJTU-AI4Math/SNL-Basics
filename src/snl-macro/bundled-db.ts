import type { SnlMacroDb } from './types'
import rawDb from '../../public/snl-macro-db.json'
import rawSamples from '../../public/snl-macro-db-samples.json'

/**
 * Bundled core macro DB — typed. Consumers can `import { bundledMacroDb }
 * from '@snl-basics/react'` to skip the fetch-and-parse dance.
 *
 * Note: this is the CORE math DB. For sample block macros (list/table/
 * centered), use {@link bundledSampleMacroDb} — kept separate so a
 * math-only consumer doesn't pay for the block samples.
 */
export const bundledMacroDb: SnlMacroDb = rawDb as SnlMacroDb

/**
 * Bundled sample block macros (sample.list / sample.table / sample.centered).
 * Merge with {@link bundledMacroDb} when you want the samples too.
 */
export const bundledSampleMacroDb: SnlMacroDb = rawSamples as SnlMacroDb
