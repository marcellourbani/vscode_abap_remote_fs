vi.mock("vscode", () => ({
  LanguageModelToolResult: vi.fn().mockImplementation(function (parts: any[]) {
    return { parts }
  }),
  LanguageModelTextPart: vi.fn().mockImplementation(function (text: string) {
    return { text }
  }),
  MarkdownString: vi.fn().mockImplementation(function (text: string) {
    return { text }
  }),
  Uri: {
    parse: vi.fn(function (s: string) {
      const rest = s.split("//")[1] || ""
      const pathStart = rest.indexOf("/")
      return {
        toString: () => s,
        authority: pathStart >= 0 ? rest.slice(0, pathStart) : rest,
        path: pathStart >= 0 ? rest.slice(pathStart) : ""
      }
    })
  },
  ProgressLocation: { Notification: 1 },
  workspace: {
    openTextDocument: vi.fn().mockResolvedValue({}),
    fs: { readFile: vi.fn() }
  },
  lm: {
    registerTool: vi.fn(function () {
      return { dispose: vi.fn() }
    })
  }
}))

vi.mock("../../adt/conections", () => ({
  getOrCreateRoot: vi.fn(),
  abapUri: vi.fn(),
  getClient: vi.fn()
}))
vi.mock("../telemetry", () => ({ logTelemetry: vi.fn() }))
vi.mock("./toolRegistry", () => ({
  registerToolWithRegistry: vi.fn(function () {
    return { dispose: vi.fn() }
  })
}))
vi.mock("../abapSearchService", () => ({ getSearchService: vi.fn() }))
vi.mock("../../adt/packageUri", () => ({ packageUri: vi.fn() }))
vi.mock("../funMessenger", () => ({
  funWindow: {
    activeTextEditor: undefined,
    visibleTextEditors: [],
    showTextDocument: vi.fn(),
    withProgress: vi.fn(function (_opts: any, cb: any) {
      return cb()
    })
  }
}))
vi.mock("../../views/abaptestcockpit", () => ({
  atcProvider: {
    runAnalysis: vi.fn(),
    runInspector: vi.fn(),
    runInspectorByAdtUrl: vi.fn(),
    findings: vi.fn(function () {
      return []
    })
  }
}))
vi.mock("../../views/abaptestcockpit/decorations", () => ({ getATCDecorations: vi.fn() }))
vi.mock("../../views/abaptestcockpit/view", () => ({
  hasExemption: (finding: { exemptionApproval?: string; noExemption?: string }) =>
    !!finding.exemptionApproval && finding.noExemption !== "true"
}))
vi.mock("../../adt/atcVariants", () => ({ listAtcVariants: vi.fn() }))

vi.mock("./toolGuard", () => ({
  assertToolInvocationAuthorized: vi.fn(),
  isToolInvocationAuthorized: vi.fn(function () {
    return true
  })
}))
import { RunATCAnalysisTool, GetATCDecorationsTool } from "./atcTools"
import { getSearchService } from "../abapSearchService"
import { getOrCreateRoot, abapUri, getClient } from "../../adt/conections"
import { logTelemetry } from "../telemetry"
import { funWindow as window } from "../funMessenger"
import { getATCDecorations } from "../../views/abaptestcockpit/decorations"
import { atcProvider } from "../../views/abaptestcockpit"
import { listAtcVariants } from "../../adt/atcVariants"
import { packageUri } from "../../adt/packageUri"
import type { Mock } from "vitest"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

const mockSearcher = { searchObjects: vi.fn() }
const mockRoot = { findByAdtUri: vi.fn() }
const mockClient = {}

