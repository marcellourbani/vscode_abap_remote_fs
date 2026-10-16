import { vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getWorkflow: vi.fn(),
  getSelection: vi.fn(),
  getEvents: vi.fn(),
  getPlanItem: vi.fn(),
  appendEvent: vi.fn(),
  updateStatus: vi.fn(),
  notifyChanged: vi.fn(),
  authorize: vi.fn()
}))

vi.mock("vscode", () => ({
  LanguageModelToolResult: vi.fn().mockImplementation(function (parts: any[]) {
    return { parts }
  }),
  LanguageModelTextPart: vi.fn().mockImplementation(function (text: string) {
    return { text }
  }),
  MarkdownString: vi.fn().mockImplementation(function (text: string) {
    return { text }
  })
}))
vi.mock("../repositoryWorkflow/runtime", () => ({
  RepositoryWorkflowRuntime: {
    get: vi.fn(() => ({
      ready: Promise.resolve(),
      store: {
        get: mocks.getWorkflow,
        getCopilotAssistedApplySelection: mocks.getSelection,
        getAssistedApplyExecutionEvents: mocks.getEvents,
        getAssistedApplyPlanItem: mocks.getPlanItem,
        appendAssistedApplyExecutionEvent: mocks.appendEvent,
        updateCopilotAssistedApplyStatus: mocks.updateStatus
      },
      notifyChanged: mocks.notifyChanged
    }))
  }
}))
vi.mock("./toolGuard", () => ({
  assertToolInvocationAuthorized: mocks.authorize
}))
vi.mock("./toolRegistry", () => ({
  registerToolWithRegistry: vi.fn()
}))

import { RecordRepositoryWorkflowObjectActivationTool } from "./repositoryWorkflowActivationRecordTool"

