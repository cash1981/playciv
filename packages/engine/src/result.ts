/**
 * Result-typen motoren returnerer. Ingen unntak kastes fra reducerne — de
 * gamle Java-actionene kastet `WebApplicationException` med HTTP-status, og
 * det hører ikke i domenelogikken.
 */

export type Ok<T> = { readonly ok: true; readonly value: T }
export type Err<E> = { readonly ok: false; readonly error: E }
export type Result<T, E> = Ok<T> | Err<E>

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
export const err = <E>(error: E): Err<E> => ({ ok: false, error })

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok

/** Pakker ut en Ok, eller kaster. Kun for tester og skript. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value
  throw new Error(`unwrap på Err: ${JSON.stringify(result.error)}`)
}

/** Pakker ut en Err, eller kaster. Kun for tester og skript. */
export function unwrapErr<T, E>(result: Result<T, E>): E {
  if (!result.ok) return result.error
  throw new Error('unwrapErr på Ok')
}
