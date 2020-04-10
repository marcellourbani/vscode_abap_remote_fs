import { none, isSome, isNone, Option } from "fp-ts/lib/Option"
import { taskEither, TaskEither } from "fp-ts/lib/TaskEither"
import { right, left } from "fp-ts/lib/Either"

export const isString = (x: any) => typeof x === "string"
export const isNumber = (x: any) => typeof x === "number"
export const pick = <T, K extends keyof T>(name: K) => (x: T): T[K] => x[name]
export const flat = <T>(a: T[][]): T[] =>
  a.reduce((res, current) => [...res, ...current], [])

export const flatMap = <T1, T2>(
  arr: T1[],
  cb: (c: T1, idx?: number, arrref?: T1[]) => T2[]
) => flat(arr.map(cb))
// given an array of objects returns a map indexed by a property
// only works if the property is an unique key
export function ArrayToMap<T>(name: keyof T) {
  return (arr: T[]): Map<string, T> => {
    return arr.reduce((map, current: T) => {
      map.set(current[name], current)
      return map
    }, new Map())
  }
}

// returns a function that gets the given property from a map
export const selectMap = <T1, K extends keyof T1, T2>(
  map: Map<string, T1>,
  property: K,
  defval: T2
): ((index: string) => T2) => (index: string): T2 => {
  const record = map && map.get(index)
  return ((record && record[property]) || defval) as T2
}

// tslint:disable-next-line: ban-types
export const isFn = (f: any): f is Function => {
  return typeof f === "function"
}

export const isStr = (f: any): f is string => {
  return typeof f === "string"
}

export const mapGet = <T1, T2>(
  map: Map<T1, T2>,
  key: T1,
  init: (() => T2) | T2
): T2 => {
  let result = map.get(key)
  if (!result) {
    result = isFn(init) ? init() : init
    map.set(key, result)
  }

  return result
}

export const stringOrder = (s1: any, s2: any) => {
  if (s1 > s2) return 1
  return s2 > s1 ? -1 : 0
}

export const fieldOrder = <T>(fieldName: keyof T, inverse: boolean = false) => (
  a1: T,
  a2: T
) => stringOrder(a1[fieldName], a2[fieldName]) * (inverse ? -1 : 1)

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
export const isUnDefined = (x: any): x is undefined => typeof x === "undefined"
export const eatPromiseException = async <T>(p: Promise<T>) => {
  try {
    return await p
  } catch (error) {
    // ignore
  }
}
export const eatException = (cb: (...args: any[]) => any) => (
  ...args: any[]
) => {
  try {
    return cb(...args)
  } catch (e) {
    return
  }
}
// synchronous. awaiting would defeat the purpose
export const createMutex = () => {
  const m: Map<string, Promise<any>> = new Map()
  return (key: string, cb: any) => {
    const prom = (m.get(key) || Promise.resolve()).then(cb)
    m.set(key, eatPromiseException(prom))
    return prom
  }
}
export interface Cache<TK, TP> extends Iterable<TP> {
  get: (x: TK) => TP
  size: number
}
/**
 * Given a constructor function returns an enumerable cache of objects
 * Optionally accepts a key conversion method as second parameter
 * Automates the pattern of returning an object from a map, or create and insert it if not found
 *
 * @param  {(k:TMAPKEY)=>TRESULT} creator
 * @param  {(k:TGETKEY)=>TMAPKEY=(x:any} KeyTranslator (optional)
 */
export function cache<TGETKEY, TRESULT, TMAPKEY>(
  creator: (k: TGETKEY) => TRESULT,
  keyTranslator: (k: TGETKEY) => TMAPKEY = (x: any) => x
): Cache<TGETKEY, TRESULT> {
  const values = new Map<TMAPKEY, TRESULT>()
  return {
    get: (key: TGETKEY) => {
      const mapKey = keyTranslator(key)
      let cur = values.get(mapKey)
      if (!cur) {
        cur = creator(key)
        values.set(mapKey, cur)
      }
      return cur
    },
    get size() {
      return values.size
    },
    *[Symbol.iterator]() {
      const v = values.values()
      let r = v.next()
      while (!r.done) {
        yield r.value
        r = v.next()
      }
    }
  }
}