describe("RecordRepositoryWorkflowObjectActivationTool", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getWorkflow.mockResolvedValue({
      workflowId: "workflow-1",
      assistedApplyMode: "copilot",
      copilotAssistedApplyEnabledAt: "2026-10-09T12:00:00.000Z"
    })
    mocks.getSelection.mockResolvedValue({
      keys: ["R3TR:CLAS:ZCL_TEST"],
      completedKeys: []
    })
    mocks.getEvents.mockResolvedValue([
      {
        attemptId: "attempt-1",
        objectKey: "R3TR:CLAS:ZCL_TEST",
        stage: "apply",
        status: "succeeded",
        sourceHash: "source-hash",
        targetHash: "target-hash"
      }
    ])
    mocks.getPlanItem.mockResolvedValue({
      key: "R3TR:CLAS:ZCL_TEST",
      sourceHash: "source-hash",
      targetHash: "target-hash"
    })
    mocks.appendEvent.mockImplementation(
      async (_workflowId: string, event: Record<string, unknown>) => event
    )
  })

  it("persists successful activation and marks exactly one object done", async () => {
    const result: any = await new RecordRepositoryWorkflowObjectActivationTool().invoke({
      input: {
        workflowId: "workflow-1",
        objectKey: "r3tr:clas:zcl_test",
        attemptId: "attempt-1",
        status: "succeeded",
        activationObjectUrls: [" /sap/object/1 ", "/sap/object/1", "/sap/object/2"]
      }
    } as any)

    expect(mocks.appendEvent).toHaveBeenNthCalledWith(
      1,
      "workflow-1",
      expect.objectContaining({
        attemptId: "attempt-1",
        objectKey: "R3TR:CLAS:ZCL_TEST",
        stage: "activation",
        status: "succeeded",
        activationObjectUrls: ["/sap/object/1", "/sap/object/2"]
      })
    )
    expect(mocks.appendEvent).toHaveBeenNthCalledWith(
      2,
      "workflow-1",
      expect.objectContaining({ stage: "completion", status: "succeeded" })
    )
    expect(mocks.updateStatus).toHaveBeenCalledWith("workflow-1", ["R3TR:CLAS:ZCL_TEST"], "done")
    expect(mocks.notifyChanged).toHaveBeenCalledWith("workflow-1")
    expect(JSON.parse(result.parts[0].text)).toEqual(expect.objectContaining({ markedDone: true }))
  })

  it("persists failed activation and leaves the object pending", async () => {
    await new RecordRepositoryWorkflowObjectActivationTool().invoke({
      input: {
        workflowId: "workflow-1",
        objectKey: "R3TR:CLAS:ZCL_TEST",
        attemptId: "attempt-1",
        status: "failed",
        activationObjectUrls: ["/sap/object/1"],
        error: "Activation syntax error"
      }
    } as any)

    expect(mocks.appendEvent).toHaveBeenCalledWith(
      "workflow-1",
      expect.objectContaining({
        stage: "activation",
        status: "failed",
        error: "Activation syntax error"
      })
    )
    expect(mocks.updateStatus).not.toHaveBeenCalled()
  })

  it("rejects mode changes, unselected objects, and unknown attempts", async () => {
    mocks.getWorkflow.mockResolvedValueOnce({
      workflowId: "workflow-1",
      assistedApplyMode: "manual",
      copilotAssistedApplyEnabledAt: "2026-10-09T12:00:00.000Z"
    })
    const input = {
      workflowId: "workflow-1",
      objectKey: "R3TR:CLAS:ZCL_TEST",
      attemptId: "attempt-1",
      status: "succeeded",
      activationObjectUrls: ["/sap/object/1"]
    } as const
    await expect(
      new RecordRepositoryWorkflowObjectActivationTool().invoke({ input } as any)
    ).rejects.toThrow(/not enabled/)

    mocks.getSelection.mockResolvedValueOnce({ keys: [] })
    await expect(
      new RecordRepositoryWorkflowObjectActivationTool().invoke({ input } as any)
    ).rejects.toThrow(/not in the user-saved/)

    mocks.getEvents.mockResolvedValueOnce([])
    await expect(
      new RecordRepositoryWorkflowObjectActivationTool().invoke({ input } as any)
    ).rejects.toThrow(/attempt not found/)
  })

  it("requires a verified successful apply and failure details", async () => {
    mocks.getEvents.mockResolvedValueOnce([
      { attemptId: "attempt-1", stage: "apply", status: "partial" }
    ])
    await expect(
      new RecordRepositoryWorkflowObjectActivationTool().invoke({
        input: {
          workflowId: "workflow-1",
          objectKey: "R3TR:CLAS:ZCL_TEST",
          attemptId: "attempt-1",
          status: "succeeded",
          activationObjectUrls: ["/sap/object/1"]
        }
      } as any)
    ).rejects.toThrow(/fully verified/)

    await expect(
      new RecordRepositoryWorkflowObjectActivationTool().invoke({
        input: {
          workflowId: "workflow-1",
          objectKey: "R3TR:CLAS:ZCL_TEST",
          attemptId: "attempt-1",
          status: "failed",
          activationObjectUrls: ["/sap/object/1"]
        }
      } as any)
    ).rejects.toThrow(/activation error/)
  })

  it("rejects an apply attempt recorded for a previous plan", async () => {
    mocks.getPlanItem.mockResolvedValueOnce({
      key: "R3TR:CLAS:ZCL_TEST",
      sourceHash: "source-hash",
      targetHash: "newer-target-hash"
    })
    await expect(
      new RecordRepositoryWorkflowObjectActivationTool().invoke({
        input: {
          workflowId: "workflow-1",
          objectKey: "R3TR:CLAS:ZCL_TEST",
          attemptId: "attempt-1",
          status: "succeeded",
          activationObjectUrls: ["/sap/object/1"]
        }
      } as any)
    ).rejects.toThrow(/current assisted-apply plan/)
    expect(mocks.appendEvent).not.toHaveBeenCalled()
    expect(mocks.updateStatus).not.toHaveBeenCalled()
  })
})