describe("RunATCAnalysisTool - prepareInvocation validation", () => {
  let tool: RunATCAnalysisTool

  beforeEach(() => {
    tool = new RunATCAnalysisTool()
    vi.clearAllMocks()
    ;(getSearchService as Mock).mockReturnValue(mockSearcher)
    ;(getOrCreateRoot as Mock).mockResolvedValue(mockRoot)
    ;(getClient as Mock).mockReturnValue(mockClient)
    ;(window as any).activeTextEditor = undefined
  })

  it("throws when objectUri is not a valid ADT URI", async () => {
    await expect(
      tool.prepareInvocation(makeOptions({ objectUri: "http://bad/uri" }), mockToken)
    ).rejects.toThrow("objectUri must be a valid ADT URI")
  })

  it("throws when objectName given without connectionId", async () => {
    await expect(
      tool.prepareInvocation(makeOptions({ objectName: "ZPROG" }), mockToken)
    ).rejects.toThrow("connectionId is required when specifying objectName")
  })

  it("throws when no target and useActiveFile=false", async () => {
    await expect(
      tool.prepareInvocation(makeOptions({ useActiveFile: false }), mockToken)
    ).rejects.toThrow("No target specified")
  })

  it("accepts valid objectUri with adt:// scheme", async () => {
    await expect(
      tool.prepareInvocation(
        makeOptions({ objectUri: "adt://dev100/sap/bc/adt/programs/programs/zprog" }),
        mockToken
      )
    ).resolves.toBeDefined()
  })

  it("accepts objectName with connectionId", async () => {
    await expect(
      tool.prepareInvocation(
        makeOptions({ objectName: "ZPROG", connectionId: "dev100" }),
        mockToken
      )
    ).resolves.toBeDefined()
  })

  it("accepts useActiveFile=true without other params", async () => {
    await expect(
      tool.prepareInvocation(makeOptions({ useActiveFile: true }), mockToken)
    ).resolves.toBeDefined()
  })

  it("returns invocation message with object name", async () => {
    const result = await tool.prepareInvocation(
      makeOptions({ objectName: "ZPROG", connectionId: "dev100" }),
      mockToken
    )
    expect(result.invocationMessage).toContain("ZPROG")
  })

  it("returns invocation message for active file", async () => {
    const result = await tool.prepareInvocation(makeOptions({ useActiveFile: true }), mockToken)
    expect(result.invocationMessage).toContain("active file")
  })

  it("includes scope info when provided", async () => {
    const result = await tool.prepareInvocation(
      makeOptions({ objectName: "ZPROG", connectionId: "dev100", scope: "package" }),
      mockToken
    )
    expect(result.confirmationMessages).toBeDefined()
  })
})

