import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { createHash } from "crypto"

let root = ""
const runQuery = jest.fn()
const mockSnapshots = {
  selectedRecords: jest.fn(),
  verifySide: jest.fn(),
  downloadPending: jest.fn(),
  compare: jest.fn()
}
const mockAssistedApply = {
  prepare: jest.fn()
}

jest.mock(
  "vscode",
  () => ({
    workspace: {
      getConfiguration: jest.fn(() => ({
        get: jest.fn((_key: string, fallback: unknown) => root || fallback)
      }))
    },
    CancellationTokenSource: class {
      token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }
      cancel() {
        this.token.isCancellationRequested = true
      }
      dispose() {}
    }
  }),
  { virtual: true }
)

jest.mock("../../config", () => ({
  connectedRoots: jest.fn(
    () =>
      new Map([
        ["source100", {}],
        ["target100", {}]
      ])
  )
}))

jest.mock("../../adt/conections", () => ({
  getClient: jest.fn(() => ({ runQuery }))
}))

jest.mock("./snapshotService", () => ({
  WorkflowSnapshotService: jest.fn().mockImplementation(() => mockSnapshots)
}))

jest.mock("./assistedApplyService", () => ({
  WorkflowAssistedApplyService: jest.fn().mockImplementation(() => mockAssistedApply)
}))

import { WorkflowStore } from "./workflowStore"
import { RepositoryWorkflowEngine } from "./workflowEngine"
import { RepositoryObjectRecord } from "./types"

const row = (name: string) => ({
  PGMID: "R3TR",
  OBJECT: "PROG",
  OBJ_NAME: name,
  DEVCLASS: "ZPKG",
  SRCSYSTEM: "SRC",
  AUTHOR: "USER",
  COMPONENT: "",
  GENFLAG: "",
  DELFLAG: "",
  NAMESPACE: ""
})

const repositoryRecord = (name: string): RepositoryObjectRecord => ({
  pgmid: "R3TR",
  objectType: "PROG",
  objectName: name,
  packageName: "ZPKG",
  originalSystem: "SRC",
  author: "USER",
  component: "",
  generated: false,
  deleted: false,
  classification: "custom",
  classificationReason: "Z/Y object name"
})

const snapshotFolder = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 20)

