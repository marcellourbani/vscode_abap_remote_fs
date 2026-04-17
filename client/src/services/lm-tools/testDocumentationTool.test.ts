jest.mock("vscode", () => ({
  LanguageModelToolResult: jest.fn().mockImplementation((parts: any[]) => ({ parts })),
  LanguageModelTextPart: jest.fn().mockImplementation((text: string) => ({ text })),
  MarkdownString: jest.fn().mockImplementation((value: string) => ({ value })),
  CancellationTokenSource: jest.fn().mockImplementation(() => ({
    token: { isCancellationRequested: false, onCancellationRequested: jest.fn() }
  })),
  lm: { registerTool: jest.fn(() => ({ dispose: jest.fn() })) },
  window: { activeTextEditor: undefined },
  workspace: {
    workspaceFolders: [],
    getConfiguration: jest.fn(() => ({ get: jest.fn() }))
  },
  Uri: {
    parse: (s: string) => ({ authority: s.split("/")[2] || "", path: s, scheme: "adt", toString: () => s }),
    file: (s: string) => ({ fsPath: s, scheme: "file", toString: () => `file://${s}` })
  },
  env: { openExternal: jest.fn() },
  debug: { activeDebugSession: undefined }
}), { virtual: true })

jest.mock("../../adt/conections", () => ({
  getClient: jest.fn(),
  abapUri: jest.fn()
}))
jest.mock("../telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("../funMessenger", () => ({
  funWindow: {
    activeTextEditor: undefined,
    showQuickPick: jest.fn(),
    showInformationMessage: jest.fn(),
    showWarningMessage: jest.fn()
  }
}))
jest.mock("./toolRegistry", () => ({ registerToolWithRegistry: jest.fn(() => ({ dispose: jest.fn() })) }))
jest.mock("../abapCopilotLogger", () => ({ logCommands: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }))

const mockCreateDocument = jest.fn().mockResolvedValue(Buffer.from("test"))
const mockSaveDocument = jest.fn().mockResolvedValue("/path/to/doc.docx")

jest.mock("../testDocumentCreator", () => ({
  TestDocumentCreator: jest.fn().mockImplementation(() => ({
    createDocument: mockCreateDocument,
    saveDocument: mockSaveDocument
  }))
}))

import { CreateTestDocumentationTool } from "./testDocumentationTool"
import { TestDocumentCreator } from "../testDocumentCreator"
import { logTelemetry } from "../telemetry"
import { funWindow as window } from "../funMessenger"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

function makeScenarios(count: number, screenshotsPerScenario: number = 2) {
  return Array.from({ length: count }, (_, i) => ({
    scenarioId: i + 1,
    scenarioName: `Scenario ${i + 1}`,
    scenarioDescription: `Description for scenario ${i + 1}`,
    screenshots: Array.from({ length: screenshotsPerScenario }, (_, j) => ({
      filePath: `C:\\screenshots\\scenario${i + 1}_step${j + 1}.png`,
      description: `Step ${j + 1} of scenario ${i + 1}`
    }))
  }))
}

