import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { vi } from "vitest"

const mocks = vi.hoisted(() => ({
  configuration: { autoSave: "off", chatSaveBeforeSend: false },
  writeFile: vi.fn(),
  applyEdit: vi.fn(),
  openTextDocument: vi.fn(),
  showTextDocument: vi.fn(),
  showInformationMessage: vi.fn(),
  showQuickPick: vi.fn(),
  executeCommand: vi.fn(),
  replace: vi.fn(),
  downloadSide: vi.fn(),
  selectedRecords: vi.fn(),
  sourceAggregateHash: "source-hash"
}))

vi.mock("vscode", () => ({
  Uri: {
    file: vi.fn((fsPath: string) => ({ scheme: "file", fsPath, path: fsPath })),
    joinPath: vi.fn((base: any, ...parts: string[]) => ({
      ...base,
      path: [base.path, ...parts].join("/")
    }))
  },
  Range: class {
    constructor(
      readonly start: unknown,
      readonly end: unknown
    ) {}
  },
  WorkspaceEdit: class {
    replace = mocks.replace
  },
  CancellationTokenSource: class {
    token = { isCancellationRequested: false }
    dispose() {}
  },
  workspace: {
    getConfiguration: vi.fn((section: string) => ({
      get: vi.fn((key: string, fallback: unknown) => {
        if (section === "files" && key === "autoSave") return mocks.configuration.autoSave
        if (section === "chat" && key === "saveBeforeSend")
          return mocks.configuration.chatSaveBeforeSend
        return fallback
      })
    })),
    fs: { writeFile: mocks.writeFile },
    applyEdit: mocks.applyEdit,
    openTextDocument: mocks.openTextDocument
  },
  window: {
    showTextDocument: mocks.showTextDocument,
    showInformationMessage: mocks.showInformationMessage,
    showQuickPick: mocks.showQuickPick
  },
  commands: { executeCommand: mocks.executeCommand }
}))
vi.mock("../abapResourceDownloadService", () => ({
  resolveAbapResource: vi.fn().mockResolvedValue({
    scheme: "adt",
    authority: "target100",
    path: "/target/resource"
  })
}))
vi.mock("./snapshotService", () => ({
  WorkflowSnapshotService: vi.fn(function () {
    return {
      downloadSide: mocks.downloadSide,
      selectedRecords: mocks.selectedRecords
    }
  }),
  objectFolderId: vi.fn(() => "id"),
  listFiles: vi.fn().mockResolvedValue([]),
  aggregateHash: vi.fn(() => mocks.sourceAggregateHash)
}))

import { WorkflowAssistedApplyService } from "./assistedApplyService"
import { resolveAbapResource } from "../abapResourceDownloadService"

let root = ""
let comparisonChanged = ["resource"]
const workflow = {
  workflowId: "wf",
  source: { connectionId: "source100" },
  target: { connectionId: "target100" }
}

function store() {
  return {
    get: vi.fn().mockResolvedValue(workflow),
    artifactPath: vi.fn((_workflow: unknown, ...parts: string[]) => path.join(root, ...parts)),
    readJsonLines: vi.fn(async function* () {
      yield {
        key: "R3TR:PROG:ZTEST",
        status: "different",
        added: [],
        removed: [],
        changed: comparisonChanged
      }
    }),
    writeJson: vi.fn(),
    appendJsonLine: vi.fn()
  } as any
}

