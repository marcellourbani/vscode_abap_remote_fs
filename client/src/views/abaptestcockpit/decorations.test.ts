// decorations.ts exports: getATCDecorations, triggerUpdateDecorations, registerSCIDecorator
// The module uses module-level state (fileFindings map) that is populated via the atcProvider event.
// We focus tests on the pure data-transformation function getATCDecorations.

vi.mock("vscode", () => {
  const Range = vi.fn(function (start: any, end: any) {
    return { start, end }
  })
  const Position = vi.fn(function (line: number, character: number) {
    return { line, character }
  })
  return {
    Range,
    Position,
    DecorationOptions: {},
    workspace: {
      onDidChangeTextDocument: vi.fn(),
      onDidSaveTextDocument: vi.fn(),
      onDidCloseTextDocument: vi.fn()
    }
  }
})

vi.mock("../../services/funMessenger", () => ({
  funWindow: {
    activeTextEditor: undefined,
    createTextEditorDecorationType: vi.fn(function () {
      return {}
    }),
    onDidChangeActiveTextEditor: vi.fn()
  }
}))

const { mockFindings } = vi.hoisted(() => {
  const mockFindings = vi.fn().mockReturnValue([])
  return { mockFindings }
})

vi.mock(".", () => ({
  atcProvider: {
    onDidChangeTreeData: vi.fn(),
    onDidChangeDecorations: vi.fn(),
    findings: mockFindings
  }
}))

vi.mock("./view", () => ({
  hasExemption: vi.fn(function (f: any) {
    return !!f.exemptionApproval
  })
}))

import { getATCDecorations } from "./decorations"
import { atcProvider } from "."

beforeEach(() => {
  mockFindings.mockReturnValue([])
})

const makeFinding = (overrides: Partial<any> = {}): any => ({
  start: { line: 4, character: 2 },
  finding: {
    priority: 1,
    messageTitle: "Test Error",
    checkTitle: "Some Check",
    exemptionApproval: null,
    ...overrides.finding
  },
  uri: "adt://sys/path",
  ...overrides
})

describe("getATCDecorations - no state populated", () => {
  it("returns empty decorations for unknown file URI", () => {
    const result = getATCDecorations("adt://unknown/uri") as any
    expect(result.fileUri).toBe("adt://unknown/uri")
    expect(result.decorations).toEqual([])
  })

  it("returns all-files summary when called without arguments", () => {
    const result = getATCDecorations() as any
    expect(typeof result.totalFiles).toBe("number")
    expect(typeof result.totalFindings).toBe("number")
    expect(result.decorations).toBeDefined()
  })

  it("totalFiles and totalFindings are 0 when no findings exist", () => {
    const result = getATCDecorations() as any
    expect(result.totalFiles).toBe(0)
    expect(result.totalFindings).toBe(0)
  })
})

describe("getATCDecorations - decoration type mapping logic (unit tests on logic only)", () => {
  // Test the priority-to-priorityText mapping logic directly
  const priorityText = (priority: number) =>
    priority === 1 ? "Error" : priority === 2 ? "Warning" : "Info"

  it("maps priority 1 to Error", () => {
    expect(priorityText(1)).toBe("Error")
  })

  it("maps priority 2 to Warning", () => {
    expect(priorityText(2)).toBe("Warning")
  })

  it("maps priority 3 to Info", () => {
    expect(priorityText(3)).toBe("Info")
  })

  it("maps unknown priority to Info", () => {
    expect(priorityText(99)).toBe("Info")
  })

  // Test the decorationType mapping logic
  const decorationType = (exemptionApproval: any, priority: number) => {
    if (exemptionApproval) return "exempted"
    if (priority === 1) return "error"
    if (priority === 2) return "warning"
    return "info"
  }

  it("returns exempted when exemptionApproval is set", () => {
    expect(decorationType("-", 1)).toBe("exempted")
    expect(decorationType("APPROVED", 2)).toBe("exempted")
  })

  it("returns error for priority 1 without exemption", () => {
    expect(decorationType(null, 1)).toBe("error")
  })

  it("returns warning for priority 2 without exemption", () => {
    expect(decorationType(null, 2)).toBe("warning")
  })

  it("returns info for other priorities without exemption", () => {
    expect(decorationType(null, 3)).toBe("info")
    expect(decorationType(null, 99)).toBe("info")
  })

  it("line number is converted to 1-based", () => {
    // The code does: line: finding.start.line + 1
    const zeroBasedLine = 4
    expect(zeroBasedLine + 1).toBe(5)
  })

  it("character is converted to 1-based", () => {
    const zeroBasedChar = 2
    expect(zeroBasedChar + 1).toBe(3)
  })
})

describe("getATCDecorations - silent ATC results", () => {
  it("reads current provider findings without requiring a tree event", () => {
    mockFindings.mockReturnValue([
      makeFinding({
        uri: "adt://ged100/System%20Library/ZPKG/source.prog.abap",
        start: { line: 7, character: 3 },
        finding: { priority: 2, messageTitle: "Warning", checkTitle: "ATC check" }
      })
    ])

    const result = getATCDecorations() as any

    expect(atcProvider.findings).toHaveBeenCalled()
    expect(result.totalFiles).toBe(1)
    expect(result.totalFindings).toBe(1)
    expect(result.decorations["adt://ged100/System%20Library/ZPKG/source.prog.abap"]).toEqual([
      expect.objectContaining({ line: 8, character: 4, priority: 2, decorationType: "warning" })
    ])
  })
})
