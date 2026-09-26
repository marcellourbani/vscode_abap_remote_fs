import { EventEmitter } from "events"

const mockEngine = new EventEmitter()

jest.mock("vscode", () => ({}), { virtual: true })
jest.mock("./workflowEngine", () => ({
  RepositoryWorkflowEngine: jest.fn(() => mockEngine)
}))
jest.mock("./workflowStore", () => ({
  WorkflowStore: jest.fn(() => ({
    initialize: jest.fn(async () => undefined)
  }))
}))

import { RepositoryWorkflowChange, RepositoryWorkflowRuntime } from "./runtime"

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