describe("RunATCAnalysisTool - invoke", () => {
  let tool: RunATCAnalysisTool

  beforeEach(() => {
    tool = new RunATCAnalysisTool()
    vi.clearAllMocks()
    ;(getSearchService as Mock).mockReturnValue(mockSearcher)
    ;(getOrCreateRoot as Mock).mockResolvedValue(mockRoot)
    ;(getClient as Mock).mockReturnValue(mockClient)
    ;(window as any).activeTextEditor = undefined
  })

  it("logs telemetry", async () => {
    await tool
      .invoke(
        makeOptions({
          objectUri: "adt://dev100/sap/bc/adt/programs/programs/zprog",
          connectionId: "dev100"
        }),
        mockToken
      )
      .catch(() => {})
    expect(logTelemetry).toHaveBeenCalledWith("tool_run_atc_analysis_called", {
      connectionId: "dev100"
    })
  })

  it("throws when objectUri is not adt:// URI", async () => {
    await expect(
      tool.invoke(makeOptions({ objectUri: "http://bad/uri", connectionId: "dev100" }), mockToken)
    ).rejects.toThrow("ADT URI")
  })

  it("throws when no active editor and useActiveFile=true", async () => {
    ;(window as any).activeTextEditor = undefined
    await expect(tool.invoke(makeOptions({ useActiveFile: true }), mockToken)).rejects.toThrow(
      "No active editor"
    )
  })

  it("throws when active editor is not ABAP", async () => {
    ;(window as any).activeTextEditor = {
      document: { uri: { scheme: "file", authority: "" } }
    }
    ;(abapUri as Mock).mockReturnValue(false)
    await expect(tool.invoke(makeOptions({ useActiveFile: true }), mockToken)).rejects.toThrow(
      "not an ABAP document"
    )
  })

  it("throws when objectName search returns no results", async () => {
    mockSearcher.searchObjects.mockResolvedValue([])
    await expect(
      tool.invoke(makeOptions({ objectName: "MISSING", connectionId: "dev100" }), mockToken)
    ).rejects.toThrow("Could not find ABAP object")
  })

  it("normalizes connectionId to lowercase", async () => {
    await tool
      .invoke(makeOptions({ objectUri: "adt://dev100/path", connectionId: "DEV100" }), mockToken)
      .catch(() => {})
    expect(logTelemetry).toHaveBeenCalledWith("tool_run_atc_analysis_called", {
      connectionId: "DEV100" // connectionId is logged before lowercasing
    })
  })

  it("passes variantName through to atcProvider.runInspector", async () => {
    ;(atcProvider.runInspector as Mock).mockResolvedValue("MYVARIANT")
    await tool.invoke(
      makeOptions({
        objectUri: "adt://dev100/sap/bc/adt/programs/programs/zprog",
        connectionId: "dev100",
        variantName: "MYVARIANT"
      }),
      mockToken
    )
    expect(atcProvider.runInspector).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      "MYVARIANT",
      false,
      expect.any(Function)
    )
  })

  it("calls atcProvider.runInspector with undefined variant when not provided", async () => {
    ;(atcProvider.runInspector as Mock).mockResolvedValue("DEFAULT")
    await tool.invoke(
      makeOptions({
        objectUri: "adt://dev100/sap/bc/adt/programs/programs/zprog",
        connectionId: "dev100"
      }),
      mockToken
    )
    expect(atcProvider.runInspector).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      undefined,
      false,
      expect.any(Function)
    )
    expect(window.withProgress).not.toHaveBeenCalled()
  })

  it("routes package names through the raw ADT URL path silently", async () => {
    ;(packageUri as Mock).mockResolvedValue("/sap/bc/adt/packages/zpkg")
    ;(atcProvider.runInspectorByAdtUrl as Mock).mockResolvedValue("DEFAULT")

    await tool.invoke(
      makeOptions({ objectName: "ZPKG", connectionId: "DEV100", scope: "package" }),
      mockToken
    )

    expect(packageUri).toHaveBeenCalledWith(mockClient, "ZPKG")
    expect(atcProvider.runInspectorByAdtUrl).toHaveBeenCalledWith(
      "/sap/bc/adt/packages/zpkg",
      "dev100",
      undefined,
      false,
      expect.any(Function)
    )
    expect(getSearchService).not.toHaveBeenCalled()
    expect(window.withProgress).not.toHaveBeenCalled()
  })

  it("routes transport names through the raw ADT URL path silently", async () => {
    ;(atcProvider.runInspectorByAdtUrl as Mock).mockResolvedValue("DEFAULT")

    await tool.invoke(
      makeOptions({ objectName: "GEDK933871", connectionId: "DEV100", scope: "transport" }),
      mockToken
    )

    expect(atcProvider.runInspectorByAdtUrl).toHaveBeenCalledWith(
      "/sap/bc/adt/cts/transportrequests/GEDK933871",
      "dev100",
      undefined,
      false,
      expect.any(Function)
    )
    expect(getSearchService).not.toHaveBeenCalled()
    expect(window.withProgress).not.toHaveBeenCalled()
  })

  it("passes showUi through for visible package analysis", async () => {
    ;(packageUri as Mock).mockResolvedValue("/sap/bc/adt/packages/zpkg")
    ;(atcProvider.runInspectorByAdtUrl as Mock).mockResolvedValue("DEFAULT")

    await tool.invoke(
      makeOptions({
        objectName: "ZPKG",
        connectionId: "dev100",
        scope: "package",
        showUi: true
      }),
      mockToken
    )

    expect(atcProvider.runInspectorByAdtUrl).toHaveBeenCalledWith(
      "/sap/bc/adt/packages/zpkg",
      "dev100",
      undefined,
      true,
      expect.any(Function)
    )
    expect(window.withProgress).toHaveBeenCalled()
  })
})

