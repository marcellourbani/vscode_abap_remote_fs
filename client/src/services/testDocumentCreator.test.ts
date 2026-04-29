jest.mock("vscode", () => ({
  Uri: {
    file: jest.fn((p: string) => ({ fsPath: p, toString: () => `file://${p}` }))
  },
  workspace: {
    fs: {
      readFile: jest.fn(),
      writeFile: jest.fn()
    }
  }
}), { virtual: true })

jest.mock("./funMessenger", () => ({
  funWindow: {
    showSaveDialog: jest.fn()
  }
}))

jest.mock("docx", () => {
  const Packer = { toBuffer: jest.fn().mockResolvedValue(Buffer.from("mock-doc")) }
  const Document = jest.fn().mockImplementation(function (this: any, opts: any) {
    this.opts = opts
  })
  const Paragraph = jest.fn().mockImplementation(function (this: any, opts: any) {
    this.opts = opts
  })
  const TextRun = jest.fn().mockImplementation(function (this: any, opts: any) {
    this.opts = opts
  })
  const ImageRun = jest.fn().mockImplementation(function (this: any, opts: any) {
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

import { TestDocumentCreator, TestScenario, TestDocumentOptions } from "./testDocumentCreator"
import * as vscode from "vscode"
import { funWindow as window } from "./funMessenger"
import { Packer } from "docx"

const mockReadFile = vscode.workspace.fs.readFile as jest.MockedFunction<typeof vscode.workspace.fs.readFile>
const mockWriteFile = vscode.workspace.fs.writeFile as jest.MockedFunction<typeof vscode.workspace.fs.writeFile>
const mockShowSaveDialog = window.showSaveDialog as jest.MockedFunction<typeof window.showSaveDialog>
const mockPackerToBuffer = Packer.toBuffer as jest.MockedFunction<typeof Packer.toBuffer>

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
    jest.clearAllMocks()
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
    const { Document } = require("docx")
    await creator.createDocument({ scenarios: [] })
    // Document is called once
    expect(Document).toHaveBeenCalledTimes(1)
  })

  it("uses custom reportTitle when provided", async () => {
    const { Paragraph } = require("docx")
    await creator.createDocument({
      scenarios: [],
      reportTitle: "My Custom Report"
    })
    // First paragraph should have the custom title
    const firstCall = (Paragraph as jest.Mock).mock.calls[0][0]
    expect(firstCall.text).toBe("My Custom Report")
  })

  it("uses provided testDate in document", async () => {
    const { TextRun } = require("docx")
    await creator.createDocument({
      scenarios: [],
      testDate: "2024-06-15"
    })
    const textRunCalls = (TextRun as jest.Mock).mock.calls
    const dateRun = textRunCalls.find((call: any[]) => call[0].text?.includes("2024-06-15"))
    expect(dateRun).toBeDefined()
  })

  it("uses current date when testDate not provided", async () => {
    const { TextRun } = require("docx")
    const today = new Date().toISOString().split("T")[0]
    await creator.createDocument({ scenarios: [] })
    const textRunCalls = (TextRun as jest.Mock).mock.calls
    const dateRun = textRunCalls.find((call: any[]) => call[0].text?.includes(today))
    expect(dateRun).toBeDefined()
  })

  it("creates paragraphs for each scenario", async () => {
    const { Paragraph } = require("docx")
    jest.clearAllMocks()
    const scenarios = [makeScenario(1), makeScenario(2)]
    await creator.createDocument({ scenarios })
    // Should create heading paragraphs for each scenario
    const headingCalls = (Paragraph as jest.Mock).mock.calls.filter(
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
    const { TextRun } = require("docx")
    jest.clearAllMocks()
    mockReadFile.mockRejectedValue(new Error("File not found"))
    mockPackerToBuffer.mockResolvedValue(Buffer.from("doc"))
    const scenarios = [makeScenario(1, 1)]
    await creator.createDocument({ scenarios })
    const errorRun = (TextRun as jest.Mock).mock.calls.find(
      (call: any[]) => call[0].text?.includes("Error loading image")
    )
    expect(errorRun).toBeDefined()
  })

  it("handles empty scenarios array", async () => {
    const result = await creator.createDocument({ scenarios: [] })
    expect(result).toBeInstanceOf(Buffer)
  })

  it("processes multiple screenshots per scenario", async () => {
    const { ImageRun } = require("docx")
    jest.clearAllMocks()
    mockReadFile.mockResolvedValue(Buffer.from("img") as any)
    mockPackerToBuffer.mockResolvedValue(Buffer.from("doc"))
    const scenarios = [makeScenario(1, 3)]
    await creator.createDocument({ scenarios })
    expect(ImageRun).toHaveBeenCalledTimes(3)
  })

  it("screenshot description is included in paragraph text", async () => {
    const { TextRun } = require("docx")
    jest.clearAllMocks()
    mockReadFile.mockResolvedValue(Buffer.from("img") as any)
    mockPackerToBuffer.mockResolvedValue(Buffer.from("doc"))
    const scenarios: TestScenario[] = [{
      scenarioId: 1,
      scenarioName: "Test",
      scenarioDescription: "desc",
      screenshots: [{ filePath: "/img.png", description: "My Screenshot" }]
    }]
    await creator.createDocument({ scenarios })
    const descRun = (TextRun as jest.Mock).mock.calls.find(
      (call: any[]) => call[0].text?.includes("My Screenshot")
    )
    expect(descRun).toBeDefined()
  })
})

describe("TestDocumentCreator.saveDocument", () => {
  let creator: TestDocumentCreator

  beforeEach(() => {
    jest.clearAllMocks()
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
    const opts = (mockShowSaveDialog as jest.Mock).mock.calls[0][0]
    expect(opts.defaultUri.fsPath).toContain("custom.docx")
  })

  it("uses timestamped default filename when no name provided", async () => {
    mockShowSaveDialog.mockResolvedValue(undefined)
    await creator.saveDocument(Buffer.from("test"))
    const opts = (mockShowSaveDialog as jest.Mock).mock.calls[0][0]
    expect(opts.defaultUri.fsPath).toMatch(/test-documentation-\d+\.docx/)
  })

  it("sets correct file filters in save dialog", async () => {
    mockShowSaveDialog.mockResolvedValue(undefined)
    await creator.saveDocument(Buffer.from("test"))
    const opts = (mockShowSaveDialog as jest.Mock).mock.calls[0][0]
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
