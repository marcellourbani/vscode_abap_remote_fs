import { parseString, convertableToString } from "xml2js"
import { pipe } from "../functions"

// when the field is an array getfield will return its first line
// use with caution!
export const getField = (name: string) => (subj: any) => {
  if (subj instanceof Array) {
    return subj[0][name]
  } else {
    return subj[name]
  }
}

//{foo:[fooval],bar:[barval]}=>{foo:fooval,bar:barval}
export const recxml2js = (record: any) =>
  Object.keys(record).reduce((acc: any, current: any) => {
    acc[current] = record[current][0]
    return acc
  }, {})

// this is way more complicated that it needs to be
// given a document like <a><b><c>...some stuff</c></b</a> it would simply need to do:
// getnode("a/b/c",document) // ...some stuff
//   can also do getnode("a","b","c",document)
//               getnode("a")("b","c",document)
//   or even     getnode("a","b","c",fn)(document)
export const getNode = (...args: any[]) => {
  const split = (...sargs: any[]) => {
    const functions: Array<(x: any) => any> = []
    let rest: any[] = []
    sargs.some(
      (x: any, idx: number): any => {
        if (typeof x === "string") functions.push(...x.split("/").map(getField))
        else if (typeof x === "function") functions.push(x)
        else return (rest = sargs.slice(idx))
      }
    )
    return [functions, rest]
  }
  const fn = (...fargs: any[]) => {
    const [functions, rest] = split(...fargs)
    if (functions.length === 0) return rest[0]
    const piped = pipe(...functions)
    return rest.length === 0
      ? (...iargs: any[]) => fn(piped, ...iargs)
      : piped(...rest)
  }
  return fn(...args)
}
export const parsetoPromise = <T>(parser: Function) => (
  xml: convertableToString
): Promise<T> =>
  new Promise(resolve => {
    parseString(xml, (err, result) => {
      if (err) throw err
      resolve(parser(result))
    })
  })
