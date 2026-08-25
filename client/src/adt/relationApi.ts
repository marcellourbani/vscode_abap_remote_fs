import { XMLParser } from "fast-xml-parser"
import { getClient } from "./conections"

const NETWORK_PATH = "/sap/bc/adt/objectrelations/network"
const COMPONENTS_PATH = "/sap/bc/adt/objectrelations/components"
const REFERENCES_PATH = "/sap/bc/adt/objectrelations/references"
const RELATIONS_PATH = "/sap/bc/adt/objectrelations"
const NETWORK_REQUEST_TYPE = "application/vnd.sap.adt.objectrelations.request.v1+xml"
const NETWORK_RESPONSE_TYPE = "application/vnd.sap.adt.objectrelations.response.network.v1+xml"
const COMPONENTS_RESPONSE_TYPE =
  "application/vnd.sap.adt.objectrelations.response.components.v2+xml"
const REFERENCES_REQUEST_TYPE = "application/vnd.sap.adt.objectrelations.request.references.v1+xml"
const REFERENCES_RESPONSE_TYPE =
  "application/vnd.sap.adt.objectrelations.response.references.v1+xml"
const RELATIONS_REQUEST_TYPE = "application/vnd.sap.adt.objectrelations.request.sets.v1+xml"
const RELATIONS_RESPONSE_TYPE = "application/vnd.sap.adt.objectrelations.request.relations.v1+xml"
const ORO_NS = "http://www.sap.com/adt/objectrelations"
const ORO_REF_NS = "http://www.sap.com/adt/objectrelations/references"
const REL_NS = "http://www.sap.com/adt/objectrelations/relations"
const ADTCORE_NS = "http://www.sap.com/adt/core"
const OSL_NS = "http://www.sap.com/api/osl"
const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"

type AnyRecord = Record<string, any>

export interface RelationObject {
  id: string
  name: string
  type: string
  uri: string
  parentUri?: string
  displayName: string
  description?: string
  version?: string
  exists?: boolean
  canHaveComponents?: boolean
  properties: RelationProperty[]
  links: RelationLink[]
}

export interface RelationProperty {
  name: string
  value: string
}

export interface RelationLink {
  href: string
  rel: string
  type?: string
  title?: string
}

export interface RelationEdge {
  id: string
  from: string
  to: string
  type: string
  state?: string
  direction?: string
  roleFrom?: string
  roleTo?: string
  properties: RelationProperty[]
}

export interface RelationContext {
  id: string
  description: string
  supportsComponents: boolean
  supportsGrouping: boolean
  supportsReferences: boolean
  isDefault: boolean
  relevance: number
}

export interface RelationNetwork {
  activeContext: string
  contexts: RelationContext[]
  objects: RelationObject[]
  relations: RelationEdge[]
}

export interface RelationComponent extends RelationObject {
  parentId?: string
}

export interface RelationAnchor {
  uri: string
  program?: string
  include?: string
  matches?: string
  snippet?: string
}

export interface RelationReferences {
  numberOfResults: number
  from?: RelationObject
  to?: RelationObject
  anchors: RelationAnchor[]
}

export interface RelationSetResult {
  leftTitle?: string
  rightTitle?: string
  header?: string
  relations: RelationEdge[]
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false
})

const asArray = <T>(value: T | T[] | undefined | null): T[] =>
  value == null ? [] : Array.isArray(value) ? value : [value]

const text = (value: any): string => {
  if (value == null) return ""
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return String(value)
  if (typeof value === "object") return text(value["#text"] ?? value.text ?? value.value)
  return ""
}

const attrs = (value: AnyRecord): AnyRecord => value?.["@_"] || value

const attribute = (value: AnyRecord | undefined, ...names: string[]): string => {
  if (!value) return ""
  for (const name of names) {
    const local = name.replace(/^.*:/, "")
    const found = [name, `@${name}`, local, `@${local}`].find(candidate => value[candidate] != null)
    if (found) return text(value[found]).trim()
  }
  return ""
}

const bool = (value: string): boolean | undefined => {
  if (!value) return undefined
  return value === "true" || value === "1" || value === "X"
}

const numeric = (value: string): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const parseProperties = (parent: AnyRecord): RelationProperty[] =>
  asArray(parent?.property).map(property => ({
    name: text(property?.name).trim(),
    value: text(property?.value).trim()
  }))

const parseLinks = (parent: AnyRecord): RelationLink[] =>
  asArray(parent?.link).map(link => ({
    href: attribute(attrs(link), "href"),
    rel: attribute(attrs(link), "rel"),
    type: attribute(attrs(link), "type") || undefined,
    title: attribute(attrs(link), "title") || undefined
  }))

