/* cSpell:disable */
import { parseString, convertableToString } from "xml2js"
import { pipe, pick, removeNameSpace, mapWith } from "../../functions"
import { isArray } from "util"

/**
 * Returns a function to select the contents of a simple field
 * when the object is an array the function will look for the field in its first line
 *
 * @param name name of the field
 *
 */
export const getField = (name: string) => (subj: any) => {
  if (subj instanceof Array) {
    return subj[0][name]
  } else {
    return subj[name]
  }
}
/**
 * returns the attributes of a field
 *
 * It's curried:if node is omitted returns a function
 *
 * if the xml looked like <foo bar="barval" baz=bazval />
 * getFieldAttributes("foo", parent) or getFieldAttributes("foo")(parent)
 * will return {bar:"barval",baz:"bazval"}
 */
export const getFieldAttributes = (
  fieldname?: string,
  node?: any
): any | ((x: any) => any) => {
  function getAttributes(o: any): any {
    let base = o
    if (o && fieldname) base = getField(fieldname)(o)

    return base && (base["$"] || base[0]["$"])
  }
  if (node) return getAttributes(node)
  return getAttributes
}
/**
 * returns an attribute of a given node
 *
 * It's curried: if node is omitted returns a function
 *
 * if the xml looked like <foo bar="barval" baz=bazval />
 * getFieldAttribute("foo","bar", parent) or getFieldAttributes("foo","bar")(parent)
 * will return "barval"
 * returns an empty string if there isn't one
 */
export function getFieldAttribute(
  fieldname: string,
  attrname: string,
  node: any
): string
export function getFieldAttribute(
  fieldname: string,
  attrname: string
): (x: any) => string
export function getFieldAttribute(
  fieldname: string,
  attrname: string,
  node?: any
): string | ((x: any) => string) {
  const getter = getFieldAttributes(fieldname)
  function getValue(o: any): string {
    const attrs = getter(o)
    return (attrs && attrs[attrname]) || ""
  }
  if (node) return getValue(node)
  return getValue
}
/**
 * @param record extracts XML field values. <field>value</field> becomes {field:value} rather than {field:[value]}
 * {foo:[fooval],bar:[barval]}=>{foo:fooval,bar:barval}
 */
export const recxml2js = (record: any) =>
  Object.keys(record).reduce((acc: any, current: any) => {
    acc[current] = record[current][0]
    if (acc[current] && acc[current]._) acc[current] = acc[current]._
    return acc
  }, {})

/** Navigates a parsed XML tree
 * WAY more complicated than it needs to be, but I was having fun with currying
 *  given a document like <a><b><c>...some stuff</c></b</a> it would simply need to do:
 *  getnode("a/b/c",document) // ...some stuff
 *    can also do getnode("a","b","c",document)
 *                getnode("a")("b","c",document)
 *    or even     getnode("a/b","c",fn)(document)
 *
 * @param args a list of strings or functions, the last one could be an object
 *  string argument will be split at / and every part will be converted to a function getField
 *  the list of functions obtained will then be piped
 *  finally if the last argument is an object, the final function will be called upon it
 *  otherwise it returns a curried version of the piped function which:
 *    passed other functions or strings will return a function which pipes them too
 *    passed an object will apply the piped function to it
 */
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
export const parseToPromise = <T>(parser?: (raw: any) => T) => (
  xml: convertableToString
): Promise<T> =>
  new Promise(resolve => {
    parseString(xml, (err, result) => {
      if (err) throw err
      resolve(parser ? parser(result) : result)
    })
  })
/**
 * Given a parsed XML node, returns an object with its attributes stripped of namespaces
 * Given an array of parsed XML nodes, does the same with all entries
 *
 * @param node An XML node (or array of nodes) parsed as javascript object
 */
export function nodeProperties(node: any | any[]): any {
  const single = pipe(
    pick("$"),
    removeNameSpace
  )
  if (isArray(node)) return mapWith(single, node)
  return single(node)
}
