import { types } from "util"

/**
 * Narrow a value to the string type when the runtime check passes.
 */
export const isString = (x: any): x is string => typeof x === "string"

/**
 * Narrow a value to the number type when the runtime check passes.
 */
export const isNumber = (x: any): x is number => typeof x === "number"

/**
 * Cache the result of an async function for the lifetime of the wrapper.
 */
export const memoize = <P, R>(base: (p: P) => Promise<R>): ((p: P) => Promise<R>) => {
  const cache: Map<P, R> = new Map()
  return async (param: P) => {
    let result = cache.get(param)
    if (!result) {
      result = await base(param)
      cache.set(param, result)
    }
    return result
  }
}

/**
 * Extract capture groups from a string using the provided regular expression.
 */
export function parts(whole: any, pattern: RegExp): string[] {
  if (!isString(whole)) return []
  const match = whole.match(pattern)
  return match ? match.slice(1) : []
}

/**
 * Convert a value to an integer while tolerating empty or non-numeric input.
 */
export function toInt(raw: any): number {
  if (isNaN(raw)) return 0
  if (isNumber(raw)) return Math.floor(raw)
  if (!raw && !isString(raw)) return 0
  const n = Number.parseInt(raw, 10)
  if (isNaN(n)) return 0
  return n
}

/**
 * Parse the query-string style fragment from an ADT URI into a plain object.
 */
export const hashParms = (uri: string): any => {
  const parms: any = {}
  const hash = uri.split(/#/)[1]
  const uriHashArgs: string[] = (hash && hash.split(/;/)) || []
  for (const arg of uriHashArgs) {
    const argTuple = arg.split(/=/, 2)
    if (argTuple.length > 1) parms[argTuple[0]] = decodeURIComponent(argTuple[1])
  }
  return parms
}

/**
 * Return true for ABAP source files that use the .abap extension.
 */
export const isAbap = (uri: string) => !!uri.match(/\.abap$/i)

/**
 * Return true for CDS DDLS source files.
 */
export const isCdsView = (uri: string) => !!uri.match(/\.ddls.asddls$/i)

/**
 * Return true for CDS-like source file extensions handled by the language server.
 */
export const isCdsLike = (uri: string) =>
  !!uri.match(/\.(ddls\.asddls|dcls\.asdcls|ddlx\.asddlxs|bdef\.asbdef|srvd\.srvdsrv)$/i)

/**
 * Return true for ABAP or CDS-based resources that should be processed by the server.
 */
export const isAbapOrCds = (uri: string) => isAbap(uri) || isCdsLike(uri)

interface RunningState<T> {
  current: Promise<T>
  next?: () => Promise<T>
}
const doNext = <T>(p: Promise<T>, n: (ok?: T, err?: any) => Promise<T>) =>
  p.then(ok => n(ok)).catch(err => n(undefined, err))
// Repeated requests share a single in-flight call and queue the next one until the current run finishes.

/**
 * Limit concurrent calls for the same key by reusing the in-flight request or queueing the next attempt.
 */
export const callThrottler = <T>() => {
  const runStates = new Map<string, RunningState<T>>()

  return (key: string, call: () => Promise<T>) => {
    const state = runStates.get(key) || { current: call() }
    const isNew = !runStates.has(key)
    if (!isNew) runStates.set(key, state)
    const current = state.current

    function resume(ok: T): T
    function resume(err: any): any
    function resume(ok?: T, err?: any) {
      if (state.next) {
        const nextval = state.next()
        state.current = doNext(nextval, resume)
        state.next = undefined
        return nextval
      } else runStates.delete(key)
      if (err) throw err
      return ok
    }

    if (isNew) {
      state.current = doNext(state.current, resume)
      runStates.set(key, state)
    } else {
      state.next = call
      return state.current
    }

    return current
  }
}

/**
 * Convert an unknown value into a stable string for logging and diagnostics.
 */
export const caughtToString = (e: any) => {
  if (types.isNativeError(e)) return e.message
  if (typeof e === "object" && typeof e.toString === "function") return e.toString()
  if (typeof e === "object" && typeof e.message === "string") return e.message
  return `${e}`
}
