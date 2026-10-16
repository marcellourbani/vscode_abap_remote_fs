import { vi } from "vitest"

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
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
      engine: { applyCopilotAssistedObject: mocks.apply },
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

import { ApplyRepositoryWorkflowObjectTool } from "./repositoryWorkflowApplyTool"

describe("ApplyRepositoryWorkflowObjectTool", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.apply.mockResolvedValue({
      attemptId: "attempt-1",
      objectKey: "R3TR:PROG:ZTEST",
      status: "succeeded",
      transportRequest: "DEVK900123",
      inactiveSourceVerified: true,
      resourceResults: [
        {
          intentId: "intent-1",
          resourcePath: "resource",
          status: "succeeded",
          inactiveSourceVerified: true
        }
      ]
    })
  })

  it("forwards exactly one workflow object and the user-approved transport", async () => {
    const token = { isCancellationRequested: false } as any
    const result: any = await new ApplyRepositoryWorkflowObjectTool().invoke(
      {
        input: {
          workflowId: "workflow-1",
          objectKey: "r3tr:prog:ztest",
          transportChoice: { type: "existing", number: "DEVK900123" }
        }
      } as any,
      token
    )

    expect(mocks.authorize).toHaveBeenCalled()
    expect(mocks.apply).toHaveBeenCalledWith(
      "workflow-1",
      "r3tr:prog:ztest",
      { type: "existing", number: "DEVK900123" },
      token
    )
    expect(mocks.notifyChanged).toHaveBeenCalledWith("workflow-1")
    expect(JSON.parse(result.parts[0].text)).toEqual(
      expect.objectContaining({
        objectKey: "R3TR:PROG:ZTEST",
        attemptId: "attempt-1",
        status: "succeeded",
        inactiveSourceVerified: true,
        activationRequired: true,
        markedDone: false
      })
    )
  })

  it("reports a timed-out save as unknown and does not imply activation", async () => {
    mocks.apply.mockResolvedValue({
      attemptId: "attempt-1",
      objectKey: "R3TR:PROG:ZTEST",
      status: "timed-out",
      inactiveSourceVerified: false,
      resourceResults: [
        {
          intentId: "intent-1",
          resourcePath: "resource",
          status: "timed-out",
          error: "Save result is still unknown"
        }
      ]
    })

    const result: any = await new ApplyRepositoryWorkflowObjectTool().invoke(
      {
        input: {
          workflowId: "workflow-1",
          objectKey: "R3TR:PROG:ZTEST",
          transportChoice: { type: "new", description: "Approved request" }
        }
      } as any,
      {} as any
    )

    expect(JSON.parse(result.parts[0].text)).toEqual(
      expect.objectContaining({
        status: "timed-out",
        activationRequired: false,
        markedDone: false
      })
    )
  })

  it("accepts an explicit local choice for a local workflow object", async () => {
    await new ApplyRepositoryWorkflowObjectTool().invoke(
      {
        input: {
          workflowId: "workflow-1",
          objectKey: "R3TR:PROG:ZLOCAL",
          transportChoice: { type: "local" }
        }
      } as any,
      {} as any
    )

    expect(mocks.apply).toHaveBeenCalledWith(
      "workflow-1",
      "R3TR:PROG:ZLOCAL",
      { type: "local" },
      expect.anything()
    )
  })
})
