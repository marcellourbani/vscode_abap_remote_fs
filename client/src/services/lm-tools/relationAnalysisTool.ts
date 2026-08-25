import * as vscode from "vscode"
import {
  AdtRelationApi,
  RelationComponent,
  RelationEdge,
  RelationNetwork,
  RelationAnchor,
  RelationObject
} from "../../adt/relationApi"
import { getSearchService } from "../abapSearchService"
import { logTelemetry } from "../telemetry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { registerToolWithRegistry } from "./toolRegistry"

type RelationAction = "network" | "components" | "references" | "compare"
type RelationDirection = "used" | "using" | "both"
type ObjectScope = "all" | "custom" | "standard"

interface ObjectInput {
  objectName?: string
  objectType?: string
  objectUri?: string
}

export interface RelationAnalysisParameters extends ObjectInput {
  action: RelationAction
  connectionId: string
  relatedObjectName?: string
  relatedObjectType?: string
  relatedObjectUri?: string
  context?: string
  direction?: RelationDirection
  scope?: ObjectScope
  namePattern?: string
  objectTypes?: string[]
  relationTypes?: string[]
  startIndex?: number
  maxResults?: number
  includeProperties?: boolean
  includeLinks?: boolean
  includeContexts?: boolean
}

interface FilterOptions {
  scope: ObjectScope
  namePattern?: string
  objectTypes?: string[]
  relationTypes?: string[]
}

const wildcardRegex = (pattern: string): RegExp =>
  new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
    "i"
  )

const isCustom = (name: string): boolean => /^[ZY]/i.test(name)

const cleanName = (name: string): string => name.trim().replace(/\s+/g, " ")