export interface AsyncCache<TK, TP> extends Iterable<TP> {
  get: (x: TK, refresh?: boolean) => Promise<TP>
  getSync: (x: TK) => TP | undefined
  size: number
}

export const asyncCache = <TK, TP, TAK>(
  creator: (k: TK) => Promise<TP>,
  keyTran: (k: TK) => TAK = (x: any) => x
): AsyncCache<TK, TP> => {
  const values = new Map<TAK, TP>()
  const pending = new Map<TAK, Promise<TP>>()
  const attempt = async (mapKey: TAK, key: TK, refresh: boolean) => {
    let cur = values.get(mapKey)
    if (refresh || !cur) {
      cur = await creator(key)
      values.set(mapKey, cur)
    }
    return cur
  }

  function get(key: TK, refresh = false) {
    const mapKey = keyTran(key)
    let curP = pending.get(mapKey)
    if (!curP) {
      curP = attempt(mapKey, key, refresh)
      pending.set(mapKey, curP)
      eatPromiseException(curP).then(() => pending.delete(mapKey))
    }
    return curP
  }
  return {
    get,
    getSync: (k: TK) => values.get(keyTran(k)),
    get size() {
      return values.size
    },
    *[Symbol.iterator]() {
      const v = values.values()
      let r = v.next()
      while (!r.done) {
        yield r.value
        r = v.next()
      }
    }
  }
}

export const promiseQueue = <T>(initial: T) => {
  let current = Promise.resolve(initial)
  let last = initial

  return (cb?: (c: T) => Promise<T>, onErr?: (e: Error) => void) => {
    // must guarantee current will always resolve!
    if (cb)
      current = current.then(async cur => {
        try {
          const newres = await cb(cur)
          last = newres
          return newres
        } catch (e) {
          if (onErr) eatException(onErr)(e)
          return last
        }
      })
    return current
  }
}

export const rememberFor = <T, K>(
  ms: number,
  f: (x: K) => T
): ((x: K) => T) => {
  const storage = new Map<K, { value: T; time: number }>()
  return (k: K) => {
    const time = new Date().getTime()
    let last = storage.get(k)
    if (!last || time - last.time > ms) {
      last = { time, value: f(k) }
      storage.set(k, last)
    }
    return last.value
  }
}

export const debounce = <K, R>(frequency: number, cb: (x: K) => R) => {
  const calls = new Map<K, Promise<R>>()
  return (key: K) => {
    const p =
      calls.get(key) ||
      new Promise(resolve => {
        setTimeout(() => {
          calls.delete(key)
          resolve(cb(key))
        }, frequency)
      })
    calls.set(key, p)
    return p
  }
}

export const after = (time: number) =>
  new Promise(resolve => setTimeout(resolve, time))

type leftType = Error | typeof none
const isOption = <T>(x: any): x is Option<T> => isSome(x) || isNone(x)

type TaskTransformer<T> = (x: T) => TaskEither<leftType, T>
export const createTaskTransformer = <T>(
  f: (y: T) => T | Option<T> | Promise<T | Option<T>>
) => (x: T): TaskEither<leftType, T> => () => {
  const toProm = async () => f(x)
  return toProm()
    .then((r: T | Option<T>) => {
      if (isOption(r)) return isNone(r) ? left(r) : right(r.value)
      else return right(r)
    })
    .catch(left)
}

export const chainTaskTransformers = <T>(
  first: TaskTransformer<T>,
  ...rest: TaskTransformer<T>[]
) => (y: T) => rest.reduce(taskEither.chain, first(y))

const c = <T>(x: T): TaskEither<leftType, T> => async () => right(x)
const d = <T>(f: (x: T) => T) => (z: T): TaskEither<leftType, T> => async () =>
  right(f(z))
