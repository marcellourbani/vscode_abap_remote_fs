vi.mock("abap-adt-api", () => ({
  isAdtError: (error: any) => error?.kind === "adt",
  isHttpError: (error: any) => error?.kind === "http"
}))

import {
  getKeywordDocuRoute,
  KEYWORD_DOCU_PATH,
  getKeywordDocuTopic,
  searchKeywordDocu
} from "./keywordDocuAdt"

const QUERY_RELATION = "http://www.sap.com/adt/relations/docu/abap/langu/docu/query"
const DOCU_RELATION = "http://www.sap.com/adt/relations/docu/abap/langu/docu"
const DOCU_ACCEPT = "application/vnd.sap.adt.docu.v1+html,text/html"
const ADT_ROUTE = { kind: "adt", url: KEYWORD_DOCU_PATH } as const
const LEGACY_ROUTE = {
  kind: "legacy",
  url: "https://sap.example.com/sap/public/bc/abap/docu"
} as const

function makeClient() {
  return {
    findCollectionByUrl: vi.fn(),
    adtDiscovery: vi.fn(),
    baseUrl: "https://sap.example.com",
    client: "100",
    httpClient: { request: vi.fn().mockResolvedValue({ body: "<html/>" }) }
  }
}

describe("getKeywordDocuRoute", () => {
  test("prefers the ADT query template when present", async () => {
    const client = makeClient()
    client.adtDiscovery.mockResolvedValue([
      {
        title: "ABAP Language Help",
        collection: [
          {
            href: KEYWORD_DOCU_PATH,
            templateLinks: [{ rel: QUERY_RELATION, template: `${KEYWORD_DOCU_PATH}{?query}` }]
          },
          {
            href: LEGACY_ROUTE.url,
            templateLinks: [{ rel: DOCU_RELATION, template: `${LEGACY_ROUTE.url}{?query}` }]
          }
        ]
      }
    ])
    expect(await getKeywordDocuRoute(client as any)).toEqual(ADT_ROUTE)
    expect(client.adtDiscovery).toHaveBeenCalledTimes(1)
  })

  test("uses the same-host HTTPS public query route when ADT query is absent", async () => {
    const client = makeClient()
    client.adtDiscovery.mockResolvedValue([
      {
        title: "ABAP Documentation",
        collection: [
          {
            href: LEGACY_ROUTE.url,
            templateLinks: [
              {
                rel: DOCU_RELATION,
                template: `${LEGACY_ROUTE.url}{?sap%2Dlanguage,sap%2Dclient,format,query}`
              }
            ]
          }
        ]
      }
    ])
    expect(await getKeywordDocuRoute(client as any)).toEqual(LEGACY_ROUTE)
    expect(await getKeywordDocuRoute(client as any)).toEqual(LEGACY_ROUTE)
    expect(client.adtDiscovery).toHaveBeenCalledTimes(1)
  })

  test("allows same-host HTTP legacy discovery when the ADT connection uses HTTP", async () => {
    const client = makeClient()
    client.baseUrl = "http://sap.example.com:8000"
    client.adtDiscovery.mockResolvedValue([
      {
        title: "ABAP Documentation",
        collection: [
          {
            href: "http://sap.example.com:8000/sap/public/bc/abap/docu",
            templateLinks: [
              {
                rel: DOCU_RELATION,
                template:
                  "http://sap.example.com:8000/sap/public/bc/abap/docu{?sap%2Dlanguage,sap%2Dclient,format,query}"
              }
            ]
          }
        ]
      }
    ])
    expect(await getKeywordDocuRoute(client as any)).toEqual({
      kind: "legacy",
      url: "http://sap.example.com:8000/sap/public/bc/abap/docu"
    })
  })

  test("rejects an HTTP fallback when the ADT connection uses HTTPS", async () => {
    const client = makeClient()
    client.adtDiscovery.mockResolvedValue([
      {
        title: "ABAP Documentation",
        collection: [
          {
            href: "http://sap.example.com/sap/public/bc/abap/docu",
            templateLinks: [{ rel: DOCU_RELATION, template: "{?query}" }]
          }
        ]
      }
    ])
    expect(await getKeywordDocuRoute(client as any)).toBeUndefined()
  })

  test("ignores a legacy query route on a different host", async () => {
    const client = makeClient()
    client.adtDiscovery.mockResolvedValue([
      {
        title: "ABAP Documentation",
        collection: [
          {
            href: "https://other.example.com/sap/public/bc/abap/docu",
            templateLinks: [{ rel: DOCU_RELATION, template: "{?query}" }]
          }
        ]
      }
    ])
    expect(await getKeywordDocuRoute(client as any)).toBeUndefined()
  })

  test("returns undefined when neither search route is discovered", async () => {
    const client = makeClient()
    client.adtDiscovery.mockResolvedValue([
      { title: "Other", collection: [{ href: KEYWORD_DOCU_PATH, templateLinks: [] }] }
    ])
    expect(await getKeywordDocuRoute(client as any)).toBeUndefined()
  })

  test("propagates discovery failures and retries on the next call", async () => {
    const client = makeClient()
    client.adtDiscovery.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([])
    await expect(getKeywordDocuRoute(client as any)).rejects.toThrow("offline")
    expect(await getKeywordDocuRoute(client as any)).toBeUndefined()
    expect(client.adtDiscovery).toHaveBeenCalledTimes(2)
  })
})