describe("RepositoryWorkflowEngine", () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    root = await fs.mkdtemp(path.join(os.tmpdir(), "repository-engine-"))
    mockSnapshots.selectedRecords.mockResolvedValue({ source: [], target: [] })
    mockSnapshots.verifySide.mockImplementation(
      async (_workflowId, _side, records: RepositoryObjectRecord[]) => ({
        completed: 0,
        pending: records
      })
    )
    mockSnapshots.downloadPending.mockImplementation(
      async (_workflowId, _side, _records, total) => ({
        total,
        complete: total,
        partial: 0,
        failed: 0,
        cancelled: false
      })
    )
    mockSnapshots.compare.mockResolvedValue([])
    mockAssistedApply.prepare.mockResolvedValue({
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      sourceConnectionId: "source100",
      targetConnectionId: "target100",
      items: []
    })
  })

  afterEach(async () => fs.rm(root, { recursive: true, force: true }))

  it("persists two discoveries then compares existence locally", async () => {
    runQuery.mockResolvedValueOnce({ values: [{ DEVCLASS: "ZPKG", PARENTCL: "", NAMESPACE: "" }] })
    runQuery.mockResolvedValueOnce({ values: [row("ZBOTH"), row("ZSOURCE")] })
    runQuery.mockResolvedValueOnce({ values: [{ DEVCLASS: "ZPKG", PARENTCL: "", NAMESPACE: "" }] })
    runQuery.mockResolvedValueOnce({ values: [row("ZBOTH"), row("ZTARGET")] })
    const store = new WorkflowStore({} as any)
    const workflow = await store.create({
      name: "Engine",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    const engine = new RepositoryWorkflowEngine(store)
    await engine.runDiscovery(workflow.workflowId)
    const callsAfterDiscovery = runQuery.mock.calls.length
    await engine.compareExistence(workflow.workflowId)

    expect(runQuery).toHaveBeenCalledTimes(callsAfterDiscovery)
    const statuses: Record<string, string> = {}
    for await (const result of store.readJsonLines<any>(
      store.artifactPath(workflow, "comparison", "existence.jsonl")
    ))
      statuses[result.key] = result.status
    expect(statuses["R3TR:PROG:ZBOTH"]).toBe("both")
    expect(statuses["R3TR:PROG:ZSOURCE"]).toBe("source-only")
    expect(statuses["R3TR:PROG:ZTARGET"]).toBe("target-only")
  })

  it("persists only selected objects that exist on both systems", async () => {
    runQuery.mockResolvedValueOnce({ values: [{ DEVCLASS: "ZPKG", PARENTCL: "", NAMESPACE: "" }] })
    runQuery.mockResolvedValueOnce({
      values: [row("ZBOTH"), row("ZSOURCE"), { ...row("ZPACKAGE"), OBJECT: "DEVC" }]
    })
    runQuery.mockResolvedValueOnce({ values: [{ DEVCLASS: "ZPKG", PARENTCL: "", NAMESPACE: "" }] })
    runQuery.mockResolvedValueOnce({
      values: [row("ZBOTH"), { ...row("ZPACKAGE"), OBJECT: "DEVC" }]
    })
    const store = new WorkflowStore({} as any)
    const workflow = await store.create({
      name: "Selection",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    const engine = new RepositoryWorkflowEngine(store)
    await engine.runDiscovery(workflow.workflowId)
    await engine.compareExistence(workflow.workflowId)

    const rejected = await engine.saveSourceSelection(workflow.workflowId, ["R3TR:DEVC:ZPACKAGE"])
    expect(rejected.steps.sourceSelection.lastError).toBe(
      "DEVC package objects and objects missing from either system cannot be source-compared"
    )
    await engine.saveSourceSelection(workflow.workflowId)

    const selection = JSON.parse(
      await fs.readFile(store.artifactPath(workflow, "comparison", "source-selection.json"), "utf8")
    )
    expect(selection.keys).toEqual(["R3TR:PROG:ZBOTH"])
  })

  it("keeps retained snapshots and discards deselected snapshots", async () => {
    const store = new WorkflowStore({} as any)
    const workflow = await store.create({
      name: "Change selection",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    const kept = "R3TR:PROG:ZKEEP"
    const removed = "R3TR:PROG:ZREMOVE"
    await store.update(workflow.workflowId, current => ({
      ...current,
      currentStep: "sourceDownload",
      steps: {
        ...current.steps,
        discovery: { status: "complete" },
        existenceComparison: { status: "complete" },
        sourceSelection: { status: "complete" }
      }
    }))
    await store.replaceJsonLines(
      store.artifactPath(workflow, "comparison", "existence.jsonl"),
      [kept, removed].map(key => ({
        key,
        status: "both",
        source: repositoryRecord(key.split(":").pop()!),
        target: repositoryRecord(key.split(":").pop()!)
      }))
    )
    await store.writeJson(store.artifactPath(workflow, "comparison", "source-selection.json"), {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      keys: [kept, removed]
    })
    for (const side of ["source", "target"])
      for (const key of [kept, removed]) {
        const directory = store.artifactPath(
          workflow,
          "sources",
          side,
          "objects",
          snapshotFolder(key)
        )
        await fs.mkdir(directory, { recursive: true })
        await fs.writeFile(path.join(directory, "snapshot"), key)
      }

    const engine = new RepositoryWorkflowEngine(store)
    await engine.saveSourceSelection(workflow.workflowId, [kept])

    for (const side of ["source", "target"]) {
      await expect(
        fs.stat(store.artifactPath(workflow, "sources", side, "objects", snapshotFolder(kept)))
      ).resolves.toBeDefined()
      await expect(
        fs.stat(store.artifactPath(workflow, "sources", side, "objects", snapshotFolder(removed)))
      ).rejects.toThrow()
    }
  })

  it("resumes discovery without repeating completed package queries", async () => {
    runQuery
      .mockResolvedValueOnce({ values: [{ DEVCLASS: "ZPKG", PARENTCL: "", NAMESPACE: "" }] })
      .mockResolvedValueOnce({ values: [row("ZSOURCE")] })
      .mockResolvedValueOnce({ values: [{ DEVCLASS: "ZPKG", PARENTCL: "", NAMESPACE: "" }] })
      .mockResolvedValueOnce({ values: [row("ZTARGET")] })
    const store = new WorkflowStore({} as any)
    const workflow = await store.create({
      name: "Resume",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    const engine = new RepositoryWorkflowEngine(store)
    await engine.runDiscovery(workflow.workflowId)
    const firstRunCalls = runQuery.mock.calls.length
    await store.update(workflow.workflowId, current => ({
      ...current,
      currentStep: "discovery",
      steps: { ...current.steps, discovery: { status: "interrupted" } }
    }))
    runQuery
      .mockResolvedValueOnce({ values: [{ DEVCLASS: "ZPKG", PARENTCL: "", NAMESPACE: "" }] })
      .mockResolvedValueOnce({ values: [{ DEVCLASS: "ZPKG", PARENTCL: "", NAMESPACE: "" }] })
    await engine.runDiscovery(workflow.workflowId)
    expect(runQuery.mock.calls.length - firstRunCalls).toBe(2)
  })

  it("compares object types independently when names are the same", async () => {
    runQuery
      .mockResolvedValueOnce({ values: [{ DEVCLASS: "ZPKG", PARENTCL: "", NAMESPACE: "" }] })
      .mockResolvedValueOnce({
        values: [row("ZSAME"), { ...row("ZSAME"), OBJECT: "CLAS" }]
      })
      .mockResolvedValueOnce({ values: [{ DEVCLASS: "ZPKG", PARENTCL: "", NAMESPACE: "" }] })
      .mockResolvedValueOnce({ values: [row("ZSAME")] })
    const store = new WorkflowStore({} as any)
    const workflow = await store.create({
      name: "Conflict",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    const engine = new RepositoryWorkflowEngine(store)
    await engine.runDiscovery(workflow.workflowId)
    await engine.compareExistence(workflow.workflowId)
    const statuses: Record<string, string> = {}
    for await (const result of store.readJsonLines<any>(
      store.artifactPath(workflow, "comparison", "existence.jsonl")
    ))
      statuses[result.key] = result.status
    expect(statuses).toEqual({
      "R3TR:CLAS:ZSAME": "source-only",
      "R3TR:PROG:ZSAME": "both"
    })
  })

  it("waits for existence comparison to stop before releasing its owned lock", async () => {
    const store = new WorkflowStore({} as any)
    const workflow = await store.create({
      name: "Cancel existence",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    await store.update(workflow.workflowId, current => ({
      ...current,
      currentStep: "existenceComparison",
      steps: { ...current.steps, discovery: { status: "complete" } }
    }))
    const records = async function* () {
      for (let index = 0; index < 5_000; index++) yield repositoryRecord(`Z${index}`)
    }
    await store.replaceJsonLines(
      store.artifactPath(workflow, "discovery", "source", "tadir.jsonl"),
      records()
    )
    await store.replaceJsonLines(
      store.artifactPath(workflow, "discovery", "target", "tadir.jsonl"),
      records()
    )
    const engine = new RepositoryWorkflowEngine(store)

    const comparison = engine.compareExistence(workflow.workflowId)
    const paused = await engine.pause(workflow.workflowId, "panel-closed")
    await comparison

    expect(paused.runState).toBe("paused")
    expect(paused.steps.existenceComparison.pauseReason).toBe("panel-closed")
    expect(await store.isRunLocked(workflow.workflowId)).toBe(false)
  })

  it("reports incomplete downloads and comparisons as partial and resumable", async () => {
    const store = new WorkflowStore({} as any)
    const workflow = await store.create({
      name: "Partial",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    await store.update(workflow.workflowId, current => ({
      ...current,
      currentStep: "sourceDownload",
      steps: {
        ...current.steps,
        discovery: { status: "complete" },
        existenceComparison: { status: "complete" },
        sourceSelection: { status: "complete" }
      }
    }))
    await store.writeJson(store.artifactPath(workflow, "comparison", "source-selection.json"), {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      keys: ["R3TR:PROG:ZPARTIAL"]
    })
    mockSnapshots.selectedRecords.mockResolvedValue({
      source: [repositoryRecord("ZPARTIAL")],
      target: [repositoryRecord("ZPARTIAL")]
    })
    mockSnapshots.downloadPending.mockImplementation(
      async (_workflowId, side: "source" | "target", _records, total) => ({
        total,
        complete: side === "source" ? 1 : 0,
        partial: 0,
        failed: side === "target" ? 1 : 0,
        cancelled: false
      })
    )
    mockSnapshots.compare.mockResolvedValue([
      {
        key: "R3TR:PROG:ZPARTIAL",
        status: "partial",
        added: [],
        removed: [],
        changed: [],
        error: "Target snapshot failed"
      }
    ])
    const engine = new RepositoryWorkflowEngine(store)

    const downloaded = await engine.downloadSources(workflow.workflowId)
    expect(downloaded.runState).toBe("partial")
    expect(downloaded.steps.sourceDownload.status).toBe("partial")
    expect(downloaded.currentStep).toBe("sourceComparison")

    const compared = await engine.compareSources(workflow.workflowId)
    expect(compared.runState).toBe("partial")
    expect(compared.steps.sourceComparison.status).toBe("partial")
    expect(compared.currentStep).toBe("assistedApplyPlan")

    await engine.prepareAssistedApply(workflow.workflowId)
    const planned = await store.get(workflow.workflowId)
    expect(planned.runState).toBe("partial")
    expect(planned.steps.assistedApplyPlan.status).toBe("complete")
    expect(await store.isRunLocked(workflow.workflowId)).toBe(false)
  })

  it("pauses source comparison and assisted preparation with the user reason", async () => {
    const store = new WorkflowStore({} as any)
    const workflow = await store.create({
      name: "Cancel local stages",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    await store.update(workflow.workflowId, current => ({
      ...current,
      currentStep: "sourceComparison",
      steps: {
        ...current.steps,
        discovery: { status: "complete" },
        existenceComparison: { status: "complete" },
        sourceSelection: { status: "complete" },
        sourceDownload: { status: "complete" }
      }
    }))
    await store.writeJson(store.artifactPath(workflow, "comparison", "source-selection.json"), {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      keys: ["R3TR:PROG:ZWAIT"]
    })
    mockSnapshots.compare.mockImplementation(async (_id, _keys, _progress, token) => {
      while (!token.isCancellationRequested)
        await new Promise<void>(resolve => setImmediate(resolve))
      return []
    })
    const engine = new RepositoryWorkflowEngine(store)

    const comparison = engine.compareSources(workflow.workflowId)
    const pausedComparison = await engine.pause(workflow.workflowId)
    await comparison
    expect(pausedComparison.steps.sourceComparison.pauseReason).toBe("explicit-pause")

    await store.update(workflow.workflowId, current => ({
      ...current,
      currentStep: "assistedApplyPlan",
      runState: "idle",
      steps: {
        ...current.steps,
        sourceComparison: { status: "complete" },
        assistedApplyPlan: { status: "not-started" }
      }
    }))
    mockAssistedApply.prepare.mockImplementation(async (_id, _keys, token) => {
      while (!token.isCancellationRequested)
        await new Promise<void>(resolve => setImmediate(resolve))
      throw new Error("Operation cancelled")
    })

    const preparation = engine.prepareAssistedApply(workflow.workflowId)
    const pausedPreparation = await engine.pause(workflow.workflowId, "panel-closed")
    await preparation
    expect(pausedPreparation.steps.assistedApplyPlan.pauseReason).toBe("panel-closed")
    expect(await store.isRunLocked(workflow.workflowId)).toBe(false)
  })
})
