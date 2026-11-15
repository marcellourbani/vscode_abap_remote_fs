import type { InactiveObjectElement } from "abap-adt-api"

/**
 * SAP can store a changed method include as inactive without listing it in the inactive objects
 * (DWINACTIV), for example after alternating SE24 and ADT edits (#641, #670). Activating the class
 * then succeeds but skips the method, so the old code keeps running while the class source shows
 * the new one. These helpers find such methods by comparing the active and inactive class source.
 */

const METHOD_START = /^\s*METHOD\s+([^\s.]+)\s*\./i
const METHOD_END = /^\s*ENDMETHOD\s*\./i
const LISTED_METHOD = /[#;]name=([^;&#]+)/i

const normalizeLine = (line: string) => line.trim().replace(/\s+/g, " ")

/** Method implementations of a class source, keyed by upper case method name */
export const methodBodies = (source: string) => {
  const bodies = new Map<string, string>()
  let name: string | undefined
  let lines: string[] = []
  for (const line of source.split(/\r?\n/)) {
    if (!name) {
      name = METHOD_START.exec(line)?.[1].toUpperCase()
      lines = []
      continue
    }
    if (!METHOD_END.test(line)) {
      lines.push(normalizeLine(line))
      continue
    }
    bodies.set(name, lines.filter(Boolean).join("\n"))
    name = undefined
  }
  return bodies
}

/** Methods whose inactive implementation differs from the active one, new methods included */
export const changedMethods = (active: string, inactive: string) => {
  const activeBodies = methodBodies(active)
  return [...methodBodies(inactive)]
    .filter(([name, body]) => activeBodies.get(name) !== body)
    .map(([name]) => name)
}

const decode = (text: string) => {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

const listedMethodName = (object: InactiveObjectElement, classUri: string) => {
  const uri = object["adtcore:uri"]
  if (!object["adtcore:type"].startsWith("CLAS/OM")) return
  if (!uri.toLowerCase().startsWith(`${classUri.toLowerCase()}/`)) return
  const name = LISTED_METHOD.exec(uri)?.[1]
  return name && decode(name).toUpperCase()
}

/** Methods of the class in the inactive objects list, upper case */
export const listedMethods = (inactiveObjects: InactiveObjectElement[], classUri: string) =>
  inactiveObjects.flatMap(object => listedMethodName(object, classUri) || [])

/** Changed methods of the class that are missing from the inactive objects list */
export const unlistedMethods = (
  active: string,
  inactive: string,
  inactiveObjects: InactiveObjectElement[],
  classUri: string
) => {
  const listed = new Set(listedMethods(inactiveObjects, classUri))
  return changedMethods(active, inactive).filter(name => !listed.has(name))
}

export const RELIST_MARKER = `" ABAP FS: temporary line, makes SAP list the method as inactive`

/**
 * Adds a comment line to the given methods: SAP only lists a method include it rewrites,
 * and it skips the ones whose source did not change
 */
export const markMethods = (source: string, methods: string[]) => {
  const names = new Set(methods)
  let current: string | undefined
  return source
    .split(/(?<=\n)/)
    .flatMap(line => {
      current = METHOD_START.exec(line)?.[1].toUpperCase() || current
      if (!METHOD_END.test(line) || !current) return [line]
      const marked = names.has(current)
      current = undefined
      return marked ? [`${RELIST_MARKER}\n`, line] : [line]
    })
    .join("")
}

const them = (methods: string[]) => (methods.length === 1 ? "it" : "them")

export const unlistedMethodsSummary = (className: string, methods: string[]) =>
  `SAP saved changes to ${methods.join(", ")} of ${className} without listing ${them(methods)} as inactive, so activating would keep the old code running. Activate from the main source of ${className} to let ABAP FS fix it.`

export const notRelistedSummary = (className: string, methods: string[]) =>
  `SAP saved changes to ${methods.join(", ")} of ${className} without listing ${them(methods)} as inactive, and saving again did not list ${them(methods)}, so the old code may still be running. Change and save ${methods.length === 1 ? "that method" : "those methods"}, then activate.`
