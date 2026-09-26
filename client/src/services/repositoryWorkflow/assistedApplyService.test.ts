import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

const configuration = { autoSave: "off", chatSaveBeforeSend: false }
const writeFile = jest.fn()
const applyEdit = jest.fn()
const openTextDocument = jest.fn()
const showTextDocument = jest.fn()
const showInformationMessage = jest.fn()
const showQuickPick = jest.fn()
const executeCommand = jest.fn()
const replace = jest.fn()
const downloadSide = jest.fn()
const selectedRecords = jest.fn()
let sourceAggregateHash = "source-hash"

jest.mock(
  "vscode",
  () => ({
    Uri: {
      file: jest.fn((fsPath: string) => ({ scheme: "file", fsPath, path: fsPath })),
      joinPath: jest.fn((base: any, ...parts: string[]) => ({
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
      replace = replace
    },
    CancellationTokenSource: class {
      token = { isCancellationRequested: false }
      dispose() {}
    },
    workspace: {
      getConfiguration: jest.fn((section: string) => ({
        get: jest.fn((key: string, fallback: unknown) => {
          if (section === "files" && key === "autoSave") return configuration.autoSave
          if (section === "chat" && key === "saveBeforeSend")
            return configuration.chatSaveBeforeSend
          return fallback
        })
      })),
      fs: { writeFile },
      applyEdit,
      openTextDocument
    },
    window: { showTextDocument, showInformationMessage, showQuickPick },
    commands: { executeCommand }
  }),
  { virtual: true }
)
jest.mock("../abapResourceDownloadService", () => ({
  resolveAbapResource: jest.fn().mockResolvedValue({
    scheme: "adt",
    authority: "target100",
    path: "/target/resource"
  })
}))
jest.mock("./snapshotService", () => ({
  WorkflowSnapshotService: jest.fn().mockImplementation(() => ({
    downloadSide,
    selectedRecords
  })),
  objectFolderId: jest.fn(() => "id"),
  listFiles: jest.fn().mockResolvedValue([]),
  aggregateHash: jest.fn(() => sourceAggregateHash)
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
    get: jest.fn().mockResolvedValue(workflow),
    artifactPath: jest.fn((_workflow: unknown, ...parts: string[]) => path.join(root, ...parts)),
    readJsonLines: jest.fn(async function* () {
      yield {
        key: "R3TR:PROG:ZTEST",
        status: "different",
        added: [],
        removed: [],
        changed: comparisonChanged
      }
    }),
    writeJson: jest.fn(),
    appendJsonLine: jest.fn()
  } as any
}

describe("WorkflowAssistedApplyService", () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    root = await fs.mkdtemp(path.join(os.tmpdir(), "assisted-apply-"))
    configuration.autoSave = "off"
    configuration.chatSaveBeforeSend = false
    sourceAggregateHash = "source-hash"
    comparisonChanged = ["resource"]
    selectedRecords.mockResolvedValue({ source: [], target: [{ objectName: "ZTEST" }] })
    downloadSide.mockResolvedValue(undefined)
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
      getText: jest.fn(() => "REPORT old."),
      positionAt: jest.fn((offset: number) => ({ offset }))
    }
    openTextDocument.mockResolvedValue(document)
    applyEdit.mockImplementation(async () => {
      document.isDirty = true
      return true
    })
  })

  afterEach(async () => fs.rm(root, { recursive: true, force: true }))

  it("stages source only in a dirty target editor", async () => {
    const service = new WorkflowAssistedApplyService(store())
    await service.stageInTargetEditor("wf", "R3TR:PROG:ZTEST")

    expect(replace).toHaveBeenCalledWith(
      expect.objectContaining({ scheme: "adt" }),
      expect.anything(),
      "REPORT ztest.\n"
    )
    expect(applyEdit).toHaveBeenCalledTimes(1)
    expect(writeFile).not.toHaveBeenCalled()
    expect(showTextDocument).toHaveBeenCalledWith(expect.objectContaining({ isDirty: true }), {
      preview: false
    })
  })

  it("blocks staging when an editor auto-save setting is unsafe", async () => {
    configuration.autoSave = "afterDelay"
    const service = new WorkflowAssistedApplyService(store())

    await expect(service.stageInTargetEditor("wf", "R3TR:PROG:ZTEST")).rejects.toThrow(
      /auto-save is off/
    )
    expect(applyEdit).not.toHaveBeenCalled()
  })

  it("blocks staging when chat saves dirty editors before send", async () => {
    configuration.chatSaveBeforeSend = true
    const service = new WorkflowAssistedApplyService(store())

    await expect(service.stageInTargetEditor("wf", "R3TR:PROG:ZTEST")).rejects.toThrow(
      /chat.saveBeforeSend is false/
    )
    expect(applyEdit).not.toHaveBeenCalled()
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
    showQuickPick.mockResolvedValue("resource/includes/zinc.abap")
    const service = new WorkflowAssistedApplyService(store())

    await service.openSource("wf", "R3TR:PROG:ZTEST")

    expect(showQuickPick).toHaveBeenCalledTimes(1)
    expect(openTextDocument).toHaveBeenCalledWith(
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
    expect(applyEdit).not.toHaveBeenCalled()
  })

  it("rejects a locally changed source snapshot", async () => {
    sourceAggregateHash = "changed"
    const service = new WorkflowAssistedApplyService(store())

    await expect(service.stageInTargetEditor("wf", "R3TR:PROG:ZTEST")).rejects.toThrow(
      /local source snapshot changed/
    )
    expect(downloadSide).not.toHaveBeenCalled()
    expect(applyEdit).not.toHaveBeenCalled()
  })
})
