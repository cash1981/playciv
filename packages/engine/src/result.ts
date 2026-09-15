/**
 * The Result type the engine returns. No reducer throws — the old Java
 * actions threw `WebApplicationException` carrying an HTTP status, and that
 * does not belong in domain logic.
 */

export type Ok<T> = { readonly ok: true; readonly value: T }
export type Err<E> = { readonly ok: false; readonly error: E }
export type Result<T, E> = Ok<T> | Err<E>

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
export const err = <E>(error: E): Err<E> => ({ ok: false, error })

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok

/** Unwraps an Ok, or throws. For tests and scripts only. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value
  throw new Error(`unwrap on an Err: ${JSON.stringify(result.error)}`)
}

/** Unwraps an Err, or throws. For tests and scripts only. */
export function unwrapErr<T, E>(result: Result<T, E>): E {
  if (!result.ok) return result.error
  throw new Error('unwrapErr on an Ok')
}
