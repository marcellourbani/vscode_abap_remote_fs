vi.mock("vscode", () => ({
  Uri: {
    file: vi.fn(function (p: string) {
      return { fsPath: p, toString: () => `file://${p}` }
    })
  },
  workspace: {
    fs: {
      readFile: vi.fn(),
      writeFile: vi.fn()
    }
  }
}))

vi.mock("./funMessenger", () => ({
  funWindow: {
    showSaveDialog: vi.fn()
  }
}))

vi.mock("docx", () => {
  const Packer = { toBuffer: vi.fn().mockResolvedValue(Buffer.from("mock-doc")) }
  const Document = vi.fn().mockImplementation(function (this: any, opts: any) {
    this.opts = opts
  })
  const Paragraph = vi.fn().mockImplementation(function (this: any, opts: any) {
    this.opts = opts
  })
  const TextRun = vi.fn().mockImplementation(function (this: any, opts: any) {
    this.opts = opts
  })
  const ImageRun = vi.fn().mockImplementation(function (this: any, opts: any) {
    this.opts = opts
  })
  const HeadingLevel = {
    TITLE: "TITLE",
    HEADING_1: "HEADING_1",
    HEADING_2: "HEADING_2"
  }
  const AlignmentType = { CENTER: "CENTER", LEFT: "LEFT" }
  return { Packer, Document, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType }
})

import {
  TestDocumentCreator,
  type TestScenario,
  type TestDocumentOptions
} from "./testDocumentCreator"
import * as vscode from "vscode"
import { funWindow as window } from "./funMessenger"
import { Packer } from "docx"
import * as __$mock_docx from "docx"
import type { MockedFunction, Mock } from "vitest"

const mockReadFile = vscode.workspace.fs.readFile as MockedFunction<
  typeof vscode.workspace.fs.readFile
>
const mockWriteFile = vscode.workspace.fs.writeFile as MockedFunction<
  typeof vscode.workspace.fs.writeFile
>
const mockShowSaveDialog = window.showSaveDialog as MockedFunction<typeof window.showSaveDialog>
const mockPackerToBuffer = Packer.toBuffer as MockedFunction<typeof Packer.toBuffer>

const makeScenario = (id = 1, numScreenshots = 1): TestScenario => ({
  scenarioId: id,
  scenarioName: `Scenario ${id}`,
  scenarioDescription: `Description for scenario ${id}`,
  screenshots: Array.from({ length: numScreenshots }, (_, i) => ({
    filePath: `/tmp/screenshot${i}.png`,
    description: `Screenshot ${i + 1}`
  }))
})

describe("TestDocumentCreator.createDocument", () => {
  let creator: TestDocumentCreator

  beforeEach(() => {
    vi.clearAllMocks()
    creator = new TestDocumentCreator()
    mockReadFile.mockResolvedValue(Buffer.from("fake-image-data") as any)
  })

  it("returns a Buffer", async () => {
    const result = await creator.createDocument({ scenarios: [makeScenario()] })
    expect(result).toBeInstanceOf(Buffer)
  })

  it("calls Packer.toBuffer to generate document", async () => {
    await creator.createDocument({ scenarios: [makeScenario()] })
    expect(mockPackerToBuffer).toHaveBeenCalled()
  })

  it("uses default reportTitle when not provided", async () => {
    const { Document } = __$mock_docx
    await creator.createDocument({ scenarios: [] })
    // Document is called once
    expect(Document).toHaveBeenCalledTimes(1)
  })

  it("uses custom reportTitle when provided", async () => {
    const { Paragraph } = __$mock_docx
    await creator.createDocument({
      scenarios: [],
      reportTitle: "My Custom Report"
    })
    // First paragraph should have the custom title
    const firstCall = (Paragraph as Mock).mock.calls[0][0]
    expect(firstCall.text).toBe("My Custom Report")
  })

  it("uses provided testDate in document", async () => {
    const { TextRun } = __$mock_docx
    await creator.createDocument({
      scenarios: [],
      testDate: "2024-06-15"
    })
    const textRunCalls = (TextRun as Mock).mock.calls
    const dateRun = textRunCalls.find((call: any[]) => call[0].text?.includes("2024-06-15"))
    expect(dateRun).toBeDefined()
  })

  it("uses current date when testDate not provided", async () => {
    const { TextRun } = __$mock_docx
    const today = new Date().toISOString().split("T")[0]
    await creator.createDocument({ scenarios: [] })
    const textRunCalls = (TextRun as Mock).mock.calls
    const dateRun = textRunCalls.find((call: any[]) => call[0].text?.includes(today))
    expect(dateRun).toBeDefined()
  })

  it("creates paragraphs for each scenario", async () => {
    const { Paragraph } = __$mock_docx
    vi.clearAllMocks()
    const scenarios = [makeScenario(1), makeScenario(2)]
    await creator.createDocument({ scenarios })
    // Should create heading paragraphs for each scenario
    const headingCalls = (Paragraph as Mock).mock.calls.filter(
      (call: any[]) => call[0].heading === "HEADING_1"
    )
    expect(headingCalls.length).toBe(2)
  })

  it("reads image files for screenshots", async () => {
    const scenarios = [makeScenario(1, 2)]
    await creator.createDocument({ scenarios })
    expect(mockReadFile).toHaveBeenCalledTimes(2)
  })

  it("handles image read errors gracefully without throwing", async () => {
    mockReadFile.mockRejectedValue(new Error("File not found"))
    const scenarios = [makeScenario(1, 1)]
    await expect(creator.createDocument({ scenarios })).resolves.toBeInstanceOf(Buffer)
  })

  it("adds error paragraph when image fails to load", async () => {
    const { TextRun } = __$mock_docx
    vi.clearAllMocks()
    mockReadFile.mockRejectedValue(new Error("File not found"))
    mockPackerToBuffer.mockResolvedValue(Buffer.from("doc"))
    const scenarios = [makeScenario(1, 1)]
    await creator.createDocument({ scenarios })
    const errorRun = (TextRun as Mock).mock.calls.find((call: any[]) =>
      call[0].text?.includes("Error loading image")
    )
    expect(errorRun).toBeDefined()
  })

  it("handles empty scenarios array", async () => {
    const result = await creator.createDocument({ scenarios: [] })
    expect(result).toBeInstanceOf(Buffer)
  })

  it("processes multiple screenshots per scenario", async () => {
    const { ImageRun } = __$mock_docx
    vi.clearAllMocks()
    mockReadFile.mockResolvedValue(Buffer.from("img") as any)
    mockPackerToBuffer.mockResolvedValue(Buffer.from("doc"))
    const scenarios = [makeScenario(1, 3)]
    await creator.createDocument({ scenarios })
    expect(ImageRun).toHaveBeenCalledTimes(3)
  })

  it("screenshot description is included in paragraph text", async () => {
    const { TextRun } = __$mock_docx
    vi.clearAllMocks()
    mockReadFile.mockResolvedValue(Buffer.from("img") as any)
    mockPackerToBuffer.mockResolvedValue(Buffer.from("doc"))
    const scenarios: TestScenario[] = [
      {
        scenarioId: 1,
        scenarioName: "Test",
        scenarioDescription: "desc",
        screenshots: [{ filePath: "/img.png", description: "My Screenshot" }]
      }
    ]
    await creator.createDocument({ scenarios })
    const descRun = (TextRun as Mock).mock.calls.find((call: any[]) =>
      call[0].text?.includes("My Screenshot")
    )
    expect(descRun).toBeDefined()
  })
})

