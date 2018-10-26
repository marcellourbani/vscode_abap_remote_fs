import { parseString, convertableToString } from "xml2js"
// a handful of functional utilities, would belong to their own file...
export const compose = (...functions: any[]) =>
  functions
    .slice(1)
    .reduce((acc, fn) => (...inargs: any[]) => acc(fn(...inargs)), functions[0])

export const pipe = (...functions: any[]) =>
  functions
    .slice(1)
    .reduce((acc, fn) => (...inargs: any[]) => fn(acc(...inargs)), functions[0])

export const mapWidth = (func: any, target?: any[]) => {
  const fn = (x: any[]) => x.map(func)
  return target ? fn(target) : fn
}
export const ArrayToMap = (name: string) => (arr: any[]): Map<string, any> => {
  return arr.reduce((map, current: any) => {
    map.set(current[name], current)
    return map
  }, new Map())
}

//xml2js maps <root><record><field>foo</field></record><root> to {root:{field:[foo]}}
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
export const parsetoPromise = (parser: Function) => (
  xml: convertableToString
): Promise<any> =>
  new Promise(resolve => {
    parseString(xml, (err, result) => {
      if (err) throw err
      resolve(parser(result))
    })
  })
export interface ObjectNode {
  OBJECT_TYPE: string
  OBJECT_NAME: string
  TECH_NAME: string
  OBJECT_URI: string
  OBJECT_VIT_URI: string
  EXPANDABLE: string
}

export interface CategoryNode {
  CATEGORY: string
  CATEGORY_LABEL: string
}

export interface ObjectTypeNode {
  OBJECT_TYPE: string
  CATEGORY_TAG: string
  OBJECT_TYPE_LABEL: string
  NODE_ID: string
}
export interface NodeStructure {
  nodes: ObjectNode[]
  categories: Map<string, CategoryNode>
  objectTypes: Map<string, ObjectTypeNode>
}
const filterComplex = (isComplex: boolean) => (x: []) =>
  x.filter(element => (typeof element === "string" ? !isComplex : isComplex))
const defaultVal = (def: any, fn: (...args: any[]) => any) => (
  ...args: any[]
) => {
  try {
    return fn(...args)
  } catch (error) {
    return def
  }
}
const treecontentParser = defaultVal(
  [],
  getNode(
    "asx:abap/asx:values/DATA/TREE_CONTENT/SEU_ADT_REPOSITORY_OBJ_NODE",
    filterComplex(true),
    mapWidth(recxml2js)
  )
)
const categoryNodeParser = defaultVal(
  new Map(),
  getNode(
    "asx:abap/asx:values/DATA/CATEGORIES",
    filterComplex(true),
    "SEU_ADT_OBJECT_CATEGORY_INFO",
    mapWidth(recxml2js),
    ArrayToMap("CATEGORY")
  )
)

const ObjectTypeParser = defaultVal(
  new Map(),
  getNode(
    "asx:abap/asx:values/DATA/OBJECT_TYPES",
    filterComplex(true),
    "SEU_ADT_OBJECT_TYPE_INFO",
    mapWidth(recxml2js),
    ArrayToMap("OBJECT_TYPE")
  )
)
export const getNodeStructureTreeContent = parsetoPromise(
  treecontentParser
) as (x: string) => Promise<ObjectNode[]>

export const getNodeStructure = parsetoPromise((payload: any) => {
  const structure: NodeStructure = {
    nodes: treecontentParser(payload),
    categories: categoryNodeParser(payload),
    objectTypes: ObjectTypeParser(payload)
  }
  return structure
}) as (x: string) => Promise<NodeStructure>
