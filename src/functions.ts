import { Uri } from "vscode"

// type FunctionType1 = (x: string, y: number) => number;
type unaryFunction = (x: any) => any
type promiseTransformer = (x: Promise<any>) => Promise<any>

export const pick = <T, K extends keyof T>(name: K) => (x: T): T[K] => x[name]
export const flat = <T>(a: Array<Array<T>>): Array<T> =>
  a.reduce((res, current) => [...res, ...current], [])
export const flatMap = <T1, T2>(
  arr: Array<T1>,
  cb: (c: T1, idx?: number, arrref?: Array<T1>) => Array<T2>
) => flat(arr.map(cb))

//return a function that applies all the functions, starting with the rightmost
//compose(a,b)(...args) = a(b(...args))
// gave up type checking to allow a random number of composed functions
export const compose = (...functions: any[]) =>
  functions
    .slice(1)
    .reduce((acc, fn) => (...inargs: any[]) => acc(fn(...inargs)), functions[0])

//return a function that applies all the functions, starting with the leftmost
//pipe(a,b)(...args) = b(a(...args))
// gave up type checking to allow a random number of composed functions
export const pipe = (...functions: any[]) =>
  functions
    .slice(1)
    .reduce((acc, fn) => (...inargs: any[]) => fn(acc(...inargs)), functions[0])

//apply a function to the result of a promise
export const doThen = <T1, T2>(fn: (x: T1) => T2) => (promise: Promise<T1>) =>
  promise.then(fn)

//applies a number of functions (as then) to a promise, returning a promise
// like composePromise but applied in reverse
//
// pipePromise(f1,f2,f3)(promise)
// is the same of promise.then(f1).then(f2).then(f3)
// different from promise.then(pipe(f1,f2,f3))
export const pipePromise = (
  ...functions: Array<unaryFunction>
): promiseTransformer => pipe(...functions.map(doThen))

//applies a number of functions (as then) to a promise, returning a promise
// like pipePromise but applied in reverse
export const composePromise = (
  ...functions: Array<unaryFunction>
): promiseTransformer => compose(...functions.map(doThen))

//returns a function that maps an array yo the given function
// mapWith(f)(array) is the same of array.map(f), but composable
export const mapWidth = (func: any, target?: any[]) => {
  const fn = (x: any[]) => x.map(func)
  return target ? fn(target) : fn
}

//given an array of objects returns a map indexed by a property
// only works if the property is an unique key
export function ArrayToMap(name: string) {
  return (arr: any[]): Map<string, any> => {
    return arr.reduce((map, current: any) => {
      map.set(current[name], current)
      return map
    }, new Map())
  }
}
export const GroupArray = (name: string) => (
  arr: any[]
): Map<string, any[]> => {
  return arr.reduce((map, current: any) => {
    const key = current[name]
    const group = map.get(key) || map.set(key, []).get(key)
    group!.push(current)
    return map
  }, new Map())
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

export const mappedProp = (
  map: Map<string, any>,
  property: string,
  name: string
): any => {
  const fn = (index: string) => {
    const record = map && map.get(index)
    return record && record[property]
  }
  if (name || name === "") return fn(name)
  return fn
}
//if map.get fails, create an entry of the given type, add it and return it
export const mapGetOrSet = (map: Map<any, any>, index: any, constr: any): any =>
  map.get(index) ? map.get(index) : map.set(index, new constr()).get(index)

export const filterComplex = (isComplex: boolean) => (x: Array<any>) =>
  x.filter(element => (typeof element === "string" ? !isComplex : isComplex))

//tries a function, returns its default
export const defaultVal = (def: any, fn: (...args: any[]) => any) => (
  ...args: any[]
) => {
  try {
    return fn(...args)
  } catch (error) {
    return def
  }
}
//
export function followLink(base: Uri, relPath: string): Uri {
  if (!relPath) return base
  let path
  if (relPath.match(/^\//)) path = relPath
  else if (relPath.match(/^\.\//)) {
    path = base.path.replace(/\/([^\/]*)$/, "/") + relPath.replace(/\.\//, "")
  } else {
    const sep = base.path.match(/\/$/) ? "" : "/"
    path = base.path + sep + relPath.replace(/\.\//, "")
  }
  return base.with({ path })
}
