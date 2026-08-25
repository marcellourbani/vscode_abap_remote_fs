jest.mock(
  "vscode",
  () => ({
    LanguageModelToolResult: jest.fn().mockImplementation((parts: any[]) => ({ parts })),
    LanguageModelTextPart: jest.fn().mockImplementation((text: string) => ({ text })),
    MarkdownString: jest.fn().mockImplementation((text: string) => ({ text })),
    lm: { registerTool: jest.fn(() => ({ dispose: jest.fn() })) }
  }),
  { virtual: true }
)

const network = jest.fn()
const references = jest.fn()
const components = jest.fn()
const compare = jest.fn()

jest.mock("../../adt/relationApi", () => ({
  AdtRelationApi: jest.fn().mockImplementation(() => ({
    network,
    references,
    components,
    compare
  }))
}))
jest.mock("../abapSearchService", () => ({ getSearchService: jest.fn() }))
jest.mock("../telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("./toolRegistry", () => ({
  registerToolWithRegistry: jest.fn(() => ({ dispose: jest.fn() }))
}))
jest.mock("./toolGuard", () => ({ assertToolInvocationAuthorized: jest.fn() }))

import { getSearchService } from "../abapSearchService"
import { registerRelationAnalysisTool, RelationAnalysisTool } from "./relationAnalysisTool"
import { registerToolWithRegistry } from "./toolRegistry"

const searchObjects = jest.fn()
const makeOptions = (input: any) => ({ input }) as any
const parseResult = (result: any) => JSON.parse(result.parts[0].text)

const report = {
  name: "ZREPORT",
  type: "PROG/P",
  uri: "/report",
  description: "Report"
}
const include = {
  id: "/include",
  name: "ZREPORT_I01",
  type: "PROG/I",
  uri: "/include",
  displayName: "ZREPORT_I01",
  properties: [],
  links: []
}
const target = {
  id: "/class",
  name: "ZCL_TARGET",
  type: "CLAS/OC",
  uri: "/class",
  displayName: "ZCL_TARGET",
  properties: [],
  links: []
}
const makeNetwork = (activeContext = "ENV") => ({
  activeContext,
  contexts: [
    {
      id: activeContext,
      description: activeContext,
      supportsComponents: true,
      supportsGrouping: true,
      supportsReferences: true,
      isDefault: true,
      relevance: 7
    }
  ],
  objects: [
    { ...report, id: report.uri },
    target,
    { ...target, id: "/standard", name: "CL_STANDARD", type: "CLAS/OC", uri: "/standard" }
  ],
  relations: [
    {
      id: "custom",
      from: report.uri,
      to: target.id,
      type: "parentChild",
      state: "A",
      properties: []
    },
    { id: "standard", from: report.uri, to: "/standard", type: "dependsOn", properties: [] }
  ]
})

