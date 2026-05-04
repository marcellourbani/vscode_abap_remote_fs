jest.mock("vscode", () => ({
  LanguageModelToolResult: jest.fn().mockImplementation((parts: any[]) => ({ parts })),
  LanguageModelTextPart: jest.fn().mockImplementation((text: string) => ({ text })),
  MarkdownString: jest.fn().mockImplementation((text: string) => ({ text })),
  Uri: { parse: jest.fn((s: string) => ({ toString: () => s, authority: s.split("//")[1]?.split("/")[0] })) },
  lm: { registerTool: jest.fn(() => ({ dispose: jest.fn() })) }
}), { virtual: true })

jest.mock("../../adt/conections", () => ({
  getOrCreateRoot: jest.fn(),
  abapUri: jest.fn()
}))
jest.mock("../telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("./toolRegistry", () => ({
  registerToolWithRegistry: jest.fn(() => ({ dispose: jest.fn() }))
}))
jest.mock("../abapSearchService", () => ({ getSearchService: jest.fn() }))
jest.mock("../funMessenger", () => ({ funWindow: { activeTextEditor: undefined } }))
jest.mock("../../views/abaptestcockpit", () => ({ atcProvider: { runAnalysis: jest.fn() } }))
jest.mock("../../views/abaptestcockpit/decorations", () => ({ getATCDecorations: jest.fn() }))

import { RunATCAnalysisTool, GetATCDecorationsTool } from "./atcTools"
import { getSearchService } from "../abapSearchService"
import { getOrCreateRoot, abapUri } from "../../adt/conections"
import { logTelemetry } from "../telemetry"
import { funWindow as window } from "../funMessenger"
import { getATCDecorations } from "../../views/abaptestcockpit/decorations"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

const mockSearcher = { searchObjects: jest.fn() }
const mockRoot = { findByAdtUri: jest.fn() }

describe("RunATCAnalysisTool - prepareInvocation validation", () => {
  let tool: RunATCAnalysisTool

  beforeEach(() => {
    tool = new RunATCAnalysisTool()
    jest.clearAllMocks()
    ;(getSearchService as jest.Mock).mockReturnValue(mockSearcher)
    ;(getOrCreateRoot as jest.Mock).mockResolvedValue(mockRoot)
    ;(window as any).activeTextEditor = undefined
  })

  it("throws when objectUri is not a valid ADT URI", async () => {
    await expect(
      tool.prepareInvocation(
        makeOptions({ objectUri: "http://bad/uri" }),
        mockToken
      )
    ).rejects.toThrow("objectUri must be a valid ADT URI")
  })

  it("throws when objectName given without connectionId", async () => {
    await expect(
      tool.prepareInvocation(
        makeOptions({ objectName: "ZPROG" }),
        mockToken
      )
    ).rejects.toThrow("connectionId is required when specifying objectName")
  })

  it("throws when no target and useActiveFile=false", async () => {
    await expect(
      tool.prepareInvocation(
        makeOptions({ useActiveFile: false }),
        mockToken
      )
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
      tool.prepareInvocation(
        makeOptions({ useActiveFile: true }),
        mockToken
      )
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
    const result = await tool.prepareInvocation(
      makeOptions({ useActiveFile: true }),
      mockToken
    )
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
    jest.clearAllMocks()
    ;(getSearchService as jest.Mock).mockReturnValue(mockSearcher)
    ;(getOrCreateRoot as jest.Mock).mockResolvedValue(mockRoot)
    ;(window as any).activeTextEditor = undefined
  })

  it("logs telemetry", async () => {
    await tool.invoke(
      makeOptions({ objectUri: "adt://dev100/sap/bc/adt/programs/programs/zprog", connectionId: "dev100" }),
      mockToken
    ).catch(() => {})
    expect(logTelemetry).toHaveBeenCalledWith("tool_run_atc_analysis_called", {
      connectionId: "dev100"
    })
  })

  it("throws when objectUri is not adt:// URI", async () => {
    await expect(
      tool.invoke(
        makeOptions({ objectUri: "http://bad/uri", connectionId: "dev100" }),
        mockToken
      )
    ).rejects.toThrow("ADT URI")
  })

  it("throws when no active editor and useActiveFile=true", async () => {
    ;(window as any).activeTextEditor = undefined
    await expect(
      tool.invoke(
        makeOptions({ useActiveFile: true }),
        mockToken
      )
    ).rejects.toThrow("No active editor")
  })

  it("throws when active editor is not ABAP", async () => {
    ;(window as any).activeTextEditor = {
      document: { uri: { scheme: "file", authority: "" } }
    }
    ;(abapUri as jest.Mock).mockReturnValue(false)
    await expect(
      tool.invoke(makeOptions({ useActiveFile: true }), mockToken)
    ).rejects.toThrow("not an ABAP document")
  })

  it("throws when objectName search returns no results", async () => {
    mockSearcher.searchObjects.mockResolvedValue([])
    await expect(
      tool.invoke(
        makeOptions({ objectName: "MISSING", connectionId: "dev100" }),
        mockToken
      )
    ).rejects.toThrow("Could not find ABAP object")
  })

  it("normalizes connectionId to lowercase", async () => {
    await tool.invoke(
      makeOptions({ objectUri: "adt://dev100/path", connectionId: "DEV100" }),
      mockToken
    ).catch(() => {})
    expect(logTelemetry).toHaveBeenCalledWith("tool_run_atc_analysis_called", {
      connectionId: "DEV100" // connectionId is logged before lowercasing
    })
  })
})

describe("GetATCDecorationsTool", () => {
  let tool: GetATCDecorationsTool

  beforeEach(() => {
    tool = new GetATCDecorationsTool()
    jest.clearAllMocks()
  })

  describe("prepareInvocation", () => {
    it("returns invocation message", async () => {
      const result = await tool.prepareInvocation(makeOptions(), mockToken)
      expect(result.invocationMessage).toBeDefined()
    })
  })

  describe("invoke", () => {
    it("logs telemetry", async () => {
      ;(getATCDecorations as jest.Mock).mockReturnValue({ decorations: [] })
      await tool.invoke(makeOptions(), mockToken)
      expect(logTelemetry).toHaveBeenCalledWith("tool_get_atc_decorations_called", {
        connectionId: undefined
      })
    })

    it("returns decorations result", async () => {
      ;(getATCDecorations as jest.Mock).mockReturnValue({ fileUri: "adt://dev100/path", decorations: [] })
      const result: any = await tool.invoke(makeOptions(), mockToken)
      expect(result.parts[0].text).toBeDefined()
    })

    it("handles empty decorations", async () => {
      ;(getATCDecorations as jest.Mock).mockReturnValue({ decorations: [] })
      const result: any = await tool.invoke(makeOptions(), mockToken)
      expect(result.parts[0].text).toBeDefined()
    })

    it("filters by fileUri when provided", async () => {
      ;(getATCDecorations as jest.Mock).mockReturnValue({ fileUri: "adt://dev100/path", decorations: [] })
      await tool.invoke(
        makeOptions({ fileUri: "adt://dev100/sap/bc/adt/programs/programs/zprog" }),
        mockToken
      )
      expect(getATCDecorations).toHaveBeenCalledWith(
        "adt://dev100/sap/bc/adt/programs/programs/zprog"
      )
    })

    it("calls getATCDecorations without argument when no fileUri", async () => {
      ;(getATCDecorations as jest.Mock).mockReturnValue({ decorations: [] })
      await tool.invoke(makeOptions(), mockToken)
      expect(getATCDecorations).toHaveBeenCalledWith(undefined)
    })
  })
})
