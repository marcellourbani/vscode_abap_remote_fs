import { vi, type Mock } from "vitest"

vi.mock("vscode", () => ({
  LanguageModelToolResult: vi.fn().mockImplementation(function (parts: any[]) {
    return { parts }
  }),
  LanguageModelTextPart: vi.fn().mockImplementation(function (text: string) {
    return { text }
  })
}))

vi.mock("../../config", () => ({
  connectedRoots: vi.fn()
}))

vi.mock("./toolGuard", () => ({
  assertToolInvocationAuthorized: vi.fn()
}))

vi.mock("./toolRegistry", () => ({
  registerToolWithRegistry: vi.fn()
}))

vi.mock("../repositoryWorkflow/runtime", () => ({
  RepositoryWorkflowRuntime: {
    get: vi.fn()
  }
}))

vi.mock("../repositoryWorkflow/workflowStore", async importOriginal => ({
  ...(await importOriginal<typeof import("../repositoryWorkflow/workflowStore")>()),
  defaultWorkflowName: vi.fn()
}))

vi.mock("../repositoryWorkflow/snapshotService", () => ({
  objectFolderId: vi.fn()
}))

import { RepositoryWorkflowRuntime } from "../repositoryWorkflow/runtime"
import { GetRepositoryWorkflowTool } from "./repositoryWorkflowTools"

const actions = [
  {
    action: "get",
    input: {}
  },
  {
    action: "markDone",
    input: { assistedApplyObjectKeys: ["R3TR:PROG:ZTEST"] }
  },
  {
    action: "markPending",
    input: { assistedApplyObjectKeys: ["R3TR:PROG:ZTEST"] }
  },
  {
    action: "setDecision",
    input: {
      objectKey: "R3TR:PROG:ZTEST",
      assistedApplyDecision: "as-is",
      assistedApplyDecisionReason: "Reviewed source change is safe to apply as-is."
    }
  }
] as const