describe("RunATCAnalysisTool - cached pages", () => {
  let tool: RunATCAnalysisTool
  const readResult = async (input: Record<string, unknown>) => {
    const result = (await tool.invoke(makeOptions(input), mockToken)) as any
    return JSON.parse(result.parts[0].text)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    tool = new RunATCAnalysisTool()
    ;(window as any).visibleTextEditors = []
    ;(atcProvider.runInspector as Mock).mockImplementation(async (...args: any[]) => {
      args[4]([
        {
          name: "ZTEST",
          type: "CLAS",
          findings: Array.from({ length: 63 }, (_, index) => ({
            messageTitle: `Finding ${index + 1}`,
            checkTitle: "Check",
            checkId: "CHECK_ID",
            priority: 1,
            exemptionApproval: "-",
            noExemption: index === 62 ? "false" : "true",
            location: { uri: "/source" },
            start: { line: index, character: 0 },
            fileuri: "adt://dev100/source",
            link: { href: "/documentation" }
          }))
        }
      ])
      return "DEFAULT"
    })
  })

  afterEach(() => vi.useRealTimers())

  it("returns bounded one-based pages from the same snapshot without rerunning ATC", async () => {
    const first = await readResult({ objectUri: "adt://dev100/source" })
    expect(first).toMatchObject({
      resultStart: 1,
      resultEnd: 25,
      returned: 25,
      hasMore: true,
      nextStart: 26
    })
    expect(first.summary).toMatchObject({ totalFindings: 63, errors: 63, exempted: 1 })
    expect(first.findings[0].finding).toMatchObject({ hasExemption: false, exemptionStatus: null })
    const second = await readResult({ resultId: first.resultId, resultStart: first.nextStart })
    expect(second).toMatchObject({
      resultId: first.resultId,
      resultStart: 26,
      resultEnd: 50,
      nextStart: 51
    })
    expect(second.findings[0].finding.messageTitle).toBe("Finding 26")
    const last = await readResult({ resultId: first.resultId, resultStart: 51 })
    expect(last).toMatchObject({
      resultStart: 51,
      resultEnd: 63,
      returned: 13,
      hasMore: false,
      nextStart: null
    })
    expect(atcProvider.runInspector).toHaveBeenCalledTimes(1)
    expect(atcProvider.findings).not.toHaveBeenCalled()
  })

  it("can omit detail fields and retrieve them later without mutating the cache", async () => {
    const first = await readResult({
      objectUri: "adt://dev100/source",
      includeUri: false,
      includeDocUri: false,
      includeCheckIds: false
    })
    expect(first.summary).not.toHaveProperty("targetUri")
    expect(first.findings[0].finding.location).not.toHaveProperty("uri")
    expect(first.findings[0].finding).not.toHaveProperty("docUri")
    expect(first.findings[0].finding).not.toHaveProperty("checkId")
    const detailed = await readResult({ resultId: first.resultId, resultStart: 1, resultEnd: 1 })
    expect(detailed.findings[0].finding).toMatchObject({
      docUri: "/documentation",
      checkId: "CHECK_ID",
      location: { uri: "adt://dev100/source" }
    })
  })

  it("rejects missing and expired IDs without running ATC", async () => {
    vi.useFakeTimers()
    const missing = await readResult({ resultId: "missing" })
    expect(missing.error).toBe("ATC_RESULT_EXPIRED")
    expect(atcProvider.runInspector).not.toHaveBeenCalled()
    const first = await readResult({ objectUri: "adt://dev100/source" })
    const initialExpiry = Date.parse(first.expiresAt)
    expect(initialExpiry - Date.now()).toBe(90 * 60 * 1000)
    vi.advanceTimersByTime(89 * 60 * 1000)
    const refreshed = await readResult({ resultId: first.resultId })
    expect(Date.parse(refreshed.expiresAt) - Date.now()).toBe(90 * 60 * 1000)
    vi.advanceTimersByTime(89 * 60 * 1000)
    expect((await readResult({ resultId: first.resultId })).error).toBeUndefined()
    vi.advanceTimersByTime(90 * 60 * 1000)
    const expired = await readResult({ resultId: first.resultId })
    expect(expired.error).toBe("ATC_RESULT_EXPIRED")
    expect(atcProvider.runInspector).toHaveBeenCalledTimes(1)
  })

  it("validates ranges before running ATC", async () => {
    for (const range of [
      { resultStart: 0 },
      { resultStart: 2, resultEnd: 1 },
      { resultEnd: 101 },
      { resultStart: 1.5 }
    ]) {
      await expect(readResult({ objectUri: "adt://dev100/source", ...range })).rejects.toThrow()
    }
    expect(atcProvider.runInspector).not.toHaveBeenCalled()
  })

  it("returns an empty final page beyond the end", async () => {
    const first = await readResult({ objectUri: "adt://dev100/source" })
    const empty = await readResult({ resultId: first.resultId, resultStart: 100 })
    expect(empty).toMatchObject({
      returned: 0,
      resultStart: null,
      resultEnd: null,
      hasMore: false,
      nextStart: null
    })
  })

  it("allows cached preparation without a target and rejects a different connection", async () => {
    expect(
      await tool.prepareInvocation(makeOptions({ resultId: "cached" }), mockToken)
    ).toBeDefined()
    const first = await readResult({ objectUri: "adt://dev100/source" })
    await expect(
      readResult({ resultId: first.resultId, connectionId: "other100" })
    ).rejects.toThrow("different connectionId")
  })

  it("runs a fresh analysis when no resultId is supplied and bounds cache capacity", async () => {
    const first = await readResult({ objectUri: "adt://dev100/source" })
    let latest = first
    for (let index = 0; index < 20; index++) {
      latest = await readResult({ objectUri: "adt://dev100/source" })
    }
    expect(latest.resultId).not.toBe(first.resultId)
    expect((await readResult({ resultId: first.resultId })).error).toBe("ATC_RESULT_EXPIRED")
    expect((await readResult({ resultId: latest.resultId })).returned).toBe(25)
    expect(atcProvider.runInspector).toHaveBeenCalledTimes(21)
  })
})