export function fieldReplacer<T1>(
  field: keyof T1,
  inputTask: TaskEither<leftType, T1[keyof T1]>,
  shouldReplace?: (x: T1) => boolean
): <T2 extends T1>(x: T2) => TaskEither<leftType, T2>
export function fieldReplacer<T1, T2 extends T1>(
  field: keyof T1,
  inputTask: TaskEither<leftType, T1[keyof T1]>,
  shouldReplace: (x: T1) => boolean,
  data: T2
): TaskEither<leftType, T2>
export function fieldReplacer<T1, T2 extends T1>(
  field: keyof T1,
  inputTask: TaskEither<leftType, T1[keyof T1]>,
  data: T2
): TaskEither<leftType, T2>
export function fieldReplacer<T1, T2 extends string, T3 extends Record<T2, T1>>(
  field: T2,
  inputTask: TaskEither<leftType, T1>,
  data?: T3 | ((x: T3) => boolean),
  data2?: T3
) {
  const createTask = (prev: T3): TaskEither<leftType, T3> => {
    if (isFn(data) && !data(prev)) return async () => right(prev)
    return taskEither.chain(inputTask, iop => async () => {
      return right({ ...prev, [field]: iop })
    })
  }

  const actualData = isFn(data) ? data2 : data
  return actualData ? createTask(actualData) : createTask
}

export function dependFieldReplacer<T1>(
  field: keyof T1,
  input: (data: T1, field: keyof T1) => TaskEither<leftType, T1[keyof T1]>,
  shouldReplace?: (x: T1) => boolean
): <T2 extends T1>(x: T2) => TaskEither<leftType, T2>
export function dependFieldReplacer<
  T1,
  T2 extends string,
  T3 extends Record<T2, T1>
>(
  field: T2,
  input: (data: T3, field: T2) => TaskEither<leftType, T1[keyof T1]>,
  shouldReplace: (x: T3) => boolean,
  data: T3
): TaskEither<leftType, T3>
export function dependFieldReplacer<
  T1,
  T2 extends string,
  T3 extends Record<T2, T1>
>(
  field: T2,
  input: (data: T3, field: T2) => TaskEither<leftType, T1[keyof T1]>,
  data: T3
): TaskEither<leftType, T3>
export function dependFieldReplacer<
  T1,
  T2 extends string,
  T3 extends Record<T2, T1>
>(
  field: T2,
  input: (data: T3, field: T2) => TaskEither<leftType, T1[keyof T1]>,
  data?: T3 | ((x: T3) => boolean),
  data2?: T3
) {
  const createTask = (prev: T3): TaskEither<leftType, T3> => {
    return taskEither.chain(input(prev, field), iop => async () => {
      if (isFn(data) && !data(prev)) return right(prev)
      return right({ ...prev, [field]: iop })
    })
  }

  const actualData = isFn(data) ? data2 : data
  return actualData ? createTask(actualData) : createTask
}

export const btoa = (s: string) => Buffer.from(s).toString("base64")
export const atob = (s: string) => Buffer.from(s, "base64").toString()
export const NSSLASH = "\u2215" // used to be hardcoded as "／", aka "\uFF0F"
export const convertSlash = (x: string) => x && x.replace(/\//g, NSSLASH)
export const asyncFilter = async <T>(
  x: Iterable<T>,
  filter: (x: T) => any
): Promise<T[]> => {
  const res: T[] = []
  for (const i of x) if (await filter(i)) res.push(i)
  return res
}

interface AdtUriPartsInternal {
  path: string
  type?: string
  name?: string
  start?: { line: number; character: number }
  end?: { line: number; character: number }
}

const splitPos = (pos: string) => {
  const [line = "0", char = "0"] = pos?.split(",")
  return { line: toInt(line), character: toInt(char) }
}

export const splitAdtUriInternal = <
  T extends { path: string; query?: string; fragment?: string }
>(
  uri: T
) => {
  const path = uri.path
  const uriParts: AdtUriPartsInternal = { path }
  if (uri.query) {
    for (const part of uri.query.split("&")) {
      const [name, value] = part.split("=")
      if (name === "start" || name === "end") uriParts[name] = splitPos(value)
    }
  }
  if (uri.fragment) {
    for (const part of uri.fragment.split(";")) {
      const [name, value] = part.split("=")
      if (name === "name" || name === "type") uriParts[name] = value
      if (name === "start" || name === "end") uriParts[name] = splitPos(value)
    }
  }
  return uriParts
}