describe("documentation requests", () => {
  test("search sends the query with the docu media type", async () => {
    const client = makeClient()
    expect(await searchKeywordDocu(client as any, ADT_ROUTE, "LOOP AT itab", "EN", "X")).toBe(
      "<html/>"
    )
    expect(client.httpClient.request).toHaveBeenCalledWith(KEYWORD_DOCU_PATH, {
      qs: { query: "LOOP AT itab", language: "EN", format: "eclipse", version: "X" },
      headers: { Accept: DOCU_ACCEPT }
    })
  })

  test("topic requests send the object id and both language parameters", async () => {
    const client = makeClient()
    await getKeywordDocuTopic(client as any, ADT_ROUTE, "DEMO_TOPIC", "DE", "5")
    expect(client.httpClient.request).toHaveBeenCalledWith(KEYWORD_DOCU_PATH, {
      qs: {
        object: "DEMO_TOPIC",
        language: "DE",
        "sap-language": "DE",
        format: "eclipse",
        version: "5"
      },
      headers: { Accept: DOCU_ACCEPT }
    })
  })

  test.each([
    { kind: "adt", err: 406 },
    { kind: "http", status: 406 }
  ])("retries once with any media type after 406 (%o)", async error => {
    const client = makeClient()
    client.httpClient.request
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ body: "retried" })
    expect(await searchKeywordDocu(client as any, ADT_ROUTE, "COND", "EN", "X")).toBe("retried")
    expect(client.httpClient.request).toHaveBeenCalledTimes(2)
    expect(client.httpClient.request.mock.calls[1][1].headers).toEqual({ Accept: "*/*" })
  })

  test("does not retry other failures", async () => {
    const client = makeClient()
    const error = { kind: "adt", err: 500 }
    client.httpClient.request.mockRejectedValue(error)
    await expect(searchKeywordDocu(client as any, ADT_ROUTE, "COND", "EN", "X")).rejects.toBe(error)
    expect(client.httpClient.request).toHaveBeenCalledTimes(1)
  })

  test("legacy search uses the discovered public URL and SAP client", async () => {
    const client = makeClient()
    await searchKeywordDocu(client as any, LEGACY_ROUTE, "FOR ALL ENTRIES", "EN", "X")
    expect(client.httpClient.request).toHaveBeenCalledWith(LEGACY_ROUTE.url, {
      qs: {
        query: "FOR ALL ENTRIES",
        "sap-language": "EN",
        "sap-client": "100",
        format: "eclipse"
      },
      headers: { Accept: "*/*" }
    })
  })

  test("legacy topic fetch carries the originating keyword and topic id", async () => {
    const client = makeClient()
    await getKeywordDocuTopic(client as any, LEGACY_ROUTE, "DEMO_TOPIC", "EN", "X", "LOOP AT")
    expect(client.httpClient.request).toHaveBeenCalledWith(LEGACY_ROUTE.url, {
      qs: {
        input: "LOOP AT",
        object: "DEMO_TOPIC",
        "sap-language": "EN",
        "sap-client": "100",
        format: "eclipse"
      },
      headers: { Accept: "*/*" }
    })
  })

  test("legacy route rejects unsupported Cloud version and topic without keyword", async () => {
    const client = makeClient()
    expect(() => searchKeywordDocu(client as any, LEGACY_ROUTE, "COND", "EN", "5")).toThrow(
      "only supports Standard ABAP"
    )
    expect(() => getKeywordDocuTopic(client as any, LEGACY_ROUTE, "DEMO_TOPIC", "EN", "X")).toThrow(
      "provide the original keyword"
    )
    expect(client.httpClient.request).not.toHaveBeenCalled()
  })
})
