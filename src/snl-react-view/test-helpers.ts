/**
 * Test helper: creates a MacroDataDriver from a plain SnlMacroRecord for tests.
 */
import type { SnlMacroRecord } from '../snl-macro/types'
import { MacroDataDriver } from '../snl-macro/macro-data-driver'

/**
 * Create a MacroDataDriver backed by a test DB record.
 * The driver queries the record on demand.
 */
export function testDriver(db: SnlMacroRecord): MacroDataDriver {
  return new MacroDataDriver({
    queries: {
      async query_macro({ macro_name }) {
        return db[macro_name] ?? null
      },
    },
  })
}
