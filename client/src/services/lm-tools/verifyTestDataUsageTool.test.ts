import * as vscode from "vscode"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { getTestFolder } from "../testing/config"
import { verifyTestDataUsage } from "../testing/verify-test-data"
import {
  VerifyTestDataUsageTool,
  type IVerifyTestDataUsageParameters
} from "./verifyTestDataUsageTool"

vi.mock("vscode", () => ({
  LanguageModelToolResult: class {
    constructor(public parts: unknown[]) {}
  },
  LanguageModelTextPart: class {
    constructor(public text: string) {}
  }
}))
vi.mock("./toolRegistry", () => ({ registerToolWithRegistry: vi.fn() }))
vi.mock("../telemetry", () => ({ logTelemetry: vi.fn() }))
vi.mock("./toolGuard", () => ({ assertToolInvocationAuthorized: vi.fn() }))
vi.mock("../testing/config", () => ({ getTestFolder: vi.fn() }))
vi.mock("../testing/verify-test-data", () => ({ verifyTestDataUsage: vi.fn() }))

function invoke(input: Partial<IVerifyTestDataUsageParameters> = {}) {
  return new VerifyTestDataUsageTool().invoke(
    {
      input: { program: "PROGRAM", tcId: "TC-001", ...input }
    } as vscode.LanguageModelToolInvocationOptions<IVerifyTestDataUsageParameters>,
    {} as vscode.CancellationToken
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getTestFolder).mockReturnValue("/testing")
  vi.mocked(verifyTestDataUsage).mockResolvedValue({
    ok: true,
    skipped: false,
    usedNotDeclared: [],
    declaredNotUsed: [],
    messages: ["OK: data keys checked"]
  })
})

it("retains workflow proof by default", async () => {
  await invoke()
  expect(verifyTestDataUsage).toHaveBeenCalledWith("/testing", "PROGRAM", "TC-001", {
    skipWorkflowValidation: false
  })
})

it("reports the explicit SE16N exception without claiming proof passed", async () => {
  const result = await invoke({
    skipWorkflowValidation: true,
    overrideReason: "User requested data keys only"
  })
  expect(verifyTestDataUsage).toHaveBeenCalledWith("/testing", "PROGRAM", "TC-001", {
    skipWorkflowValidation: true
  })
  expect(JSON.stringify(result)).toContain("WORKFLOW VALIDATION BYPASSED: SE16N workflow proof")
  expect(JSON.stringify(result)).toContain("User requested data keys only")
})

it.each([undefined, "", "   "])("requires a nonblank override reason: %s", async overrideReason => {
  await expect(invoke({ skipWorkflowValidation: true, overrideReason })).rejects.toThrow(
    /nonempty overrideReason/
  )
  expect(verifyTestDataUsage).not.toHaveBeenCalled()
})

it("retains folder and authorization prerequisites", async () => {
  vi.mocked(getTestFolder).mockReturnValue("")
  await expect(invoke()).rejects.toThrow(/No SAP testing folder/)
  vi.mocked(assertToolInvocationAuthorized).mockImplementationOnce(() => {
    throw new Error("Unauthorized")
  })
  await expect(invoke()).rejects.toThrow("Unauthorized")
  expect(verifyTestDataUsage).not.toHaveBeenCalled()
})
