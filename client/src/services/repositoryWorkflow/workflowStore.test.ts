import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

let root = ""

jest.mock(
  "vscode",
  () => ({
    workspace: {
      getConfiguration: jest.fn(() => ({
        get: jest.fn((_key: string, fallback: unknown) => root || fallback)
      }))
    }
  }),
  { virtual: true }
)

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
    root = await fs.mkdtemp(path.join(os.tmpdir(), "repository-workflow-"))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
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
    await expect(fs.stat(stale)).rejects.toThrow()
    expect((await store.get(workflow.workflowId)).currentStep).toBe("discovery")
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
})