describe("TestDocumentCreator.saveDocument", () => {
  let creator: TestDocumentCreator

  beforeEach(() => {
    vi.clearAllMocks()
    creator = new TestDocumentCreator()
  })

  it("returns null when user cancels save dialog", async () => {
    mockShowSaveDialog.mockResolvedValue(undefined)
    const result = await creator.saveDocument(Buffer.from("test"))
    expect(result).toBeNull()
  })

  it("returns saved file path when user selects a location", async () => {
    const saveUri = { fsPath: "/output/report.docx" }
    mockShowSaveDialog.mockResolvedValue(saveUri as any)
    mockWriteFile.mockResolvedValue(undefined)

    const result = await creator.saveDocument(Buffer.from("test"), "report.docx")
    expect(result).toBe("/output/report.docx")
    expect(mockWriteFile).toHaveBeenCalledWith(saveUri, expect.any(Buffer))
  })

  it("uses provided defaultFileName in save dialog", async () => {
    mockShowSaveDialog.mockResolvedValue(undefined)
    await creator.saveDocument(Buffer.from("test"), "custom.docx")
    const opts = (mockShowSaveDialog as Mock).mock.calls[0][0]
    expect(opts.defaultUri.fsPath).toContain("custom.docx")
  })

  it("uses timestamped default filename when no name provided", async () => {
    mockShowSaveDialog.mockResolvedValue(undefined)
    await creator.saveDocument(Buffer.from("test"))
    const opts = (mockShowSaveDialog as Mock).mock.calls[0][0]
    expect(opts.defaultUri.fsPath).toMatch(/test-documentation-\d+\.docx/)
  })

  it("sets correct file filters in save dialog", async () => {
    mockShowSaveDialog.mockResolvedValue(undefined)
    await creator.saveDocument(Buffer.from("test"))
    const opts = (mockShowSaveDialog as Mock).mock.calls[0][0]
    expect(opts.filters["Word Documents"]).toEqual(["docx"])
  })
})

describe("TestDocumentOptions interface", () => {
  it("accepts minimum required fields", () => {
    const opts: TestDocumentOptions = { scenarios: [] }
    expect(opts.scenarios).toEqual([])
    expect(opts.reportTitle).toBeUndefined()
    expect(opts.testDate).toBeUndefined()
  })

  it("accepts all optional fields", () => {
    const opts: TestDocumentOptions = {
      scenarios: [makeScenario()],
      reportTitle: "Title",
      testDate: "2024-01-01"
    }
    expect(opts.reportTitle).toBe("Title")
    expect(opts.testDate).toBe("2024-01-01")
  })
})
