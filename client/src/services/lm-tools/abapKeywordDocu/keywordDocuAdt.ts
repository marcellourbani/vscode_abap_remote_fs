import { type ADTClient, type AdtDiscoveryResult, isAdtError, isHttpError } from "abap-adt-api"

export const KEYWORD_DOCU_PATH = "/sap/bc/adt/docu/abap/langu"
const QUERY_RELATION = "http://www.sap.com/adt/relations/docu/abap/langu/docu/query"
const DOCU_RELATION = "http://www.sap.com/adt/relations/docu/abap/langu/docu"
const LEGACY_DOCU_PATH = "/sap/public/bc/abap/docu"
const DOCU_ACCEPT = "application/vnd.sap.adt.docu.v1+html,text/html"
const ANY_ACCEPT = "*/*"
const NOT_ACCEPTABLE = 406

export type KeywordDocuVersion = "X" | "5"

export interface KeywordDocuRoute {
  kind: "adt" | "legacy"
  url: string
}

const routes = new WeakMap<ADTClient, Promise<KeywordDocuRoute | undefined>>()

const errorStatus = (error: unknown) => {
  if (isAdtError(error)) return error.err
  if (isHttpError(error)) return error.status
}

function resolveRoute(discovery: AdtDiscoveryResult[], client: ADTClient) {
  for (const workspace of discovery) {
    for (const collection of workspace.collection) {
      const queryLink = collection.templateLinks.find(
        link => link.rel === QUERY_RELATION && /[?&,]query(?:[,}&]|$)/i.test(link.template)
      )
      if (queryLink && collection.href === KEYWORD_DOCU_PATH)
        return { kind: "adt", url: KEYWORD_DOCU_PATH } as const
    }
  }

  const base = new URL(client.baseUrl)
  for (const workspace of discovery) {
    for (const collection of workspace.collection) {
      const queryLink = collection.templateLinks.find(
        link => link.rel === DOCU_RELATION && /[?&,]query(?:[,}&]|$)/i.test(link.template)
      )
      if (!queryLink) continue
      try {
        const url = new URL(collection.href)
        if (
          (url.protocol === "https:" || (base.protocol === "http:" && url.protocol === "http:")) &&
          url.hostname.toLowerCase() === base.hostname.toLowerCase() &&
          url.pathname === LEGACY_DOCU_PATH
        )
          return { kind: "legacy", url: url.toString() } as const
      } catch {
        continue
      }
    }
  }
}

export function getKeywordDocuRoute(client: ADTClient): Promise<KeywordDocuRoute | undefined> {
  let route = routes.get(client)
  if (!route) {
    route = client.adtDiscovery().then(discovery => resolveRoute(discovery, client))
    routes.set(client, route)
    void route.catch(() => routes.delete(client))
  }
  return route
}

async function getDocuHtml(
  client: ADTClient,
  route: KeywordDocuRoute,
  qs: Record<string, string>
): Promise<string> {
  const url = route.kind === "adt" ? KEYWORD_DOCU_PATH : route.url
  if (route.kind === "legacy")
    return (await client.httpClient.request(url, { qs, headers: { Accept: "*/*" } })).body
  const request = (accept: string) =>
    client.httpClient.request(url, { qs, headers: { Accept: accept } })
  try {
    return (await request(DOCU_ACCEPT)).body
  } catch (error) {
    if (errorStatus(error) !== NOT_ACCEPTABLE) throw error
    return (await request(ANY_ACCEPT)).body
  }
}

export function searchKeywordDocu(
  client: ADTClient,
  route: KeywordDocuRoute,
  query: string,
  language: string,
  version: KeywordDocuVersion,
  clientNumber = client.client
) {
  if (route.kind === "legacy") {
    if (version !== "X")
      throw new Error("This system's legacy documentation search only supports Standard ABAP.")
    return getDocuHtml(client, route, {
      query,
      "sap-language": language,
      "sap-client": clientNumber,
      format: "eclipse"
    })
  }
  return getDocuHtml(client, route, { query, language, format: "eclipse", version })
}

export function getKeywordDocuTopic(
  client: ADTClient,
  route: KeywordDocuRoute,
  topicId: string,
  language: string,
  version: KeywordDocuVersion,
  searchKeyword?: string,
  clientNumber = client.client
) {
  if (route.kind === "legacy") {
    if (version !== "X")
      throw new Error("This system's legacy documentation search only supports Standard ABAP.")
    if (!searchKeyword)
      throw new Error(
        "On this system, provide the original keyword with topicId to read a search result."
      )
    return getDocuHtml(client, route, {
      input: searchKeyword,
      object: topicId,
      "sap-language": language,
      "sap-client": clientNumber,
      format: "eclipse"
    })
  }
  return getDocuHtml(client, route, {
    object: topicId,
    language,
    "sap-language": language,
    format: "eclipse",
    version
  })
}