describe("GetRepositoryWorkflowTool Copilot-assisted apply authorization", () => {
  const store = {
    get: vi.fn(),
    getCopilotAssistedApplySelection: vi.fn(),
    updateCopilotAssistedApplyStatus: vi.fn(),
    updateCopilotAssistedApplyDecision: vi.fn(),
    getAssistedApplyExecutionEvents: vi.fn(),
    getAssistedApplyExecutionSummaries: vi.fn(),
    getAssistedApplyPlanItem: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(RepositoryWorkflowRuntime.get as Mock).mockReturnValue({
      ready: Promise.resolve(),
      store,
      notifyChanged: vi.fn()
    })
    store.getAssistedApplyExecutionEvents.mockResolvedValue([])
    store.getAssistedApplyExecutionSummaries.mockResolvedValue({})
  })

  it.each(actions)(
    "rejects $action when the workflow is currently in manual mode",
    async ({ action, input }) => {
      store.get.mockResolvedValue({
        workflowId: "workflow-1",
        assistedApplyMode: "manual",
        copilotAssistedApplyEnabledAt: "2026-10-09T12:00:00.000Z"
      })
      const tool = new GetRepositoryWorkflowTool()

      await expect(
        tool.invoke({
          input: {
            workflowId: "workflow-1",
            include: ["assistedApplyObjects"],
            assistedApplyAction: action,
            ...input
          }
        } as any)
      ).rejects.toThrow("Copilot-assisted apply is not enabled for this workflow")

      expect(store.updateCopilotAssistedApplyStatus).not.toHaveBeenCalled()
      expect(store.updateCopilotAssistedApplyDecision).not.toHaveBeenCalled()
      expect(store.getCopilotAssistedApplySelection).not.toHaveBeenCalled()
    }
  )

  it.each(actions)(
    "rejects $action when Copilot mode has no recorded user consent",
    async ({ action, input }) => {
      store.get.mockResolvedValue({
        workflowId: "workflow-1",
        assistedApplyMode: "copilot"
      })
      const tool = new GetRepositoryWorkflowTool()

      await expect(
        tool.invoke({
          input: {
            workflowId: "workflow-1",
            include: ["assistedApplyObjects"],
            assistedApplyAction: action,
            ...input
          }
        } as any)
      ).rejects.toThrow("Copilot-assisted apply is not enabled for this workflow")

      expect(store.updateCopilotAssistedApplyStatus).not.toHaveBeenCalled()
      expect(store.updateCopilotAssistedApplyDecision).not.toHaveBeenCalled()
      expect(store.getCopilotAssistedApplySelection).not.toHaveBeenCalled()
    }
  )

  it("passes the required decision reason for one enabled Copilot-assisted object", async () => {
    store.get.mockResolvedValue({
      workflowId: "workflow-1",
      assistedApplyMode: "copilot",
      copilotAssistedApplyEnabledAt: "2026-10-09T12:00:00.000Z"
    })
    store.updateCopilotAssistedApplyDecision.mockResolvedValue({})
    store.getCopilotAssistedApplySelection.mockResolvedValue(undefined)
    const tool = new GetRepositoryWorkflowTool()

    await tool.invoke({
      input: {
        workflowId: "workflow-1",
        include: ["assistedApplyObjects"],
        assistedApplyAction: "setDecision",
        objectKey: "R3TR:PROG:ZTEST",
        assistedApplyDecision: "needs-human",
        assistedApplyDecisionReason: "Target contains changes that require a human review."
      }
    } as any)

    expect(store.updateCopilotAssistedApplyDecision).toHaveBeenCalledWith(
      "workflow-1",
      "R3TR:PROG:ZTEST",
      "needs-human",
      "Target contains changes that require a human review."
    )
  })

  it("marks done only with a completion recorded for the current plan item", async () => {
    store.get.mockResolvedValue({
      workflowId: "workflow-1",
      assistedApplyMode: "copilot",
      copilotAssistedApplyEnabledAt: "2026-10-09T12:00:00.000Z"
    })
    store.getAssistedApplyPlanItem.mockResolvedValue({
      key: "R3TR:PROG:ZTEST",
      sourceHash: "source-new",
      targetHash: "target-new"
    })
    store.getCopilotAssistedApplySelection.mockResolvedValue(undefined)
    store.updateCopilotAssistedApplyStatus.mockResolvedValue({})
    const staleAttempt = [
      {
        attemptId: "old",
        stage: "apply",
        status: "succeeded",
        sourceHash: "source-old",
        targetHash: "target-old"
      },
      { attemptId: "old", stage: "completion", status: "succeeded" }
    ]
    const input = {
      workflowId: "workflow-1",
      include: ["assistedApplyObjects"],
      assistedApplyAction: "markDone",
      assistedApplyObjectKeys: ["R3TR:PROG:ZTEST"]
    }
    store.getAssistedApplyExecutionEvents.mockResolvedValue(staleAttempt)

    await expect(new GetRepositoryWorkflowTool().invoke({ input } as any)).rejects.toThrow(
      /cannot be marked done/
    )
    expect(store.updateCopilotAssistedApplyStatus).not.toHaveBeenCalled()

    store.getAssistedApplyExecutionEvents.mockResolvedValue([
      ...staleAttempt,
      {
        attemptId: "new",
        stage: "apply",
        status: "succeeded",
        sourceHash: "source-new",
        targetHash: "target-new"
      },
      { attemptId: "new", stage: "completion", status: "succeeded" }
    ])
    await new GetRepositoryWorkflowTool().invoke({ input } as any)
    expect(store.updateCopilotAssistedApplyStatus).toHaveBeenCalledWith(
      "workflow-1",
      ["R3TR:PROG:ZTEST"],
      "done"
    )
  })

  it("returns bounded persisted execution history for one opted-in object", async () => {
    store.get.mockResolvedValue({
      workflowId: "workflow-1",
      assistedApplyMode: "copilot",
      copilotAssistedApplyEnabledAt: "2026-10-09T12:00:00.000Z"
    })
    store.getAssistedApplyExecutionEvents.mockResolvedValue([
      { eventId: "1", objectKey: "R3TR:PROG:ZTEST", stage: "apply", status: "started" },
      { eventId: "2", objectKey: "R3TR:PROG:ZTEST", stage: "save", status: "succeeded" }
    ])

    const result: any = await new GetRepositoryWorkflowTool().invoke({
      input: {
        workflowId: "workflow-1",
        include: ["assistedApplyHistory"],
        objectKey: "r3tr:prog:ztest",
        offset: 1,
        limit: 1
      }
    } as any)
    const response = JSON.parse(result.parts[0].text)

    expect(store.getAssistedApplyExecutionEvents).toHaveBeenCalledWith(
      "workflow-1",
      "r3tr:prog:ztest"
    )
    expect(response.assistedApplyHistory).toEqual(
      expect.objectContaining({
        objectKey: "R3TR:PROG:ZTEST",
        total: 2,
        returned: 1,
        events: [expect.objectContaining({ eventId: "2" })]
      })
    )
  })
})
