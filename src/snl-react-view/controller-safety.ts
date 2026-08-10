/** Attach rejection handling to promises/thenables without awaiting them. */
export function absorbControllerResult(value: unknown): void {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return
  let then: unknown
  try {
    then = (value as { then?: unknown }).then
  } catch {
    return
  }
  if (typeof then !== 'function') return
  try {
    ;(then as (this: unknown, onFulfilled: () => void, onRejected: (reason: unknown) => void) => unknown)
      .call(value, () => {}, () => {})
  } catch {
    // A hostile thenable must not escape into the renderer.
  }
}
