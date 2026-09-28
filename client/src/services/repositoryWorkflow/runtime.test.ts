import { EventEmitter } from "events"
import { vi } from "vitest"

const { mockEngine } = vi.hoisted(() => ({ mockEngine: { on: vi.fn() } }))

vi.mock("vscode", () => ({}))
vi.mock("./workflowEngine", () => ({
  RepositoryWorkflowEngine: vi.fn(function () {
    return mockEngine
  })
}))
vi.mock("./workflowStore", () => ({
  WorkflowStore: vi.fn(function () {
    return { initialize: vi.fn(async () => undefined) }
  })
}))

import { RepositoryWorkflowRuntime } from "./runtime"
import type { RepositoryWorkflowChange } from "./runtime"

describe("RepositoryWorkflowRuntime refresh batching", () => {
  it("keeps phase changes lightweight and emits one full refresh after completion", async () => {
    const runtime = RepositoryWorkflowRuntime.get({} as any)
    const changes: RepositoryWorkflowChange[] = []
    runtime.on("changed", change => changes.push(change))

    await runtime.runWithRefreshBatch("workflow", async () => {
      runtime.notifyChanged("workflow")
      runtime.notifyChanged("workflow", false, true)
    })

    expect(changes).toEqual([
      {
        workflowId: "workflow",
        focus: false,
        progress: false,
        workflowOnly: true
      },
      {
        workflowId: "workflow",
        focus: false,
        progress: true,
        workflowOnly: false
      },
      {
        workflowId: "workflow",
        focus: false,
        progress: false,
        workflowOnly: false
      }
    ])
  })

  it("does not finish a nested batch until its outer operation settles", async () => {
    const runtime = RepositoryWorkflowRuntime.get()
    const changes: RepositoryWorkflowChange[] = []
    runtime.on("changed", change => changes.push(change))

    await runtime.runWithRefreshBatch("nested", async () => {
      await runtime.runWithRefreshBatch("nested", async () => {
        runtime.notifyChanged("nested")
      })
      runtime.notifyChanged("nested")
    })

    expect(changes.filter(change => change.workflowOnly)).toHaveLength(2)
    expect(changes.at(-1)).toMatchObject({
      workflowId: "nested",
      workflowOnly: false
    })
  })
})
