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
  save: vi.fn(),
  downloadSide: vi.fn(),
  selectedRecords: vi.fn(),
  getSelection: vi.fn(),
  registerIntent: vi.fn(),
  waitForIntent: vi.fn(),
  cancelIntent: vi.fn(),
  failIntent: vi.fn(),
  getInactiveSource: vi.fn(),
  getNodeAsync: vi.fn(),
  getClient: vi.fn(),
  appendExecutionEvent: vi.fn(),
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
vi.mock("../transportIntentService", () => ({
  TransportIntentService: {
    get: vi.fn(() => ({
      register: mocks.registerIntent,
      waitForResult: mocks.waitForIntent,
      cancel: mocks.cancelIntent,
      fail: mocks.failIntent
    }))
  }
}))
vi.mock("../../adt/conections", () => ({
  getClient: mocks.getClient,
  getOrCreateRoot: vi.fn(async () => ({ getNodeAsync: mocks.getNodeAsync }))
}))
vi.mock("abapfs", () => ({
  isAbapFile: vi.fn((value: unknown) => Boolean(value))
}))

import { WorkflowAssistedApplyService } from "./assistedApplyService"
import { resolveAbapResource } from "../abapResourceDownloadService"

let root = ""
let comparisonChanged = ["resource"]
const workflow = {
  workflowId: "wf",
  source: { connectionId: "source100" },
  target: { connectionId: "target100" },
  assistedApplyMode: "copilot",
  copilotAssistedApplyEnabledAt: "2026-10-09T12:00:00.000Z"
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
    appendJsonLine: vi.fn(),
    appendAssistedApplyExecutionEvent: mocks.appendExecutionEvent,
    getCopilotAssistedApplySelection: mocks.getSelection,
    removeCopilotAssistedApplySelection: vi.fn()
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
    workflow.assistedApplyMode = "copilot"
    workflow.copilotAssistedApplyEnabledAt = "2026-10-09T12:00:00.000Z"
    mocks.selectedRecords.mockResolvedValue({ source: [], target: [{ objectName: "ZTEST" }] })
    mocks.downloadSide.mockResolvedValue(undefined)
    mocks.getSelection.mockResolvedValue({
      keys: ["R3TR:PROG:ZTEST"],
      completedKeys: [],
      decisions: { "R3TR:PROG:ZTEST": "as-is" },
      decisionReasons: { "R3TR:PROG:ZTEST": "Reviewed and safe to apply." }
    })
    mocks.registerIntent.mockReturnValue({ intentId: "intent-1" })
    mocks.appendExecutionEvent.mockImplementation(
      async (_workflowId: string, event: Record<string, unknown>) => event
    )
    mocks.waitForIntent.mockResolvedValue({
      intentId: "intent-1",
      status: "succeeded",
      process: "repository-assisted-apply",
      objectUri: "adt://target100/target/resource",
      transportRequest: "DEVK900123"
    })
    mocks.save.mockResolvedValue(true)
    mocks.getInactiveSource.mockResolvedValue("REPORT ztest.\n")
    mocks.getClient.mockReturnValue({
      statelessClone: { getObjectSource: mocks.getInactiveSource }
    })
    mocks.getNodeAsync.mockResolvedValue({
      object: { contentsPath: vi.fn(() => "/target/object/source/main") }
    })
    const sourceRoot = path.join(root, "sources", "source", "objects", "id")
    const targetRoot = path.join(root, "sources", "target", "objects", "id")
    await fs.mkdir(path.join(sourceRoot, "raw"), { recursive: true })
    await fs.mkdir(targetRoot, { recursive: true })
    await fs.writeFile(path.join(sourceRoot, "raw", "resource"), "REPORT ztest.\n")
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
      positionAt: vi.fn((offset: number) => ({ offset })),
      save: mocks.save
    }
    mocks.openTextDocument.mockResolvedValue(document)
    mocks.applyEdit.mockImplementation(async () => {
      document.isDirty = true
      return true
    })
  })

  afterEach(async () => fs.rm(root, { recursive: true, force: true }))

  it("invalidates a saved Copilot selection when the plan is refreshed", async () => {
    const record = {
      objectName: "ZTEST",
      objectType: "PROG",
      generated: false,
      classification: "custom"
    }
    await fs.writeFile(
      path.join(root, "sources", "source", "objects", "id", "manifest.json"),
      JSON.stringify({
        status: "complete",
        record,
        aggregateHash: "source-hash",
        files: [{ path: "resource", text: true }]
      })
    )
    await fs.writeFile(
      path.join(root, "sources", "target", "objects", "id", "manifest.json"),
      JSON.stringify({
        status: "complete",
        record,
        aggregateHash: "target-hash",
        files: [{ path: "resource", text: true }]
      })
    )
    const workflowStore = store()
    await new WorkflowAssistedApplyService(workflowStore).prepare("wf")

    expect(workflowStore.removeCopilotAssistedApplySelection).toHaveBeenCalledWith(workflow)
    expect(workflowStore.writeJson).toHaveBeenCalledWith(
      expect.stringContaining("plan.json"),
      expect.objectContaining({
        items: [
          expect.objectContaining({
            key: "R3TR:PROG:ZTEST",
            transportCheckStatus: "not-checked",
            transportRequest: ""
          })
        ]
      })
    )
  })

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
    await fs.rm(path.join(sourceRoot, "raw", "resource"))
    await fs.mkdir(path.join(sourceRoot, "raw", "resource", "includes"), {
      recursive: true
    })
    await fs.writeFile(path.join(sourceRoot, "raw", "resource", "main.abap"), "REPORT ztest.\n")
    await fs.writeFile(
      path.join(sourceRoot, "raw", "resource", "includes", "zinc.abap"),
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

  it("stages, saves, waits for the provider result, and verifies inactive SAP source", async () => {
    const token = { isCancellationRequested: false } as any
    const service = new WorkflowAssistedApplyService(store())

    const result = await service.stageAndSaveForCopilot(
      "wf",
      "r3tr:prog:ztest",
      { type: "existing", number: "DEVK900123" },
      token
    )

    expect(mocks.registerIntent).toHaveBeenCalledWith({
      objectUri: expect.objectContaining({
        scheme: "adt",
        authority: "target100",
        path: "/target/resource"
      }),
      process: "repository-assisted-apply",
      transportChoice: { type: "existing", number: "DEVK900123" },
      workflowId: "wf",
      objectKey: "R3TR:PROG:ZTEST"
    })
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(mocks.waitForIntent).toHaveBeenCalledWith("intent-1", token, 60_000)
    expect(mocks.getInactiveSource).toHaveBeenCalledWith("/target/object/source/main", {
      version: "inactive"
    })
    expect(mocks.getClient).toHaveBeenCalledWith("target100")
    expect(result).toEqual(
      expect.objectContaining({
        status: "succeeded",
        transportRequest: "DEVK900123",
        inactiveSourceVerified: true
      })
    )
  })

  it("rejects Copilot apply unless the workflow currently has mode and consent", async () => {
    workflow.assistedApplyMode = "manual"
    const service = new WorkflowAssistedApplyService(store())

    await expect(
      service.stageAndSaveForCopilot(
        "wf",
        "R3TR:PROG:ZTEST",
        { type: "existing", number: "DEVK900123" },
        {} as any
      )
    ).rejects.toThrow(/not enabled/)
    expect(mocks.registerIntent).not.toHaveBeenCalled()
  })

  it("rechecks Copilot mode immediately before arming the write intent", async () => {
    mocks.downloadSide.mockImplementation(async () => {
      workflow.assistedApplyMode = "manual"
    })

    await expect(
      new WorkflowAssistedApplyService(store()).stageAndSaveForCopilot(
        "wf",
        "R3TR:PROG:ZTEST",
        { type: "existing", number: "DEVK900123" },
        {} as any
      )
    ).rejects.toThrow(/not enabled/)
    expect(mocks.registerIntent).not.toHaveBeenCalled()
    expect(mocks.applyEdit).not.toHaveBeenCalled()
  })

  it("rejects an object outside the user-saved selection", async () => {
    mocks.getSelection.mockResolvedValue({
      keys: ["R3TR:PROG:OTHER"],
      completedKeys: [],
      decisions: {},
      decisionReasons: {}
    })

    await expect(
      new WorkflowAssistedApplyService(store()).stageAndSaveForCopilot(
        "wf",
        "R3TR:PROG:ZTEST",
        { type: "existing", number: "DEVK900123" },
        {} as any
      )
    ).rejects.toThrow(/not in the user-saved/)
    expect(mocks.applyEdit).not.toHaveBeenCalled()
  })

  it("rejects an already completed object", async () => {
    mocks.getSelection.mockResolvedValue({
      keys: ["R3TR:PROG:ZTEST"],
      completedKeys: ["R3TR:PROG:ZTEST"],
      decisions: { "R3TR:PROG:ZTEST": "as-is" },
      decisionReasons: { "R3TR:PROG:ZTEST": "Reviewed." }
    })

    await expect(
      new WorkflowAssistedApplyService(store()).stageAndSaveForCopilot(
        "wf",
        "R3TR:PROG:ZTEST",
        { type: "existing", number: "DEVK900123" },
        {} as any
      )
    ).rejects.toThrow(/already marked done/)
  })

  it.each([
    {
      selection: {
        keys: ["R3TR:PROG:ZTEST"],
        completedKeys: [],
        decisions: { "R3TR:PROG:ZTEST": "needs-human" },
        decisionReasons: { "R3TR:PROG:ZTEST": "Needs review." }
      },
      error: /as-is/
    },
    {
      selection: {
        keys: ["R3TR:PROG:ZTEST"],
        completedKeys: [],
        decisions: { "R3TR:PROG:ZTEST": "as-is" },
        decisionReasons: { "R3TR:PROG:ZTEST": " " }
      },
      error: /decision reason/
    }
  ])("rejects unsafe review metadata", async ({ selection, error }) => {
    mocks.getSelection.mockResolvedValue(selection)

    await expect(
      new WorkflowAssistedApplyService(store()).stageAndSaveForCopilot(
        "wf",
        "R3TR:PROG:ZTEST",
        { type: "existing", number: "DEVK900123" },
        {} as any
      )
    ).rejects.toThrow(error)
    expect(mocks.registerIntent).not.toHaveBeenCalled()
  })

  it("cancels an armed intent if VS Code cannot stage the edit", async () => {
    mocks.applyEdit.mockResolvedValue(false)
    mocks.waitForIntent.mockResolvedValue({
      intentId: "intent-1",
      status: "cancelled",
      process: "repository-assisted-apply",
      objectUri: "adt://target100/target/resource",
      error: "VS Code could not stage the source in the target editor"
    })

    const result = await new WorkflowAssistedApplyService(store()).stageAndSaveForCopilot(
      "wf",
      "R3TR:PROG:ZTEST",
      { type: "existing", number: "DEVK900123" },
      {} as any
    )

    expect(result).toMatchObject({
      status: "cancelled",
      inactiveSourceVerified: false,
      resourceResults: [
        expect.objectContaining({
          status: "cancelled",
          error: expect.stringMatching(/could not stage/i)
        })
      ]
    })
    expect(mocks.cancelIntent).toHaveBeenCalledWith(
      "intent-1",
      expect.stringMatching(/could not stage/i)
    )
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it("reports a provider timeout as unknown and skips inactive verification", async () => {
    mocks.waitForIntent.mockResolvedValue({
      intentId: "intent-1",
      status: "timed-out",
      process: "repository-assisted-apply",
      objectUri: "adt://target100/target/resource",
      error: "Save result is still unknown"
    })

    const result = await new WorkflowAssistedApplyService(store()).stageAndSaveForCopilot(
      "wf",
      "R3TR:PROG:ZTEST",
      { type: "new", description: "Approved request" },
      {} as any
    )

    expect(result).toEqual(expect.objectContaining({ status: "timed-out" }))
    expect(mocks.getInactiveSource).not.toHaveBeenCalled()
  })

  it("records a false document-save result on the armed intent", async () => {
    mocks.save.mockResolvedValue(false)
    mocks.waitForIntent.mockResolvedValue({
      intentId: "intent-1",
      status: "failed",
      process: "repository-assisted-apply",
      objectUri: "adt://target100/target/resource",
      error: "VS Code reported that the target document was not saved"
    })

    const result = await new WorkflowAssistedApplyService(store()).stageAndSaveForCopilot(
      "wf",
      "R3TR:PROG:ZTEST",
      { type: "existing", number: "DEVK900123" },
      {} as any
    )
    await Promise.resolve()

    expect(result).toEqual(expect.objectContaining({ status: "failed" }))
    expect(mocks.failIntent).toHaveBeenCalledWith(
      "intent-1",
      "VS Code reported that the target document was not saved"
    )
    expect(mocks.getInactiveSource).not.toHaveBeenCalled()
  })

  it("applies every changed text resource for one selected repository object", async () => {
    comparisonChanged = ["resource/main.abap", "resource/testclasses.abap"]
    const sourceRoot = path.join(root, "sources", "source", "objects", "id")
    await fs.rm(path.join(sourceRoot, "raw", "resource"))
    await fs.mkdir(path.join(sourceRoot, "raw", "resource"), { recursive: true })
    await fs.writeFile(
      path.join(sourceRoot, "raw", "resource", "main.abap"),
      "CLASS zcl_test IMPLEMENTATION.\nENDCLASS.\n"
    )
    await fs.writeFile(
      path.join(sourceRoot, "raw", "resource", "testclasses.abap"),
      "CLASS ltc_test IMPLEMENTATION.\nENDCLASS.\n"
    )
    await fs.writeFile(
      path.join(sourceRoot, "manifest.json"),
      JSON.stringify({
        files: [
          { path: "resource/main.abap", text: true },
          { path: "resource/testclasses.abap", text: true }
        ]
      })
    )
    mocks.registerIntent
      .mockReturnValueOnce({ intentId: "intent-1" })
      .mockReturnValueOnce({ intentId: "intent-2" })
    mocks.waitForIntent
      .mockResolvedValueOnce({
        intentId: "intent-1",
        status: "succeeded",
        process: "repository-assisted-apply",
        objectUri: "adt://target100/target/resource/main.abap",
        transportRequest: "DEVK900555"
      })
      .mockResolvedValueOnce({
        intentId: "intent-2",
        status: "succeeded",
        process: "repository-assisted-apply",
        objectUri: "adt://target100/target/resource/testclasses.abap",
        transportRequest: "DEVK900555"
      })
    mocks.getInactiveSource
      .mockResolvedValueOnce("CLASS zcl_test IMPLEMENTATION.\nENDCLASS.\n")
      .mockResolvedValueOnce("CLASS ltc_test IMPLEMENTATION.\nENDCLASS.\n")

    const result = await new WorkflowAssistedApplyService(store()).stageAndSaveForCopilot(
      "wf",
      "R3TR:PROG:ZTEST",
      { type: "new", description: "Approved request" },
      {} as any
    )

    expect(result.status).toBe("succeeded")
    expect(result.resourceResults.map(resource => resource.resourcePath)).toEqual([
      "resource/main.abap",
      "resource/testclasses.abap"
    ])
    expect(mocks.save).toHaveBeenCalledTimes(2)
    expect(mocks.registerIntent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        transportChoice: { type: "new", description: "Approved request" }
      })
    )
    expect(mocks.registerIntent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        transportChoice: { type: "existing", number: "DEVK900555" }
      })
    )
    expect(mocks.appendExecutionEvent).toHaveBeenCalledWith(
      "wf",
      expect.objectContaining({
        stage: "apply",
        status: "succeeded",
        inactiveSourceVerified: true
      })
    )
  })

  it("fails verification when inactive SAP source differs from reviewed raw source", async () => {
    mocks.getInactiveSource.mockResolvedValue("REPORT unexpected.\n")

    const result = await new WorkflowAssistedApplyService(store()).stageAndSaveForCopilot(
      "wf",
      "R3TR:PROG:ZTEST",
      { type: "existing", number: "DEVK900123" },
      {} as any
    )

    expect(result.status).toBe("failed")
    expect(result.resourceResults[0].error).toMatch(/inactive target source does not match/)
  })
})