const parseObject = (value: AnyRecord, index: number, component = false): RelationObject => {
  const data = attrs(value)
  const uri = attribute(data, "adtcore:uri", "uri")
  const name = attribute(data, "adtcore:name", "name") || text(value?.name).trim()
  const type = attribute(data, "adtcore:type", "type")
  const displayName = attribute(data, "oro:displayName", "displayName") || name
  const result: RelationObject = {
    id: uri || `${type}:${name}:${index}`,
    name,
    type,
    uri,
    parentUri: attribute(data, "adtcore:parentUri", "parentUri") || undefined,
    displayName,
    description: attribute(data, "adtcore:description", "description") || undefined,
    version: attribute(data, "oro:version", "version") || undefined,
    exists: bool(attribute(data, "oro:exists", "exists")),
    canHaveComponents: bool(attribute(data, "oro:canHaveComponents", "canHaveComponents")),
    properties: parseProperties(value),
    links: parseLinks(value)
  }
  if (component) result.id = attribute(data, "oro:id", "id") || result.id
  return result
}

const objectKey = (value: string, objects: RelationObject[]): string => {
  const normalized = value.trim()
  return (
    objects.find(
      object =>
        object.id === normalized || object.name === normalized || object.displayName === normalized
    )?.id || normalized
  )
}

const parseNetwork = (body: string): RelationNetwork => {
  const parsed = parser.parse(body)
  const root = parsed?.networkResponse || {}
  const objects = asArray(root.objectReference).map((item, index) => parseObject(item, index))
  const relations = asArray(root.relation).map((relation, index) => {
    const data = attrs(relation)
    const from = objectKey(text(relation.object1), objects)
    const to = objectKey(text(relation.object2), objects)
    return {
      id: `${from}->${to}:${index}`,
      from,
      to,
      type: attribute(data, "oro:relationType", "relationType") || "relation",
      state: attribute(data, "oro:state", "state") || undefined,
      roleFrom: attribute(attrs(relation.role1), "oro:singular", "singular") || undefined,
      roleTo: attribute(attrs(relation.role2), "oro:singular", "singular") || undefined,
      properties: parseProperties(relation)
    }
  })
  const contexts = asArray(root.context).map(context => {
    const data = attrs(context)
    return {
      id: attribute(data, "oro:id", "id"),
      description: attribute(data, "oro:displayName", "displayName") || "Unnamed context",
      supportsComponents:
        bool(attribute(data, "oro:supportsComponents", "supportsComponents")) ?? false,
      supportsGrouping: bool(attribute(data, "oro:supportsGrouping", "supportsGrouping")) ?? false,
      supportsReferences:
        bool(attribute(data, "oro:supportsReferences", "supportsReferences")) ?? false,
      isDefault: bool(attribute(data, "oro:isDefault", "isDefault")) ?? false,
      relevance: numeric(attribute(data, "oro:relevance", "relevance"))
    }
  })
  return { activeContext: text(root.activeContext).trim(), contexts, objects, relations }
}

const parseComponents = (body: string): RelationComponent[] => {
  const parsed = parser.parse(body)
  const root = parsed?.componentsResponse || {}
  return asArray(root.component).map((item, index) => ({
    ...parseObject(item, index, true),
    parentId: attribute(attrs(item), "oro:parent", "parent") || undefined
  }))
}

const parseReferences = (body: string): RelationReferences => {
  const parsed = parser.parse(body)
  const root = parsed?.result || {}
  const relation = asArray(root.reference)[0]
  if (!relation)
    return { numberOfResults: numeric(attribute(attrs(root), "numberOfResults")), anchors: [] }
  return {
    numberOfResults: numeric(attribute(attrs(root), "numberOfResults")),
    from: parseObject(relation.from, 0),
    to: parseObject(relation.to, 0),
    anchors: asArray(relation.anchor).map(anchor => {
      const data = attrs(anchor)
      return {
        uri: attribute(data, "uri"),
        program: attribute(data, "program") || undefined,
        include: attribute(data, "include") || undefined,
        matches: attribute(data, "matches") || undefined,
        snippet: attribute(data, "snippet") || undefined
      }
    })
  }
}