describe("RelationAnalysisTool", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getSearchService as jest.Mock).mockReturnValue({ searchObjects })
    searchObjects.mockImplementation((name: string) =>
      Promise.resolve([name === report.name ? report : target])
    )
  })

  it("resolves report references through matching ORO include relations", async () => {
    references.mockResolvedValueOnce({ numberOfResults: 0, anchors: [] }).mockResolvedValueOnce({
      numberOfResults: 1,
      anchors: [{ uri: "/include/source#start=10", snippet: "NEW zcl_target( )" }]
    })
    network
      .mockResolvedValueOnce({
        objects: [include],
        relations: [],
        contexts: [],
        activeContext: "ENV"
      })
      .mockResolvedValueOnce({
        objects: [include, target],
        relations: [],
        contexts: [],
        activeContext: "ENV"
      })

    const result = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "references",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type,
          relatedObjectName: target.name,
          relatedObjectType: target.type
        })
      )
    )

    expect(result.numberOfResults).toBe(1)
    expect(result.resolvedSources).toEqual([
      expect.objectContaining({ name: include.name, type: include.type })
    ])
    expect(result.anchors.items[0].snippet).toContain("zcl_target")
    expect(references).toHaveBeenLastCalledWith(include, expect.objectContaining(target), "ENV")
  })

  it("resolves function modules through the search service FUNC type", async () => {
    const functionModule = {
      name: "ZTEST_FUNCTION_MODULE",
      type: "FUGR/FF",
      uri: "/sap/bc/adt/functions/groups/ztest_group/fmodules/ztest_function_module",
      description: "Test function module"
    }
    searchObjects.mockResolvedValueOnce([functionModule])
    network.mockResolvedValue({ objects: [], relations: [], contexts: [], activeContext: "ENV" })

    const result = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "network",
          connectionId: "DEV100",
          objectName: functionModule.name,
          objectType: functionModule.type
        })
      )
    )

    expect(searchObjects).toHaveBeenCalledWith(functionModule.name, ["FUNC"], 5)
    expect(network).toHaveBeenCalledWith(
      expect.objectContaining({
        name: functionModule.name,
        type: functionModule.type,
        uri: functionModule.uri
      }),
      "ENV",
      ["ENV"]
    )
    expect(result.root.type).toBe("FUGR/FF")
  })

  it("excludes the root from filtered network objects and reports effective context direction", async () => {
    network.mockResolvedValue({
      objects: [
        { ...target, id: "/report", name: report.name, type: report.type, uri: "/report" },
        target
      ],
      relations: [
        {
          id: "edge",
          from: "/report",
          to: target.id,
          type: "parentChild",
          properties: []
        }
      ],
      contexts: [],
      activeContext: "ENV"
    })

    const result = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "network",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type,
          direction: "using",
          context: "ENV",
          objectTypes: [target.type]
        })
      )
    )

    expect(result.direction).toBe("used")
    expect(result.objects.items).toEqual([expect.objectContaining({ name: target.name })])
  })

  it("suppresses non-navigable component placeholders", async () => {
    components.mockResolvedValue([
      { ...target, name: "Elements can't be determined", type: "DDLS/O", uri: "" },
      target
    ])

    const result = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "components",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type
        })
      )
    )

    expect(result.components.items).toEqual([expect.objectContaining({ name: target.name })])
  })

  it("explains empty component responses instead of failing silently", async () => {
    components.mockResolvedValue([])

    const result = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "components",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type
        })
      )
    )

    expect(result.components.items).toEqual([])
    expect(result.notice).toContain("SAP returned no component hierarchy")
  })

  it("distinguishes filtered components from empty SAP responses", async () => {
    components.mockResolvedValue([target])

    const result = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "components",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type,
          namePattern: "NO_SUCH_COMPONENT*"
        })
      )
    )

    expect(result.components.items).toEqual([])
    expect(result.notice).toContain("none matched the requested filters")
  })

  it("explains component entries without navigable URIs", async () => {
    components.mockResolvedValue([{ ...target, uri: "", name: "Elements can't be determined" }])

    const result = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "components",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type
        })
      )
    )

    expect(result.components.items).toEqual([])
    expect(result.notice).toContain("none had navigable URIs")
  })

  it("rejects EXTED_OBJ for CDS objects before contacting SAP", async () => {
    searchObjects.mockResolvedValueOnce([{ ...target, name: "ZCDS", type: "DDLS/DF", uri: "/cds" }])
    await expect(
      new RelationAnalysisTool().invoke(
        makeOptions({
          action: "network",
          connectionId: "DEV100",
          objectName: "ZCDS",
          objectType: "DDLS/DF",
          context: "EXTED_OBJ"
        })
      )
    ).rejects.toThrow("Context EXTED_OBJ is not supported for CDS object type DDLS/DF")
    expect(network).not.toHaveBeenCalled()
    expect(components).not.toHaveBeenCalled()
    expect(references).not.toHaveBeenCalled()
    expect(compare).not.toHaveBeenCalled()
  })

  it("runs used, using, and both network directions", async () => {
    network.mockResolvedValueOnce(makeNetwork("ENV")).mockResolvedValueOnce(makeNetwork("WUL"))

    const used = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "network",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type,
          direction: "used"
        })
      )
    )
    expect(used.direction).toBe("used")
    expect(used.contextsQueried).toEqual(["ENV"])

    const using = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "network",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type,
          direction: "using"
        })
      )
    )
    expect(using.direction).toBe("using")
    expect(using.contextsQueried).toEqual(["WUL"])

    const both = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "network",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type,
          direction: "both"
        })
      )
    )
    expect(both.direction).toBe("both")
    expect(both.contextsQueried).toEqual(["ENV", "WUL"])
  })

  it("applies scope, wildcard, object-type, relation-type, and detail filters", async () => {
    network.mockResolvedValue(makeNetwork())
    const result = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "network",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type,
          scope: "custom",
          namePattern: "Z*",
          objectTypes: ["CLAS/OC"],
          relationTypes: ["parentChild"],
          includeProperties: true,
          includeLinks: true,
          includeContexts: true,
          maxResults: 10
        })
      )
    )
    expect(result.objects.items).toEqual([
      expect.objectContaining({ name: target.name, properties: [], links: [] })
    ])
    expect(result.relations.items).toHaveLength(1)
    expect(result.availableContexts).toHaveLength(1)
  })

  it("adds types to ambiguous same-name relation endpoints", async () => {
    const classObject = {
      ...target,
      id: "/class-shared",
      name: "ZSHARED",
      displayName: "ZSHARED",
      type: "CLAS/OC",
      uri: "/class-shared"
    }
    const tableObject = {
      ...target,
      id: "/table-shared",
      name: "ZSHARED",
      displayName: "ZSHARED",
      type: "TABL/DT",
      uri: "/table-shared"
    }
    network.mockResolvedValue({
      objects: [{ ...report, id: report.uri }, classObject, tableObject],
      relations: [
        {
          id: "class-edge",
          from: report.uri,
          to: classObject.uri,
          type: "parentChild",
          properties: []
        },
        {
          id: "table-edge",
          from: report.uri,
          to: tableObject.uri,
          type: "parentChild",
          properties: []
        }
      ],
      contexts: [],
      activeContext: "ENV"
    })

    const result = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "network",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type
        })
      )
    )

    expect(result.relations.items.map((relation: any) => relation.to)).toEqual([
      "ZSHARED (CLAS/OC)",
      "ZSHARED (TABL/DT)"
    ])
    expect(result.objects.items).toEqual([
      expect.objectContaining({ name: "ZSHARED", type: "CLAS/OC" }),
      expect.objectContaining({ name: "ZSHARED", type: "TABL/DT" })
    ])
  })

  it("pages network results and clamps runtime bounds", async () => {
    network.mockResolvedValue(makeNetwork())
    const result = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "network",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type,
          startIndex: -5,
          maxResults: 1000
        })
      )
    )
    expect(result.objects.startIndex).toBe(0)
    expect(result.objects.returned).toBe(2)
    expect(result.objects.hasMore).toBe(false)
  })

  it("runs components with filters and pagination", async () => {
    components.mockResolvedValue([
      {
        ...target,
        properties: [{ name: "key", value: "yes" }],
        links: [{ href: "/target", rel: "definition" }]
      },
      { ...target, id: "/second", name: "ZSECOND" }
    ])
    const result = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "components",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type,
          scope: "custom",
          objectTypes: ["CLAS/OC"],
          startIndex: 1,
          maxResults: 1,
          includeProperties: true,
          includeLinks: true
        })
      )
    )
    expect(result.components).toMatchObject({
      total: 2,
      startIndex: 1,
      returned: 1,
      hasMore: false
    })
    expect(result.components.items[0].name).toBe("ZSECOND")
  })

  it("runs references and compare branches with related resolution", async () => {
    references.mockResolvedValue({
      numberOfResults: 1,
      anchors: [{ uri: "/source", snippet: "CALL zcl_target" }]
    })
    let result = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "references",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type,
          relatedObjectName: target.name,
          relatedObjectType: target.type,
          startIndex: 0,
          maxResults: 1
        })
      )
    )
    expect(result.anchors.items[0].snippet).toBe("CALL zcl_target")

    compare.mockResolvedValue({
      header: "Relations",
      relations: [
        {
          id: "r",
          from: report.uri,
          to: target.uri,
          type: "set relation",
          direction: "left-to-right",
          properties: []
        }
      ]
    })
    result = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "compare",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type,
          relatedObjectName: target.name,
          relatedObjectType: target.type
        })
      )
    )
    expect(result.header).toBe("Relations")
    expect(result.relations.items).toHaveLength(1)
  })

  it("reports lookup failures and API failures clearly", async () => {
    searchObjects.mockResolvedValue([])
    await expect(
      new RelationAnalysisTool().invoke(
        makeOptions({
          action: "network",
          connectionId: "DEV100",
          objectName: "MISSING",
          objectType: "PROG/P"
        })
      )
    ).rejects.toThrow("ABAP object MISSING (PROG/P) was not found")

    searchObjects.mockResolvedValue([report])
    await expect(
      new RelationAnalysisTool().invoke(
        makeOptions({
          action: "references",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type
        })
      )
    ).rejects.toThrow("Provide relatedObjectName, or provide relatedObjectUri")

    network.mockRejectedValue(new Error("HTTP 500"))
    await expect(
      new RelationAnalysisTool().invoke(
        makeOptions({
          action: "network",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type
        })
      )
    ).rejects.toThrow("ABAP relation analysis failed: Error: HTTP 500")
  })

  it("explains when the SAP system does not support relations APIs", async () => {
    network.mockRejectedValue(
      new Error("Resource /sap/bc/adt/objectrelations/network does not exist.")
    )

    await expect(
      new RelationAnalysisTool().invoke(
        makeOptions({
          action: "network",
          connectionId: "LEGACY_SYSTEM",
          objectName: report.name,
          objectType: report.type
        })
      )
    ).rejects.toThrow(
      "SAP system legacy_system does not support the ABAP object-relations APIs. Relation analysis is unavailable on this system. Use find_where_used"
    )
  })

  it("logs action-specific telemetry and formats invocation confirmation", async () => {
    const prepared = await new RelationAnalysisTool().prepareInvocation(
      makeOptions({
        action: "compare",
        connectionId: "DEV100",
        objectName: report.name,
        relatedObjectName: target.name,
        maxResults: 3
      })
    )
    expect(prepared.invocationMessage).toContain(report.name)
    expect((prepared.confirmationMessages as any).message.text).toContain("max 3")
    network.mockResolvedValue(makeNetwork())
    await new RelationAnalysisTool().invoke(
      makeOptions({
        action: "network",
        connectionId: "DEV100",
        objectName: report.name,
        objectType: report.type
      })
    )
    const { logTelemetry } = require("../telemetry")
    expect(logTelemetry).toHaveBeenCalledWith("tool_analyze_abap_relations_network_called", {
      connectionId: "dev100"
    })
  })

  it("formats URI-only invocation confirmation", async () => {
    const prepared = await new RelationAnalysisTool().prepareInvocation(
      makeOptions({
        action: "references",
        connectionId: "DEV100",
        objectUri: report.uri,
        relatedObjectUri: target.uri,
        maxResults: 2
      })
    )

    expect(prepared.invocationMessage).toContain(report.uri)
    expect((prepared.confirmationMessages as any).message.text).toContain(target.uri)
    expect((prepared.confirmationMessages as any).message.text).not.toContain("undefined")
  })

  it("resolves objects from explicit URI and rejects nonmatching wildcard filters", async () => {
    network.mockResolvedValue(makeNetwork())
    let result = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "network",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type,
          objectUri: report.uri,
          direction: "used",
          namePattern: "NO_MATCH_*",
          scope: "standard"
        })
      )
    )
    expect(result.objects.items).toEqual([])
    expect(result.relations.items).toEqual([])
    expect(searchObjects).not.toHaveBeenCalled()
  })

  it("accepts URI-only primary and related objects without searching or placeholder names", async () => {
    references.mockResolvedValue({
      numberOfResults: 1,
      anchors: [{ uri: "/source", snippet: "NEW zcl_target( )" }]
    })

    const result = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "references",
          connectionId: "DEV100",
          objectType: report.type,
          objectUri: report.uri,
          relatedObjectType: target.type,
          relatedObjectUri: target.uri
        })
      )
    )

    expect(result.from).toEqual(expect.objectContaining({ name: "REPORT" }))
    expect(result.to).toEqual(expect.objectContaining({ name: "CLASS" }))
    expect(references).toHaveBeenCalledWith(
      expect.objectContaining({ name: "REPORT", type: report.type, uri: report.uri }),
      expect.objectContaining({ name: "CLASS", type: target.type, uri: target.uri }),
      "ENV"
    )
    expect(searchObjects).not.toHaveBeenCalled()
  })

  it("requires an object type for every primary and related object", async () => {
    await expect(
      new RelationAnalysisTool().invoke(
        makeOptions({
          action: "network",
          connectionId: "DEV100",
          objectName: report.name
        })
      )
    ).rejects.toThrow("objectType is required for every ABAP object")

    await expect(
      new RelationAnalysisTool().invoke(
        makeOptions({
          action: "network",
          connectionId: "DEV100",
          objectUri: report.uri
        })
      )
    ).rejects.toThrow("objectType is required for every ABAP object")

    await expect(
      new RelationAnalysisTool().invoke(
        makeOptions({
          action: "references",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type,
          relatedObjectUri: target.uri
        })
      )
    ).rejects.toThrow("relatedObjectType is required for every related ABAP object")
  })

  it("requires type and rejects ambiguous same-type objects", async () => {
    await expect(
      new RelationAnalysisTool().invoke(
        makeOptions({
          action: "network",
          connectionId: "DEV100",
          objectName: report.name
        })
      )
    ).rejects.toThrow("objectType is required for every ABAP object")

    searchObjects.mockResolvedValue([
      { ...report, type: "PROG/P", uri: "/report-one" },
      { ...report, type: "PROG/P", uri: "/report-two" }
    ])

    await expect(
      new RelationAnalysisTool().invoke(
        makeOptions({
          action: "network",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type
        })
      )
    ).rejects.toThrow("Multiple ABAP objects named ZREPORT (PROG/P) were found; provide objectUri")
    expect(network).not.toHaveBeenCalled()

    searchObjects.mockResolvedValue([
      { ...report, type: "PROG/P", uri: "/report" },
      { ...report, type: "TABL/DT", uri: "/table" }
    ])
    network.mockResolvedValue(makeNetwork())
    const result = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "network",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: "prog/p"
        })
      )
    )
    expect(result.root).toEqual(expect.objectContaining({ name: report.name, type: "PROG/P" }))
  })

  it("does not resolve a typed name to a fuzzy search result", async () => {
    searchObjects.mockResolvedValue([{ ...report, name: "ZREPORT_OTHER", type: "PROG/P" }])

    await expect(
      new RelationAnalysisTool().invoke(
        makeOptions({
          action: "network",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type
        })
      )
    ).rejects.toThrow("ABAP object ZREPORT (PROG/P) was not found")
    expect(network).not.toHaveBeenCalled()
  })

  it("registers the tool in the shared registry", () => {
    const context = { subscriptions: [] } as any
    registerRelationAnalysisTool(context)
    expect(registerToolWithRegistry).toHaveBeenCalledWith(
      "analyze_abap_relations",
      expect.any(RelationAnalysisTool)
    )
    expect(context.subscriptions).toHaveLength(1)
  })

  it("does not traverse includes when direct references already contain anchors", async () => {
    references.mockResolvedValue({
      numberOfResults: 2,
      anchors: [
        { uri: "/report/source", snippet: "NEW zcl_target( )" },
        { uri: "/report/source", snippet: "DATA(go_main) = NEW lcl_main( )" },
        { uri: "/report/source", snippet: "NEW zcl_target( )" }
      ]
    })
    const result = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "references",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type,
          relatedObjectName: target.name,
          relatedObjectType: target.type
        })
      )
    )
    expect(result.numberOfResults).toBe(1)
    expect(result.anchors.items).toHaveLength(1)
    expect(result.anchors.items[0].snippet).toContain("zcl_target")
    expect(network).not.toHaveBeenCalled()
  })

  it("normalizes fixed-width function-module names in filtered network output", async () => {
    const functionGroup = {
      name: "Z001",
      type: "FUGR/F",
      uri: "/functions/groups/z001"
    }
    const functionModule = {
      id: "/functions/groups/z001/fmodules/tableframe_z001",
      name: "Z001                                    TABLEFRAME_Z001",
      type: "FUGR/FF",
      uri: "/functions/groups/z001/fmodules/tableframe_z001",
      displayName: "Z001                                    TABLEFRAME_Z001",
      properties: [],
      links: []
    }
    searchObjects.mockResolvedValueOnce([functionGroup])
    network.mockResolvedValue({
      objects: [{ ...functionGroup, id: functionGroup.uri }, functionModule],
      relations: [
        {
          id: "function-module",
          from: functionGroup.uri,
          to: functionModule.id,
          type: "parentChild",
          properties: []
        }
      ],
      contexts: [],
      activeContext: "ENV"
    })

    const result = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "network",
          connectionId: "DEV100",
          objectName: functionGroup.name,
          objectType: functionGroup.type,
          scope: "custom",
          namePattern: "TABLEFRAME_Z001"
        })
      )
    )

    expect(result.objects.items[0].name).toBe("TABLEFRAME_Z001")
    expect(result.relations.items[0].to).toBe("TABLEFRAME_Z001")
  })

  it("does not traverse report includes outside ENV context", async () => {
    references.mockResolvedValue({ numberOfResults: 0, anchors: [] })
    const result = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "references",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type,
          relatedObjectName: target.name,
          relatedObjectType: target.type,
          context: "WUL"
        })
      )
    )
    expect(result.numberOfResults).toBe(0)
    expect(network).not.toHaveBeenCalled()
  })

  it("returns zero report references when no include contains the target", async () => {
    references.mockResolvedValue({ numberOfResults: 0, anchors: [] })
    network.mockResolvedValueOnce({
      objects: [include],
      relations: [],
      contexts: [],
      activeContext: "ENV"
    })
    network.mockResolvedValueOnce({
      objects: [include],
      relations: [],
      contexts: [],
      activeContext: "ENV"
    })
    const result = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "references",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type,
          relatedObjectName: target.name,
          relatedObjectType: target.type
        })
      )
    )
    expect(result.numberOfResults).toBe(0)
    expect(result.resolvedSources).toBeUndefined()
    expect(references).toHaveBeenCalledTimes(1)
  })

  it("keeps direct references for non-report roots", async () => {
    references.mockResolvedValue({ numberOfResults: 0, anchors: [] })
    const result = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "references",
          connectionId: "DEV100",
          objectName: target.name,
          objectType: target.type,
          relatedObjectName: report.name,
          relatedObjectType: report.type
        })
      )
    )
    expect(result.numberOfResults).toBe(0)
    expect(network).not.toHaveBeenCalled()
  })

  it("filters relations when the root is the target endpoint", async () => {
    network.mockResolvedValue({
      ...makeNetwork(),
      relations: [
        { id: "incoming", from: target.id, to: report.uri, type: "incoming", properties: [] }
      ]
    })
    const result = parseResult(
      await new RelationAnalysisTool().invoke(
        makeOptions({
          action: "network",
          connectionId: "DEV100",
          objectName: report.name,
          objectType: report.type,
          direction: "used",
          relationTypes: ["incoming"],
          maxResults: 10
        })
      )
    )
    expect(result.relations.items).toEqual([
      expect.objectContaining({ from: target.name, to: report.name, type: "incoming" })
    ])
  })
})
