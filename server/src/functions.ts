import { types } from "util"

export const isString = (x: any): x is string => typeof x === "string"
export const isNumber = (x: any): x is number => typeof x === "number"

export const memoize = <P, R>(
  base: (p: P) => Promise<R>
): ((p: P) => Promise<R>) => {
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
export function parts(whole: any, pattern: RegExp): string[] {
  if (!isString(whole)) return []
  const match = whole.match(pattern)
  return match ? match.slice(1) : []
}

export function toInt(raw: any): number {
  if (isNaN(raw)) return 0
  if (isNumber(raw)) return Math.floor(raw)
  if (!raw && !isString(raw)) return 0
  const n = Number.parseInt(raw, 10)
  if (isNaN(n)) return 0
  return n
}

export const hashParms = (uri: string): any => {
  const parms: any = {}
  const hash = uri.split(/#/)[1]
  const uriHashArgs: string[] = (hash && hash.split(/;/)) || []
  for (const arg of uriHashArgs) {
    const argTuple = arg.split(/=/, 2)
    if (argTuple.length > 1)
      parms[argTuple[0]] = decodeURIComponent(argTuple[1])
  }
  return parms
}

export const isAbap = (uri: string) => !!uri.match(/\.abap$/i)
export const isCdsView = (uri: string) => !!uri.match(/\.ddls.asddls$/i)

interface RunningState<T> {
  current: Promise<T>
  next?: () => Promise<T>
}
const doNext = <T>(p: Promise<T>, n: (ok?: T, err?: any) => Promise<T>) =>
  p.then(ok => n(ok)).catch(err => n(undefined, err))
// for calls made too frequently
// when no call is running it runs it
// when it is, it queues the new one, which will run afterwards

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

export const caughtToString = (e: any) => {
  if (types.isNativeError(e)) return e.message
  if (typeof e === "object" && typeof e.toString === "function") return e.toString()
  if (typeof e === "object" && typeof e.message === "string") return e.message
  return `${e}`
}