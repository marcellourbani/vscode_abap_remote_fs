import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

let root = ""
const runQuery = jest.fn()

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
  WorkflowSnapshotService: jest.fn().mockImplementation(() => ({}))
}))

jest.mock("./assistedApplyService", () => ({
  WorkflowAssistedApplyService: jest.fn().mockImplementation(() => ({}))
}))

import { WorkflowStore } from "./workflowStore"
import { RepositoryWorkflowEngine } from "./workflowEngine"

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

describe("RepositoryWorkflowEngine", () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    root = await fs.mkdtemp(path.join(os.tmpdir(), "repository-engine-"))
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
})