describe("WorkflowAssistedApplyService", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    root = await fs.mkdtemp(path.join(os.tmpdir(), "assisted-apply-"))
    mocks.configuration.autoSave = "off"
    mocks.configuration.chatSaveBeforeSend = false
    mocks.sourceAggregateHash = "source-hash"
    comparisonChanged = ["resource"]
    mocks.selectedRecords.mockResolvedValue({ source: [], target: [{ objectName: "ZTEST" }] })
    mocks.downloadSide.mockResolvedValue(undefined)
    const sourceRoot = path.join(root, "sources", "source", "objects", "id")
    const targetRoot = path.join(root, "sources", "target", "objects", "id")
    await fs.mkdir(path.join(sourceRoot, "content"), { recursive: true })
    await fs.mkdir(targetRoot, { recursive: true })
    await fs.writeFile(path.join(sourceRoot, "content", "resource"), "REPORT ztest.\n")
    await fs.writeFile(
      path.join(sourceRoot, "manifest.json"),
      JSON.stringify({ files: [{ path: "resource", text: true }] })
    )
    await fs.writeFile(
      path.join(targetRoot, "manifest.json"),
      JSON.stringify({ aggregateHash: "target-hash" })
    )
    await fs.mkdir(path.join(root, "assisted-apply"), { recursive: true })
    await fs.writeFile(
      path.join(root, "assisted-apply", "plan.json"),
      JSON.stringify({
        sourceConnectionId: "source100",
        targetConnectionId: "target100",
        items: [
          {
            key: "R3TR:PROG:ZTEST",
            eligible: true,
            blockingReasons: [],
            sourceHash: "source-hash",
            targetHash: "target-hash",
            targetRecord: { objectName: "ZTEST", objectType: "PROG" },
            sourceRecord: { objectName: "ZTEST", objectType: "PROG" }
          }
        ]
      })
    )
    const document = {
      isDirty: false,
      getText: vi.fn(() => "REPORT old."),
      positionAt: vi.fn((offset: number) => ({ offset }))
    }
    mocks.openTextDocument.mockResolvedValue(document)
    mocks.applyEdit.mockImplementation(async () => {
      document.isDirty = true
      return true
    })
  })

  afterEach(async () => fs.rm(root, { recursive: true, force: true }))

  it("stages source only in a dirty target editor", async () => {
    const service = new WorkflowAssistedApplyService(store())
    await service.stageInTargetEditor("wf", "R3TR:PROG:ZTEST")

    expect(mocks.replace).toHaveBeenCalledWith(
      expect.objectContaining({ scheme: "adt" }),
      expect.anything(),
      "REPORT ztest.\n"
    )
    expect(mocks.applyEdit).toHaveBeenCalledTimes(1)
    expect(mocks.writeFile).not.toHaveBeenCalled()
    expect(mocks.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ isDirty: true }),
      {
        preview: false
      }
    )
  })

  it("blocks staging when an editor auto-save setting is unsafe", async () => {
    mocks.configuration.autoSave = "afterDelay"
    const service = new WorkflowAssistedApplyService(store())

    await expect(service.stageInTargetEditor("wf", "R3TR:PROG:ZTEST")).rejects.toThrow(
      /auto-save is off/
    )
    expect(mocks.applyEdit).not.toHaveBeenCalled()
  })

  it("blocks staging when chat saves dirty editors before send", async () => {
    mocks.configuration.chatSaveBeforeSend = true
    const service = new WorkflowAssistedApplyService(store())

    await expect(service.stageInTargetEditor("wf", "R3TR:PROG:ZTEST")).rejects.toThrow(
      /chat.saveBeforeSend is false/
    )
    expect(mocks.applyEdit).not.toHaveBeenCalled()
  })

  it("uses one explicit picker and opens a multi-file source from SAP", async () => {
    comparisonChanged = ["resource/main.abap", "resource/includes/zinc.abap"]
    const sourceRoot = path.join(root, "sources", "source", "objects", "id")
    await fs.rm(path.join(sourceRoot, "content", "resource"))
    await fs.mkdir(path.join(sourceRoot, "content", "resource", "includes"), {
      recursive: true
    })
    await fs.writeFile(path.join(sourceRoot, "content", "resource", "main.abap"), "REPORT ztest.\n")
    await fs.writeFile(
      path.join(sourceRoot, "content", "resource", "includes", "zinc.abap"),
      "WRITE text.\n"
    )
    await fs.writeFile(
      path.join(sourceRoot, "manifest.json"),
      JSON.stringify({
        files: [
          { path: "resource/main.abap", text: true },
          { path: "resource/includes/zinc.abap", text: true }
        ]
      })
    )
    mocks.showQuickPick.mockResolvedValue("resource/includes/zinc.abap")
    const service = new WorkflowAssistedApplyService(store())

    await service.openSource("wf", "R3TR:PROG:ZTEST")

    expect(mocks.showQuickPick).toHaveBeenCalledTimes(1)
    expect(mocks.openTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        scheme: "adt",
        path: expect.stringContaining("includes/zinc.abap")
      })
    )
    expect(resolveAbapResource).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "source100",
        source: "ZTEST"
      })
    )
  })

  it("rejects a target changed since plan review", async () => {
    await fs.writeFile(
      path.join(root, "sources", "target", "objects", "id", "manifest.json"),
      JSON.stringify({ aggregateHash: "changed" })
    )
    const service = new WorkflowAssistedApplyService(store())

    await expect(service.stageInTargetEditor("wf", "R3TR:PROG:ZTEST")).rejects.toThrow(
      /Target changed/
    )
    expect(mocks.applyEdit).not.toHaveBeenCalled()
  })

  it("rejects a locally changed source snapshot", async () => {
    mocks.sourceAggregateHash = "changed"
    const service = new WorkflowAssistedApplyService(store())

    await expect(service.stageInTargetEditor("wf", "R3TR:PROG:ZTEST")).rejects.toThrow(
      /local source snapshot changed/
    )
    expect(mocks.downloadSide).not.toHaveBeenCalled()
    expect(mocks.applyEdit).not.toHaveBeenCalled()
  })
})