const parseRelationSet = (body: string): RelationSetResult => {
  const parsed = parser.parse(body)
  const root = parsed?.RelationSetResult || {}
  return {
    leftTitle: attribute(attrs(root), "leftTitle") || undefined,
    rightTitle: attribute(attrs(root), "rightTitle") || undefined,
    header: attribute(attrs(root), "header") || undefined,
    relations: asArray(root.relation).map((item, index) => {
      const left = parseObject(item.left, index)
      const right = parseObject(item.right, index)
      return {
        id: `${left.id}->${right.id}:${index}`,
        from: left.id,
        to: right.id,
        type: "set relation",
        direction: attribute(attrs(item.direction), "direction") || text(item.direction).trim(),
        properties: []
      }
    })
  }
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;")

const referenceAttributes = (object: RelationObject): string =>
  [
    ["adtcore:uri", object.uri],
    ["adtcore:type", object.type],
    ["adtcore:name", object.name],
    ["adtcore:parentUri", object.parentUri]
  ]
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=\"${escapeXml(String(value).trim())}\"`)
    .join(" ")

const networkBody = (
  object: RelationObject,
  preferredContext: string,
  desiredContexts: string[]
) => {
  const preferred = preferredContext
    ? `<oro:preferredContext>${escapeXml(preferredContext)}</oro:preferredContext>`
    : ""
  const desired = desiredContexts.length
    ? `<oro:desiredContexts>${desiredContexts.map(id => `<oro:contextId>${escapeXml(id)}</oro:contextId>`).join("")}</oro:desiredContexts>`
    : ""
  return `<?xml version=\"1.0\" encoding=\"UTF-8\"?><oro:request xmlns:oro=\"${ORO_NS}\" xmlns:adtcore=\"${ADTCORE_NS}\"><oro:reference ${referenceAttributes(object)} />${preferred}${desired}</oro:request>`
}

const referencesBody = (from: RelationObject, to: RelationObject, context: string) =>
  `<?xml version=\"1.0\" encoding=\"UTF-8\"?><oroRef:refRelation xmlns:oroRef=\"${ORO_REF_NS}\" xmlns:adtcore=\"${ADTCORE_NS}\" context=\"${escapeXml(context)}\"><oroRef:from ${referenceAttributes(from)} /><oroRef:to ${referenceAttributes(to)} /></oroRef:refRelation>`

const transportType = (type: string): string => type.split("/", 1)[0]
const flatSet = (object: RelationObject): string =>
  `<osl:objectSet xmlns:osl=\"${OSL_NS}\" xmlns:xsi=\"${XSI_NS}\" xsi:type=\"flatObjectSet\"><osl:object name=\"${escapeXml(object.name.trim())}\" type=\"${escapeXml(transportType(object.type))}\" /></osl:objectSet>`
const relationSetBody = (left: RelationObject, right: RelationObject) =>
  `<?xml version=\"1.0\" encoding=\"UTF-8\"?><rel:RelationSetRequest xmlns:rel=\"${REL_NS}\"><rel:left>${flatSet(left)}</rel:left><rel:right>${flatSet(right)}</rel:right></rel:RelationSetRequest>`

export class AdtRelationApi {
  constructor(private readonly connectionId: string) {}

  private async post(path: string, body: string, contentType: string, accept: string) {
    const response = await getClient(this.connectionId.toLowerCase()).httpClient.request(path, {
      method: "POST",
      headers: { "Content-Type": contentType, Accept: accept },
      body
    })
    return response.body as string
  }

  async network(object: RelationObject, context = "ENV", desiredContexts = ["ENV", "WUL"]) {
    return parseNetwork(
      await this.post(
        NETWORK_PATH,
        networkBody(object, context, desiredContexts),
        NETWORK_REQUEST_TYPE,
        NETWORK_RESPONSE_TYPE
      )
    )
  }

  async components(object: RelationObject, context = "ENV") {
    return parseComponents(
      await this.post(
        COMPONENTS_PATH,
        networkBody(object, context, []),
        NETWORK_REQUEST_TYPE,
        COMPONENTS_RESPONSE_TYPE
      )
    )
  }

  async references(from: RelationObject, to: RelationObject, context = "ENV") {
    return parseReferences(
      await this.post(
        REFERENCES_PATH,
        referencesBody(from, to, context),
        REFERENCES_REQUEST_TYPE,
        REFERENCES_RESPONSE_TYPE
      )
    )
  }

  async compare(left: RelationObject, right: RelationObject) {
    return parseRelationSet(
      await this.post(
        RELATIONS_PATH,
        relationSetBody(left, right),
        RELATIONS_REQUEST_TYPE,
        RELATIONS_RESPONSE_TYPE
      )
    )
  }
}
