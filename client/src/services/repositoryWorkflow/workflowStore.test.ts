import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { vi } from "vitest"

const { state } = vi.hoisted(() => ({ state: { root: "" } }))

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, fallback: unknown) => state.root || fallback)
    }))
  }
}))

import { WorkflowStore } from "./workflowStore"
import { WORKFLOW_SCHEMA_VERSION } from "./types"

const context = {} as any

function criteria() {
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    includeNames: ["Z*"],
    excludeNames: [],
    packages: ["Z*"],
    includeSubpackages: true,
    objectTypes: [],
    namespaces: [],
    authors: [],
    includeDeleted: false,
    includeGenerated: false,
    includeTemporary: false,
    sourceConcurrency: 99,
    targetConcurrency: 0,
    verificationConcurrency: 999
  }
}

describe("WorkflowStore", () => {
  beforeEach(async () => {
    state.root = await fs.mkdtemp(path.join(os.tmpdir(), "repository-workflow-"))
  })

  afterEach(async () => {
    await fs.rm(state.root, { recursive: true, force: true })
  })

  it("creates isolated workflows and rejects identical connections", async () => {
    const store = new WorkflowStore(context)
    const first = await store.create({
      name: "Source Target",
      sourceConnectionId: "SOURCE100",
      targetConnectionId: "TARGET100"
    })
    const second = await store.create({
      name: "Source Target",
      sourceConnectionId: "SOURCE100",
      targetConnectionId: "TARGET100"
    })
    expect(first.workflowId).not.toBe(second.workflowId)
    expect(first.folderName).not.toBe(second.folderName)
    expect((await store.getCriteria(first.workflowId))?.includeNames).toEqual([])
    await expect(
      store.create({ name: "Invalid", sourceConnectionId: "same", targetConnectionId: "SAME" })
    ).rejects.toThrow(/different/)
  })

  it("allows only one durable runner per workflow", async () => {
    const store = new WorkflowStore(context)
    const workflow = await store.create({
      name: "Locked",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    await store.acquireRunLock(workflow.workflowId)
    await expect(store.acquireRunLock(workflow.workflowId)).rejects.toThrow(/already running/)
    expect(await store.isRunLocked(workflow.workflowId)).toBe(true)
    await store.releaseRunLock(workflow.workflowId)
    expect(await store.isRunLocked(workflow.workflowId)).toBe(false)
  })

  it("releases only the lock owned by the caller", async () => {
    const store = new WorkflowStore(context)
    const workflow = await store.create({
      name: "Owned lock",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    await store.acquireRunLock(workflow.workflowId, "runner-a")

    expect(await store.releaseRunLock(workflow.workflowId, "runner-b")).toBe(false)
    expect(await store.isRunLocked(workflow.workflowId)).toBe(true)
    expect(await store.releaseRunLock(workflow.workflowId, "runner-a")).toBe(true)
    expect(await store.isRunLocked(workflow.workflowId)).toBe(false)
  })

  it.each(["archive", "delete"] as const)(
    "rejects %s while the workflow is running",
    async action => {
      const store = new WorkflowStore(context)
      const workflow = await store.create({
        name: `Active ${action}`,
        sourceConnectionId: "source100",
        targetConnectionId: "target100"
      })
      await store.acquireRunLock(workflow.workflowId, "runner")

      await expect(store[action](workflow.workflowId)).rejects.toThrow(/already running/)
      expect((await store.get(workflow.workflowId)).workflowId).toBe(workflow.workflowId)

      await store.releaseRunLock(workflow.workflowId, "runner")
    }
  )

  it("persists complete assisted-apply execution history and summarizes attempts", async () => {
    const store = new WorkflowStore(context)
    const workflow = await store.create({
      name: "Execution history",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })

    await store.appendAssistedApplyExecutionEvent(workflow.workflowId, {
      attemptId: "attempt-1",
      objectKey: "r3tr:clas:zcl_test",
      stage: "apply",
      status: "started",
      sourceHash: "source-hash",
      targetHash: "target-hash"
    })
    await store.appendAssistedApplyExecutionEvent(workflow.workflowId, {
      attemptId: "attempt-1",
      objectKey: "R3TR:CLAS:ZCL_TEST",
      stage: "save",
      status: "failed",
      resourcePath: "resource/main.abap",
      transportRequest: "DEVK900123",
      error: "SAP write failed"
    })
    await store.appendAssistedApplyExecutionEvent(workflow.workflowId, {
      attemptId: "attempt-2",
      objectKey: "R3TR:CLAS:ZCL_TEST",
      stage: "completion",
      status: "succeeded",
      transportRequest: "DEVK900124"
    })

    const events = await store.getAssistedApplyExecutionEvents(
      workflow.workflowId,
      "r3tr:clas:zcl_test"
    )
    expect(events).toHaveLength(3)
    expect(events.every(event => event.objectKey === "R3TR:CLAS:ZCL_TEST")).toBe(true)
    expect(events.map(event => event.stage)).toEqual(["apply", "save", "completion"])

    const summaries = await store.getAssistedApplyExecutionSummaries(workflow.workflowId)
    expect(summaries["R3TR:CLAS:ZCL_TEST"]).toEqual(
      expect.objectContaining({
        attemptCount: 2,
        eventCount: 3,
        lastAttemptId: "attempt-2",
        lastStage: "completion",
        lastStatus: "succeeded",
        transportRequest: "DEVK900124",
        lastError: undefined
      })
    )
  })

  it("clamps concurrency and invalidates derived artifacts when criteria change", async () => {
    const store = new WorkflowStore(context)
    const workflow = await store.create({
      name: "Criteria",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    const stale = store.artifactPath(workflow, "comparison", "source.jsonl")
    await fs.writeFile(stale, "{}\n", "utf8")
    const saved = await store.saveCriteria(workflow.workflowId, criteria())
    expect(saved.sourceConcurrency).toBe(10)
    expect(saved.targetConcurrency).toBe(1)
    expect(saved.verificationConcurrency).toBe(128)
    const transport = await store.saveTransportConcurrency(workflow.workflowId, 99)
    expect(transport.transportConcurrency).toBe(10)
    await expect(fs.stat(stale)).rejects.toThrow()
    expect((await store.get(workflow.workflowId)).currentStep).toBe("discovery")
  })

  it("persists Copilot-assisted apply consent and only saves eligible plan items", async () => {
    const store = new WorkflowStore(context)
    const workflow = await store.create({
      name: "Copilot apply",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    await store.writeJson(store.artifactPath(workflow, "assisted-apply", "plan.json"), {
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      sourceConnectionId: "source100",
      targetConnectionId: "target100",
      comparisonBasis: "formatted",
      items: [
        { key: "R3TR:PROG:ZREADY", eligible: true },
        { key: "R3TR:PROG:ZBLOCKED", eligible: false }
      ]
    })

    await expect(
      store.saveCopilotAssistedApplySelection(workflow.workflowId, ["R3TR:PROG:ZREADY"])
    ).rejects.toThrow(/enable Copilot-assisted apply/i)

    const enabled = await store.setAssistedApplyMode(workflow.workflowId, "copilot")
    expect(enabled.assistedApplyMode).toBe("copilot")
    expect(enabled.copilotAssistedApplyEnabledAt).toBeTruthy()

    const selection = await store.saveCopilotAssistedApplySelection(workflow.workflowId, [
      "r3tr:prog:zready",
      "R3TR:PROG:ZREADY"
    ])
    expect(selection.keys).toEqual(["R3TR:PROG:ZREADY"])
    expect(selection.decisions).toEqual({
      "R3TR:PROG:ZREADY": "needs-human"
    })
    expect(selection.decisionReasons).toEqual({})
    const decided = await store.updateCopilotAssistedApplyDecision(
      workflow.workflowId,
      "r3tr:prog:zready",
      "as-is",
      "Source and target differ only in the reviewed intended change."
    )
    expect(decided.decisions?.["R3TR:PROG:ZREADY"]).toBe("as-is")
    expect(decided.decisionReasons?.["R3TR:PROG:ZREADY"]).toBe(
      "Source and target differ only in the reviewed intended change."
    )
    await expect(
      store.updateCopilotAssistedApplyDecision(
        workflow.workflowId,
        "R3TR:PROG:ZREADY",
        "needs-human",
        " "
      )
    ).rejects.toThrow(/decision reason is required/i)
    const completed = await store.updateCopilotAssistedApplyStatus(
      workflow.workflowId,
      ["R3TR:PROG:ZREADY"],
      "done"
    )
    expect(completed.completedKeys).toEqual(["R3TR:PROG:ZREADY"])
    const reset = await store.updateCopilotAssistedApplyStatus(
      workflow.workflowId,
      ["r3tr:prog:zready"],
      "pending"
    )
    expect(reset.completedKeys).toEqual([])
    await expect(
      store.saveCopilotAssistedApplySelection(workflow.workflowId, ["R3TR:PROG:ZBLOCKED"])
    ).rejects.toThrow(/not eligible/i)
    await expect(
      store.updateCopilotAssistedApplyStatus(workflow.workflowId, ["R3TR:PROG:ZBLOCKED"], "done")
    ).rejects.toThrow(/user-saved/i)
    await expect(
      store.updateCopilotAssistedApplyDecision(
        workflow.workflowId,
        "R3TR:PROG:ZBLOCKED",
        "skip",
        "The object is blocked."
      )
    ).rejects.toThrow(/user-saved/i)
    expect((await store.getCopilotAssistedApplySelection(workflow.workflowId))?.keys).toEqual([
      "R3TR:PROG:ZREADY"
    ])
  })

  it("keeps every concurrent decision and completion for different objects", async () => {
    const store = new WorkflowStore(context)
    const workflow = await store.create({
      name: "Concurrent selection",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    const keys = Array.from({ length: 3 }, (_, index) => `R3TR:PROG:ZOBJ${index}`)
    await store.writeJson(store.artifactPath(workflow, "assisted-apply", "plan.json"), {
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      sourceConnectionId: "source100",
      targetConnectionId: "target100",
      comparisonBasis: "formatted",
      items: keys.map(key => ({ key, eligible: true }))
    })
    await store.setAssistedApplyMode(workflow.workflowId, "copilot")
    await store.saveCopilotAssistedApplySelection(workflow.workflowId, keys)

    await Promise.all(
      keys.map(key =>
        store.updateCopilotAssistedApplyDecision(workflow.workflowId, key, "as-is", "Reviewed.")
      )
    )
    await Promise.all(
      keys.map(key => store.updateCopilotAssistedApplyStatus(workflow.workflowId, [key], "done"))
    )

    const selection = await store.getCopilotAssistedApplySelection(workflow.workflowId)
    expect(selection?.completedKeys).toEqual(keys)
    expect(Object.values(selection?.decisions ?? {})).toEqual(keys.map(() => "as-is"))
  })

  it("keeps assisted-apply execution history when derived artifacts are invalidated", async () => {
    const store = new WorkflowStore(context)
    const workflow = await store.create({
      name: "Durable history",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    await store.appendAssistedApplyExecutionEvent(workflow.workflowId, {
      attemptId: "attempt-1",
      objectKey: "R3TR:PROG:ZTEST",
      stage: "apply",
      status: "succeeded"
    })

    await store.invalidateAssistedApplyPlan(workflow.workflowId)
    await store.invalidateAfterSourceSelection(workflow.workflowId)
    await store.invalidateAfterDiscovery(workflow.workflowId)
    await store.saveCriteria(workflow.workflowId, criteria())

    expect(await store.getAssistedApplyExecutionEvents(workflow.workflowId)).toHaveLength(1)
  })

  it.each([[[]], [["*"]], [["/*"]]])("rejects unscoped package criteria %p", async packages => {
    const store = new WorkflowStore(context)
    const workflow = await store.create({
      name: "Packages",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    await expect(
      store.saveCriteria(workflow.workflowId, {
        ...criteria(),
        includeNames: [],
        packages
      })
    ).rejects.toThrow(/package pattern/i)
  })

  it.each([["Z*,Y*"], ["Z*", "Y*"]])(
    "rejects multiple include-name patterns %p",
    async (...includeNames: any[]) => {
      const values = Array.isArray(includeNames[0]) ? includeNames[0] : includeNames
      const store = new WorkflowStore(context)
      const workflow = await store.create({
        name: "Names",
        sourceConnectionId: "source100",
        targetConnectionId: "target100"
      })
      await expect(
        store.saveCriteria(workflow.workflowId, { ...criteria(), includeNames: values })
      ).rejects.toThrow(/one pattern only|comma-separated/i)
    }
  )

  it.each([[["Z*"]], [["Y*"]], [["/XYZ/*"]]])(
    "accepts scoped package criteria %p",
    async packages => {
      const store = new WorkflowStore(context)
      const workflow = await store.create({
        name: "Scoped packages",
        sourceConnectionId: "source100",
        targetConnectionId: "target100"
      })
      await expect(
        store.saveCriteria(workflow.workflowId, { ...criteria(), packages })
      ).resolves.toMatchObject({ packages })
    }
  )

  it("marks running workflows interrupted during initialization", async () => {
    const store = new WorkflowStore(context)
    const workflow = await store.create({
      name: "Interrupted",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    await store.update(workflow.workflowId, current => ({
      ...current,
      runState: "running",
      currentStep: "discovery",
      steps: { ...current.steps, discovery: { status: "running" } }
    }))
    await store.initialize()
    const recovered = await store.get(workflow.workflowId)
    expect(recovered.runState).toBe("interrupted")
    expect(recovered.steps.discovery.status).toBe("interrupted")
  })

  it("does not steal a live runner's lock during initialization", async () => {
    const store = new WorkflowStore(context)
    const workflow = await store.create({
      name: "Live runner",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    await store.update(workflow.workflowId, current => ({
      ...current,
      runState: "running",
      currentStep: "discovery",
      steps: { ...current.steps, discovery: { status: "running" } }
    }))
    await store.acquireRunLock(workflow.workflowId, "live-runner")

    await store.initialize()

    expect((await store.get(workflow.workflowId)).runState).toBe("running")
    expect(await store.isRunLocked(workflow.workflowId)).toBe(true)
    await store.releaseRunLock(workflow.workflowId, "live-runner")
  })
})