describe("RunATCAnalysisTool - get_atc_variants action", () => {
  let tool: RunATCAnalysisTool

  beforeEach(() => {
    tool = new RunATCAnalysisTool()
    vi.clearAllMocks()
    ;(getClient as Mock).mockReturnValue({})
  })

  it("returns error text when connectionId is missing", async () => {
    const result: any = await tool.invoke(makeOptions({ action: "get_atc_variants" }), mockToken)
    expect(result.parts[0].text).toContain("requires `connectionId`")
  })

  it("lists variants using default query and maxItems", async () => {
    ;(listAtcVariants as Mock).mockResolvedValue([
      { name: "DEFAULT", description: "Default variant" }
    ])
    const result: any = await tool.invoke(
      makeOptions({ action: "get_atc_variants", connectionId: "dev100" }),
      mockToken
    )
    expect(listAtcVariants).toHaveBeenCalledWith({}, "*", 100)
    expect(result.parts[0].text).toContain("DEFAULT")
  })

  it("passes custom query and maxItems through", async () => {
    ;(listAtcVariants as Mock).mockResolvedValue([])
    await tool.invoke(
      makeOptions({
        action: "get_atc_variants",
        connectionId: "dev100",
        query: "Z*",
        maxItems: 25
      }),
      mockToken
    )
    expect(listAtcVariants).toHaveBeenCalledWith({}, "Z*", 25)
  })

  it("returns a graceful error message when listAtcVariants throws", async () => {
    ;(listAtcVariants as Mock).mockRejectedValue(new Error("404 Not Found"))
    const result: any = await tool.invoke(
      makeOptions({ action: "get_atc_variants", connectionId: "dev100" }),
      mockToken
    )
    expect(result.parts[0].text).toContain("Could not list ATC check variants")
    expect(result.parts[0].text).toContain("404 Not Found")
  })

  it("notes when results are capped at maxItems", async () => {
    ;(listAtcVariants as Mock).mockResolvedValue([{ name: "V1", description: "" }])
    const result: any = await tool.invoke(
      makeOptions({ action: "get_atc_variants", connectionId: "dev100", maxItems: 1 }),
      mockToken
    )
    expect(result.parts[0].text).toContain("capped")
  })
})

describe("GetATCDecorationsTool", () => {
  let tool: GetATCDecorationsTool

  beforeEach(() => {
    tool = new GetATCDecorationsTool()
    vi.clearAllMocks()
  })

  describe("prepareInvocation", () => {
    it("returns invocation message", async () => {
      const result = await tool.prepareInvocation(makeOptions(), mockToken)
      expect(result.invocationMessage).toBeDefined()
    })
  })

  describe("invoke", () => {
    it("logs telemetry", async () => {
      ;(getATCDecorations as Mock).mockReturnValue({ decorations: [] })
      await tool.invoke(makeOptions(), mockToken)
      expect(logTelemetry).toHaveBeenCalledWith("tool_get_atc_decorations_called", {
        connectionId: undefined
      })
    })

    it("returns decorations result", async () => {
      ;(getATCDecorations as Mock).mockReturnValue({
        fileUri: "adt://dev100/path",
        decorations: []
      })
      const result: any = await tool.invoke(makeOptions(), mockToken)
      expect(result.parts[0].text).toBeDefined()
    })

    it("handles empty decorations", async () => {
      ;(getATCDecorations as Mock).mockReturnValue({ decorations: [] })
      const result: any = await tool.invoke(makeOptions(), mockToken)
      expect(result.parts[0].text).toBeDefined()
    })

    it("filters by fileUri when provided", async () => {
      ;(getATCDecorations as Mock).mockReturnValue({
        fileUri: "adt://dev100/path",
        decorations: []
      })
      await tool.invoke(
        makeOptions({ fileUri: "adt://dev100/sap/bc/adt/programs/programs/zprog" }),
        mockToken
      )
      expect(getATCDecorations).toHaveBeenCalledWith(
        "adt://dev100/sap/bc/adt/programs/programs/zprog"
      )
    })

    it("calls getATCDecorations without argument when no fileUri", async () => {
      ;(getATCDecorations as Mock).mockReturnValue({ decorations: [] })
      await tool.invoke(makeOptions(), mockToken)
      expect(getATCDecorations).toHaveBeenCalledWith(undefined)
    })
  })
})