describe("CreateTestDocumentationTool", () => {
  let tool: CreateTestDocumentationTool

  beforeEach(() => {
    tool = new CreateTestDocumentationTool()
    jest.clearAllMocks()
    mockCreateDocument.mockResolvedValue(Buffer.from("test"))
    mockSaveDocument.mockResolvedValue("/path/to/doc.docx")
  })

  describe("prepareInvocation", () => {
    it("counts scenarios correctly", async () => {
      const scenarios = makeScenarios(3)
      const result: any = await tool.prepareInvocation(
        makeOptions({ scenarios }),
        mockToken
      )
      expect(result.invocationMessage).toContain("3 scenarios")
    })

    it("counts total screenshots across all scenarios", async () => {
      const scenarios = makeScenarios(2, 3) // 2 scenarios, 3 screenshots each = 6 total
      const result: any = await tool.prepareInvocation(
        makeOptions({ scenarios }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.value).toContain("6 screenshot(s)")
    })

    it("counts zero screenshots when scenarios have none", async () => {
      const scenarios = makeScenarios(2, 0)
      const result: any = await tool.prepareInvocation(
        makeOptions({ scenarios }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.value).toContain("0 screenshot(s)")
    })

    it("includes reportTitle in confirmation when provided", async () => {
      const scenarios = makeScenarios(1)
      const result: any = await tool.prepareInvocation(
        makeOptions({ scenarios, reportTitle: "My Test Report" }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.value).toContain("My Test Report")
    })

    it("does not include title section when reportTitle is omitted", async () => {
      const scenarios = makeScenarios(1)
      const result: any = await tool.prepareInvocation(
        makeOptions({ scenarios }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.value).not.toContain("Title:")
    })

    it("includes testDate in confirmation when provided", async () => {
      const scenarios = makeScenarios(1)
      const result: any = await tool.prepareInvocation(
        makeOptions({ scenarios, testDate: "15-04-2026" }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.value).toContain("15-04-2026")
    })

    it("handles single scenario with single screenshot", async () => {
      const scenarios = makeScenarios(1, 1)
      const result: any = await tool.prepareInvocation(
        makeOptions({ scenarios }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.value).toContain("1 scenario(s)")
      expect((result.confirmationMessages as any).message.value).toContain("1 screenshot(s)")
    })
  })

  describe("invoke", () => {
    it("logs telemetry", async () => {
      const scenarios = makeScenarios(1)
      await tool.invoke(makeOptions({ scenarios }), mockToken)
      expect(logTelemetry).toHaveBeenCalledWith("tool_create_test_documentation_called")
    })

    it("creates TestDocumentCreator instance", async () => {
      const scenarios = makeScenarios(1)
      await tool.invoke(makeOptions({ scenarios }), mockToken)
      expect(TestDocumentCreator).toHaveBeenCalled()
    })

    it("calls createDocument with correct params", async () => {
      const scenarios = makeScenarios(2, 3)
      await tool.invoke(
        makeOptions({ scenarios, reportTitle: "Report Title", testDate: "15-04-2026" }),
        mockToken
      )
      expect(mockCreateDocument).toHaveBeenCalledWith({
        scenarios,
        reportTitle: "Report Title",
        testDate: "15-04-2026"
      })
    })

    it("calls saveDocument after createDocument", async () => {
      const scenarios = makeScenarios(1)
      await tool.invoke(
        makeOptions({ scenarios, reportTitle: "My Report" }),
        mockToken
      )
      expect(mockCreateDocument).toHaveBeenCalled()
      expect(mockSaveDocument).toHaveBeenCalledWith(
        expect.any(Buffer),
        "My_Report.docx"
      )
    })

    it("uses default filename when reportTitle is not provided", async () => {
      const scenarios = makeScenarios(1)
      await tool.invoke(makeOptions({ scenarios }), mockToken)
      expect(mockSaveDocument).toHaveBeenCalledWith(
        expect.any(Buffer),
        undefined
      )
    })

    it("sanitizes reportTitle for filename", async () => {
      const scenarios = makeScenarios(1)
      await tool.invoke(
        makeOptions({ scenarios, reportTitle: "My Report: Test/2026" }),
        mockToken
      )
      expect(mockSaveDocument).toHaveBeenCalledWith(
        expect.any(Buffer),
        "My_Report__Test_2026.docx"
      )
    })

    it("returns result with scenario count", async () => {
      const scenarios = makeScenarios(3, 2)
      const result: any = await tool.invoke(makeOptions({ scenarios }), mockToken)
      expect(result.parts[0].text).toContain("Scenarios:** 3")
      expect(result.parts[0].text).toContain("Total Screenshots:** 6")
    })

    it("returns result with saved path", async () => {
      mockSaveDocument.mockResolvedValue("/my/path/report.docx")
      const scenarios = makeScenarios(1)
      const result: any = await tool.invoke(makeOptions({ scenarios }), mockToken)
      expect(result.parts[0].text).toContain("/my/path/report.docx")
    })

    it("shows information message with Open File option", async () => {
      mockSaveDocument.mockResolvedValue("/path/to/doc.docx")
      ;(window.showInformationMessage as jest.Mock).mockResolvedValue(undefined)

      const scenarios = makeScenarios(1)
      await tool.invoke(makeOptions({ scenarios }), mockToken)
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining("/path/to/doc.docx"),
        "Open File"
      )
    })

    it("uses default reportTitle in result when not provided", async () => {
      const scenarios = makeScenarios(1)
      const result: any = await tool.invoke(makeOptions({ scenarios }), mockToken)
      expect(result.parts[0].text).toContain("Test Documentation Report")
    })

    it("includes scenario breakdown in result", async () => {
      const scenarios = makeScenarios(2, 3)
      const result: any = await tool.invoke(makeOptions({ scenarios }), mockToken)
      expect(result.parts[0].text).toContain("Scenario 1")
      expect(result.parts[0].text).toContain("Scenario 2")
      expect(result.parts[0].text).toContain("3 screenshots")
    })

    it("handles empty scenarios array", async () => {
      const result: any = await tool.invoke(makeOptions({ scenarios: [] }), mockToken)
      expect(result.parts[0].text).toContain("Scenarios:** 0")
      expect(result.parts[0].text).toContain("Total Screenshots:** 0")
    })

    it("handles scenario with no screenshots", async () => {
      const scenarios = makeScenarios(1, 0)
      const result: any = await tool.invoke(makeOptions({ scenarios }), mockToken)
      expect(result.parts[0].text).toContain("0 screenshots")
    })

    it("throws with descriptive error when createDocument fails", async () => {
      mockCreateDocument.mockRejectedValue(new Error("Disk full"))
      const scenarios = makeScenarios(1)

      await expect(
        tool.invoke(makeOptions({ scenarios }), mockToken)
      ).rejects.toThrow("Failed to create test documentation: Disk full")
    })

    it("throws with docx install hint when module not found", async () => {
      mockCreateDocument.mockRejectedValue(new Error("Cannot find module 'docx'"))
      const scenarios = makeScenarios(1)

      await expect(
        tool.invoke(makeOptions({ scenarios }), mockToken)
      ).rejects.toThrow("npm install docx")
    })

    it("handles non-Error thrown values", async () => {
      mockCreateDocument.mockRejectedValue("string error")
      const scenarios = makeScenarios(1)

      await expect(
        tool.invoke(makeOptions({ scenarios }), mockToken)
      ).rejects.toThrow("string error")
    })

    it("handles very long report title", async () => {
      const longTitle = "A".repeat(500)
      const scenarios = makeScenarios(1)
      const result: any = await tool.invoke(
        makeOptions({ scenarios, reportTitle: longTitle }),
        mockToken
      )
      expect(result.parts[0].text).toContain(longTitle)
      // Also verify filename sanitization still works
      expect(mockSaveDocument).toHaveBeenCalledWith(
        expect.any(Buffer),
        `${"A".repeat(500)}.docx`
      )
    })

    it("handles null savedPath gracefully", async () => {
      mockSaveDocument.mockResolvedValue(null)
      const scenarios = makeScenarios(1)

      const result: any = await tool.invoke(makeOptions({ scenarios }), mockToken)
      // Should still succeed but not show path
      expect(result.parts[0].text).toContain("Successfully")
    })
  })
})
