import * as vscode from "vscode"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { getTestFolder } from "../testing/config"
import { buildTestIndex } from "../testing/build-index"
import { buildTestIndexDocx } from "../testing/build-index-docx"
import { BuildTestIndexTool, type IBuildTestIndexParameters } from "./buildTestIndexTool"

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
vi.mock("../testing/build-index", () => ({ buildTestIndex: vi.fn() }))
vi.mock("../testing/build-index-docx", () => ({ buildTestIndexDocx: vi.fn() }))

const confirmation = "I called the reviewer agent and it passed all test cases"
const bypass = {
  skipWorkflowValidation: true,
  overrideReason: "User requested index generation without review"
}

function invoke(input: Partial<IBuildTestIndexParameters> = {}) {
  return new BuildTestIndexTool().invoke(
    {
      input: { program: "PROGRAM", sourceSnapshot: "snapshot", ...input }
    } as vscode.LanguageModelToolInvocationOptions<IBuildTestIndexParameters>,
    {} as vscode.CancellationToken
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getTestFolder).mockReturnValue("/testing")
  vi.mocked(buildTestIndex).mockResolvedValue({
    indexPath: "/testing/_index.md",
    analyzedOn: "2026-01-01",
    sourceSnapshot: "snapshot",
    caseCount: 1,
    counts: { runnable: 1, manual: 0, blocked: 0, elsewhere: 0 },
    warnings: []
  })
  vi.mocked(buildTestIndexDocx).mockResolvedValue("/testing/_index.docx")
})

describe("BuildTestIndexTool workflow validation", () => {
  it.each([undefined, "", "not reviewed"])("enforces default confirmation: %s", async value => {
    await expect(invoke({ reviewerConfirmation: value })).rejects.toThrow(/reviewerConfirmation/)
    expect(buildTestIndex).not.toHaveBeenCalled()
  })

  it("does not treat a reason alone as permission to bypass", async () => {
    await expect(invoke({ overrideReason: bypass.overrideReason })).rejects.toThrow(
      /reviewerConfirmation/
    )
  })

  it("accepts the strict confirmation without a bypass notice", async () => {
    const result = await invoke({ reviewerConfirmation: `${confirmation}.` })
    expect(JSON.stringify(result)).toContain("Wrote /testing/_index.md")
    expect(JSON.stringify(result)).not.toContain("BYPASSED")
    expect(buildTestIndex).toHaveBeenCalledWith("/testing", "PROGRAM", "snapshot", {
      skipWorkflowValidation: false
    })
  })

  it("allows bypass without reviewer artifacts or certification and reports the exception", async () => {
    const result = await invoke(bypass)
    expect(buildTestIndex).toHaveBeenCalledWith("/testing", "PROGRAM", "snapshot", {
      skipWorkflowValidation: true
    })
    expect(buildTestIndexDocx).toHaveBeenCalledWith("/testing", "PROGRAM")
    const output = JSON.stringify(result)
    expect(output).toContain("WORKFLOW VALIDATION BYPASSED: reviewer confirmation")
    expect(output).toContain(bypass.overrideReason)
    expect(output).toContain("not verified")
    expect(output).toContain("source snapshot validation and SQL/mixed se16nTables requirements")
    expect(output).toContain("historical; not revalidated")
    expect(output).not.toContain(confirmation)
  })

  it("accepts an omitted snapshot under override without claiming source certification", async () => {
    vi.mocked(buildTestIndex).mockResolvedValueOnce({
      indexPath: "/testing/_index.md",
      analyzedOn: "",
      sourceSnapshot: "",
      caseCount: 1,
      counts: { runnable: 1, manual: 0, blocked: 0, elsewhere: 0 },
      warnings: []
    })
    const result = await invoke({ ...bypass, sourceSnapshot: undefined })
    expect(buildTestIndex).toHaveBeenCalledWith("/testing", "PROGRAM", undefined, {
      skipWorkflowValidation: true
    })
    expect(JSON.stringify(result)).toContain("analyzedOn: not certified")
    expect(JSON.stringify(result)).toContain("sourceSnapshot: none (not verified by this rebuild)")
  })

  it.each([undefined, "", "   "])("rejects a bypass without a reason: %s", async overrideReason => {
    await expect(invoke({ ...bypass, overrideReason })).rejects.toThrow(/nonempty overrideReason/)
    expect(buildTestIndex).not.toHaveBeenCalled()
  })

  it("retains authorization checks", async () => {
    vi.mocked(assertToolInvocationAuthorized).mockImplementationOnce(() => {
      throw new Error("Unauthorized")
    })
    await expect(invoke(bypass)).rejects.toThrow("Unauthorized")
    expect(getTestFolder).not.toHaveBeenCalled()
    expect(buildTestIndex).not.toHaveBeenCalled()
  })

  it("retains folder configuration checks", async () => {
    vi.mocked(getTestFolder).mockReturnValue("")
    await expect(invoke(bypass)).rejects.toThrow(/No SAP testing folder/)
    expect(buildTestIndex).not.toHaveBeenCalled()
  })

  it("retains index input validation", async () => {
    vi.mocked(buildTestIndex).mockRejectedValueOnce(new Error("Invalid source snapshot"))
    await expect(invoke(bypass)).rejects.toThrow("Invalid source snapshot")
    expect(buildTestIndexDocx).not.toHaveBeenCalled()
  })
})