const nameFromUri = (uri: string): string => {
  const path = uri.split(/[?#]/, 1)[0].replace(/\/+$/, "")
  const segment = path.slice(path.lastIndexOf("/") + 1)
  try {
    return decodeURIComponent(segment).trim().toUpperCase()
  } catch {
    return segment.trim().toUpperCase()
  }
}

const resultObjectName = (object: RelationObject): string =>
  object.type === "FUGR/FF"
    ? nameFromUri(object.uri) || cleanName(object.name)
    : cleanName(object.name) || nameFromUri(object.uri)

const objectNames = (object: RelationObject): string[] =>
  [...new Set([object.name, object.displayName, resultObjectName(object), nameFromUri(object.uri)])]
    .map(name => cleanName(name).toUpperCase())
    .filter(Boolean)

const sameObject = (left: RelationObject, right: RelationObject): boolean =>
  left.type === right.type &&
  (left.id === right.id || objectNames(left).some(name => objectNames(right).includes(name)))

const anchorMentionsObject = (anchor: RelationAnchor, object: RelationObject): boolean => {
  const searchable = `${anchor.snippet || ""} ${anchor.include || ""}`.toUpperCase()
  return objectNames(object).some(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(`(^|[^A-Z0-9_/])${escaped}([^A-Z0-9_/]|$)`, "i").test(searchable)
  })
}

const uniqueAnchors = (anchors: RelationAnchor[]): RelationAnchor[] => {
  const seen = new Set<string>()
  return anchors.filter(anchor => {
    const key = [anchor.uri, anchor.program, anchor.include, anchor.matches, anchor.snippet].join(
      "\u0000"
    )
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const matchesObject = (object: RelationObject, filter: FilterOptions): boolean => {
  const names = [resultObjectName(object), cleanName(object.name)]
  if (filter.scope === "custom" && !names.some(isCustom)) return false
  if (filter.scope === "standard" && names.some(isCustom)) return false
  if (filter.namePattern && !names.some(name => wildcardRegex(filter.namePattern!).test(name)))
    return false
  return !filter.objectTypes?.length || filter.objectTypes.includes(object.type)
}

const compactObject = (
  object: RelationObject,
  includeProperties: boolean,
  includeLinks: boolean
) => ({
  name: resultObjectName(object),
  type: object.type,
  uri: object.uri,
  ...(object.description ? { description: object.description } : {}),
  ...(object.parentUri ? { parentUri: object.parentUri } : {}),
  ...(includeProperties ? { properties: object.properties } : {}),
  ...(includeLinks ? { links: object.links } : {})
})

const relationObjectName = (object: RelationObject, ambiguousNames: Set<string>): string => {
  const name = resultObjectName(object)
  return ambiguousNames.has(name) ? `${name} (${object.type})` : name
}

const page = <T>(items: T[], startIndex: number, maxResults: number) => ({
  total: items.length,
  startIndex,
  returned: items.slice(startIndex, startIndex + maxResults).length,
  hasMore: startIndex + maxResults < items.length,
  nextStartIndex: startIndex + maxResults < items.length ? startIndex + maxResults : undefined,
  items: items.slice(startIndex, startIndex + maxResults)
})

const resolveObject = async (connectionId: string, input: ObjectInput): Promise<RelationObject> => {
  const objectUri = input.objectUri?.trim()
  const objectType = input.objectType?.trim().toUpperCase()
  const suppliedName = input.objectName?.trim()
  if (!objectType) throw new Error("objectType is required for every ABAP object")
  if (objectUri) {
    const name = nameFromUri(objectUri) || suppliedName?.toUpperCase()
    if (!name) throw new Error("objectName is required when objectUri has no object-name segment")
    return {
      id: objectUri,
      name,
      type: objectType,
      uri: objectUri,
      displayName: name,
      properties: [],
      links: []
    }
  }
  if (!suppliedName)
    throw new Error("Provide objectName, or provide objectUri together with objectType")
  const name = suppliedName.toUpperCase()
  const searchType = objectType === "FUGR/FF" ? "FUNC" : objectType
  const found = await getSearchService(connectionId).searchObjects(name, [searchType], 5)
  const exactMatches = found.filter(
    item =>
      item.name.trim().toUpperCase() === name &&
      (!objectType || item.type.trim().toUpperCase() === objectType)
  )
  if (exactMatches.length > 1)
    throw new Error(
      `Multiple ABAP objects named ${name}${objectType ? ` (${objectType})` : ""} were found; provide objectUri to disambiguate`
    )
  const object = exactMatches[0]
  if (!object?.uri)
    throw new Error(`ABAP object ${name}${objectType ? ` (${objectType})` : ""} was not found`)
  return {
    id: object.uri.trim(),
    name: object.name.trim().toUpperCase(),
    type: object.type.trim(),
    uri: object.uri.trim(),
    displayName: object.name.trim(),
    description: object.description?.trim(),
    properties: [],
    links: []
  }
}

const relatedInput = (input: RelationAnalysisParameters): ObjectInput => {
  if (!input.relatedObjectName && !input.relatedObjectUri)
    throw new Error(
      `Provide relatedObjectName, or provide relatedObjectUri together with relatedObjectType for action '${input.action}'`
    )
  if (!input.relatedObjectType)
    throw new Error("relatedObjectType is required for every related ABAP object")
  return {
    objectName: input.relatedObjectName,
    objectType: input.relatedObjectType,
    objectUri: input.relatedObjectUri
  }
}

const assertContextCompatibility = (context: string | undefined, objectType: string): void => {
  const baseType = objectType.split("/", 1)[0]
  if (context === "EXTED_OBJ" && ["DDLS", "STOB", "DDLX", "DCLS", "DTEB"].includes(baseType)) {
    throw new Error(
      `Context EXTED_OBJ is not supported for CDS object type ${objectType}. Use a CDS context such as CDS, or query EXTED_OBJ with an enhancement object.`
    )
  }
}

const isRelationsApiUnavailable = (error: unknown): boolean =>
  String(error).includes("/sap/bc/adt/objectrelations") && String(error).includes("does not exist")

const filterNetwork = (
  network: RelationNetwork,
  root: RelationObject,
  filter: FilterOptions,
  includeProperties: boolean,
  includeLinks: boolean
) => {
  const objectsById = new Map(network.objects.map(object => [object.id, object]))
  const typesByName = new Map<string, Set<string>>()
  ;[root, ...network.objects].forEach(object => {
    const name = resultObjectName(object)
    const types = typesByName.get(name) || new Set<string>()
    types.add(object.type)
    typesByName.set(name, types)
  })
  const ambiguousNames = new Set(
    [...typesByName.entries()].filter(([, types]) => types.size > 1).map(([name]) => name)
  )
  const relations = network.relations.filter(relation => {
    const from = objectsById.get(relation.from)
    const to = objectsById.get(relation.to)
    if (!from || !to) return false
    if (filter.relationTypes?.length && !filter.relationTypes.includes(relation.type)) return false
    const related = from.id === root.id ? to : from
    return matchesObject(related, filter)
  })
  const objectIds = new Set(relations.flatMap(relation => [relation.from, relation.to]))
  const objects = network.objects
    .filter(object => object.id !== root.id && objectIds.has(object.id))
    .map(object => compactObject(object, includeProperties, includeLinks))
  return {
    activeContext: network.activeContext,
    objects,
    relations: relations.map(relation => ({
      from: objectsById.has(relation.from)
        ? relationObjectName(objectsById.get(relation.from)!, ambiguousNames)
        : relation.from,
      to: objectsById.has(relation.to)
        ? relationObjectName(objectsById.get(relation.to)!, ambiguousNames)
        : relation.to,
      type: relation.type,
      ...(relation.state ? { state: relation.state } : {}),
      ...(relation.roleFrom ? { roleFrom: relation.roleFrom } : {}),
      ...(relation.roleTo ? { roleTo: relation.roleTo } : {}),
      ...(includeProperties ? { properties: relation.properties } : {})
    }))
  }
}

const referencesForReport = async (
  api: AdtRelationApi,
  report: RelationObject,
  target: RelationObject,
  context: string
) => {
  const direct = await api.references(report, target, context)
  if (report.type !== "PROG/P" || context !== "ENV") {
    return { references: direct, resolvedSources: [] as RelationObject[] }
  }

  const directAnchors = uniqueAnchors(
    direct.anchors.filter(anchor => anchorMentionsObject(anchor, target))
  )
  if (directAnchors.length) {
    return {
      references: { ...direct, numberOfResults: directAnchors.length, anchors: directAnchors },
      resolvedSources: [] as RelationObject[]
    }
  }

  const reportNetwork = await api.network(report, "ENV", ["ENV"])
  const includes = reportNetwork.objects.filter(object => object.type === "PROG/I")
  const resolved = await Promise.all(
    includes.map(async include => {
      const network = await api.network(include, "ENV", ["ENV"])
      const hasTarget = network.objects.some(object => sameObject(object, target))
      if (!hasTarget) return undefined
      const result = await api.references(include, target, context)
      const anchors = uniqueAnchors(
        result.anchors.filter(anchor => anchorMentionsObject(anchor, target))
      )
      return anchors.length
        ? { include, result: { ...result, numberOfResults: anchors.length, anchors } }
        : undefined
    })
  )
  const matches = resolved.filter(
    (
      item
    ): item is {
      include: RelationObject
      result: Awaited<ReturnType<AdtRelationApi["references"]>>
    } => item !== undefined
  )
  return {
    references: {
      numberOfResults: matches.reduce((total, item) => total + item.result.numberOfResults, 0),
      from: report,
      to: target,
      anchors: matches.flatMap(item => item.result.anchors)
    },
    resolvedSources: matches.map(item => item.include)
  }
}

const mergeNetworks = (networks: RelationNetwork[]): RelationNetwork => {
  const objects = new Map<string, RelationObject>()
  const relations = new Map<string, RelationEdge>()
  const contexts = new Map<string, RelationNetwork["contexts"][number]>()
  for (const network of networks) {
    network.objects.forEach(object => objects.set(object.id, object))
    network.relations.forEach(relation => relations.set(relation.id, relation))
    network.contexts.forEach(context => contexts.set(context.id, context))
  }
  return {
    activeContext: networks
      .map(network => network.activeContext)
      .filter(Boolean)
      .join(","),
    objects: [...objects.values()],
    relations: [...relations.values()],
    contexts: [...contexts.values()]
  }
}

export class RelationAnalysisTool implements vscode.LanguageModelTool<RelationAnalysisParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<RelationAnalysisParameters>
  ) {
    const {
      action,
      objectName,
      objectUri,
      relatedObjectName,
      relatedObjectUri,
      connectionId,
      maxResults = 50
    } = options.input
    const displayObject = objectName?.trim() || objectUri?.trim() || "object"
    const displayRelatedObject = relatedObjectName?.trim() || relatedObjectUri?.trim()
    const operation =
      action === "network"
        ? options.input.direction === "using"
          ? "Analyzing objects using"
          : options.input.direction === "both"
            ? "Analyzing objects used by or using"
            : "Analyzing objects used by"
        : action === "components"
          ? "Analyzing components of"
          : action === "references"
            ? "Analyzing references from"
            : "Comparing relations for"
    const invocationMessage =
      action === "references" && displayRelatedObject
        ? `${operation} ${displayObject} to ${displayRelatedObject}`
        : action === "compare" && displayRelatedObject
          ? `${operation} ${displayObject} and ${displayRelatedObject}`
          : `${operation} ${displayObject}`
    return {
      invocationMessage,
      confirmationMessages: {
        title: "Analyze ABAP Relations",
        message: new vscode.MarkdownString(
          `${action}: ${displayObject}${displayRelatedObject ? ` and ${displayRelatedObject}` : ""} on ${connectionId}; max ${maxResults} results`
        )
      }
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<RelationAnalysisParameters>
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    const input = options.input
    const connectionId = input.connectionId.toLowerCase()
    const startIndex = Math.max(0, input.startIndex || 0)
    const maxResults = Math.min(500, Math.max(1, input.maxResults || 50))
    const filter: FilterOptions = {
      scope: input.scope || "all",
      namePattern: input.namePattern,
      objectTypes: input.objectTypes,
      relationTypes: input.relationTypes
    }
    logTelemetry(`tool_analyze_abap_relations_${input.action}_called`, { connectionId })

    try {
      const api = new AdtRelationApi(connectionId)
      const root = await resolveObject(connectionId, input)
      assertContextCompatibility(input.context, root.type)
      let result: object

      if (input.action === "network") {
        const requestedDirection = input.direction || "used"
        const contexts = input.context
          ? [input.context]
          : requestedDirection === "both"
            ? ["ENV", "WUL"]
            : [requestedDirection === "using" ? "WUL" : "ENV"]
        const direction = input.context
          ? input.context === "ENV"
            ? "used"
            : input.context === "WUL"
              ? "using"
              : undefined
          : requestedDirection
        const network = mergeNetworks(
          await Promise.all(contexts.map(context => api.network(root, context, [context])))
        )
        const filtered = filterNetwork(
          network,
          root,
          filter,
          input.includeProperties === true,
          input.includeLinks === true
        )
        result = {
          action: input.action,
          root: compactObject(root, false, false),
          direction,
          contextsQueried: contexts,
          objects: page(filtered.objects, startIndex, maxResults),
          relations: page(filtered.relations, startIndex, maxResults),
          ...(input.includeContexts ? { availableContexts: network.contexts } : {})
        }
      } else if (input.action === "components") {
        const rawComponents = await api.components(root, input.context || "ENV")
        const navigableComponents = rawComponents.filter(component => Boolean(component.uri))
        const components = navigableComponents
          .filter(component => matchesObject(component, filter))
          .map((component: RelationComponent) => ({
            ...compactObject(
              component,
              input.includeProperties === true,
              input.includeLinks === true
            ),
            ...(component.parentId ? { parentId: component.parentId } : {})
          }))
        result = {
          action: input.action,
          root: compactObject(root, false, false),
          components: page(components, startIndex, maxResults),
          ...(components.length === 0
            ? rawComponents.length === 0
              ? {
                  notice:
                    "SAP returned no component hierarchy for this object and context. Use the network action to inspect object relations."
                }
              : navigableComponents.length === 0
                ? {
                    notice:
                      "SAP returned component entries, but none had navigable URIs. Use the network action to inspect object relations."
                  }
                : {
                    notice:
                      "SAP returned components, but none matched the requested filters. Remove or widen the filters to see them."
                  }
            : {})
        }
      } else {
        const related = await resolveObject(connectionId, relatedInput(input))
        if (input.action === "references") {
          const { references, resolvedSources } = await referencesForReport(
            api,
            root,
            related,
            input.context || "ENV"
          )
          result = {
            action: input.action,
            from: compactObject(root, false, false),
            to: compactObject(related, false, false),
            numberOfResults: references.numberOfResults,
            ...(resolvedSources.length
              ? {
                  resolvedSources: resolvedSources.map(source =>
                    compactObject(source, false, false)
                  )
                }
              : {}),
            anchors: page(references.anchors, startIndex, maxResults)
          }
        } else {
          const comparison = await api.compare(root, related)
          result = {
            action: input.action,
            left: compactObject(root, false, false),
            right: compactObject(related, false, false),
            header: comparison.header,
            relations: page(comparison.relations, startIndex, maxResults)
          }
        }
      }

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2))
      ])
    } catch (error) {
      if (isRelationsApiUnavailable(error)) {
        throw new Error(
          `SAP system ${connectionId} does not support the ABAP object-relations APIs. Relation analysis is unavailable on this system. Use find_where_used for exact source-usage questions.`
        )
      }
      throw new Error(`ABAP relation analysis failed: ${String(error)}`)
    }
  }
}

export function registerRelationAnalysisTool(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    registerToolWithRegistry("analyze_abap_relations", new RelationAnalysisTool())
  )
}
