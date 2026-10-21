import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("vscode", () => ({
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  TabInputText: class {
    constructor(public uri: unknown) {}
  },
  Uri: {
    parse: vi.fn((value: string) => ({ scheme: "adt", toString: () => value }))
  },
  window: { tabGroups: { all: [] } },
  languages: { getDiagnostics: vi.fn() }
}))

vi.mock("../../langClient", () => ({ triggerSyntaxCheck: vi.fn() }))

import * as vscode from "vscode"
import { triggerSyntaxCheck } from "../../langClient"
import { getDiagnosticsForUri } from "./mcpGetDiagnosticsTool"
import type { Mock } from "vitest"

describe("getDiagnosticsForUri", () => {
  const fileUri = "adt://dev100/test.prog.abap"
  const makeDiagnostic = (source: string, severity: number, line: number, message: string) => ({
    source,
    severity,
    message,
    range: { start: { line, character: 2 } },
    code: undefined
  })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    ;(vscode.window.tabGroups as any).all = [
      {
        tabs: [
          {
            input: new (vscode.TabInputText as any)({ toString: () => fileUri })
          }
        ]
      }
    ]
    ;(vscode.languages.getDiagnostics as Mock).mockReturnValue([
      makeDiagnostic("ABAPfs", vscode.DiagnosticSeverity.Error, 0, "Syntax error"),
      makeDiagnostic("abaplint", vscode.DiagnosticSeverity.Information, 1, "Style note"),
      makeDiagnostic("abaplint", vscode.DiagnosticSeverity.Warning, 2, "Lint warning")
    ])
  })

  afterEach(() => vi.useRealTimers())

  async function read(params: Parameters<typeof getDiagnosticsForUri>[0]) {
    const pending = getDiagnosticsForUri(params)
    await vi.advanceTimersByTimeAsync(1000)
    return JSON.parse(await pending)
  }

  it("filters by exact source and VS Code severity without inspecting message text", async () => {
    const result = await read({ fileUri, source: "abapfs", severity: "error" })

    expect(result).toMatchObject({
      filters: { source: "abapfs", severity: "error" },
      summary: { totalDiagnostics: 1 },
      diagnostics: [{ source: "ABAPfs", severity: "ERROR", message: "Syntax error" }]
    })
  })

  it("returns bounded pages from a cached snapshot without rechecking", async () => {
    const first = await read({ fileUri, resultStart: 1, resultEnd: 2 })
    const second = await read({ resultId: first.resultId, resultStart: first.nextStart })

    expect(first).toMatchObject({ resultStart: 1, resultEnd: 2, returned: 2, hasMore: true })
    expect(second).toMatchObject({ resultStart: 3, resultEnd: 3, returned: 1, hasMore: false })
    expect(second.diagnostics[0].message).toBe("Lint warning")
    expect(triggerSyntaxCheck).toHaveBeenCalledTimes(1)
  })

  it("keeps the original filters when later pages omit them", async () => {
    const first = await read({ fileUri, source: "abaplint", resultEnd: 1 })
    const second = await read({ resultId: first.resultId, resultStart: first.nextStart })

    expect(first.filters).toEqual({ source: "abaplint", severity: "all" })
    expect(second.filters).toEqual({ source: "abaplint", severity: "all" })
    expect(second.diagnostics[0].message).toBe("Lint warning")
    expect(triggerSyntaxCheck).toHaveBeenCalledTimes(1)
  })

  it("explains that a changed filter requires a new result", async () => {
    const first = await read({ fileUri, source: "abapfs" })

    await expect(getDiagnosticsForUri({ resultId: first.resultId, source: "all" })).rejects.toThrow(
      /created with source="abapfs".*Omit source/
    )
  })

  it("rejects invalid page ranges before requesting diagnostics", async () => {
    await expect(getDiagnosticsForUri({ fileUri, resultStart: 0 })).rejects.toThrow(
      /positive integers/
    )
    await expect(getDiagnosticsForUri({ fileUri, resultStart: 1, resultEnd: 101 })).rejects.toThrow(
      /at most 100/
    )
    expect(triggerSyntaxCheck).not.toHaveBeenCalled()
  })
})
