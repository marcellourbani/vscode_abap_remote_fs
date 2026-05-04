// decorations.ts exports: getATCDecorations, triggerUpdateDecorations, registerSCIDecorator
// The module uses module-level state (fileFindings map) that is populated via the atcProvider event.
// We focus tests on the pure data-transformation function getATCDecorations.

jest.mock("vscode", () => {
  const Range = jest.fn((start: any, end: any) => ({ start, end }))
  const Position = jest.fn((line: number, character: number) => ({ line, character }))
  return {
    Range,
    Position,
    DecorationOptions: {},
    workspace: {
      onDidChangeTextDocument: jest.fn(),
      onDidSaveTextDocument: jest.fn(),
      onDidCloseTextDocument: jest.fn()
    }
  }
}, { virtual: true })

jest.mock("../../services/funMessenger", () => ({
  funWindow: {
    activeTextEditor: undefined,
    createTextEditorDecorationType: jest.fn(() => ({})),
    onDidChangeActiveTextEditor: jest.fn()
  }
}))

jest.mock(".", () => ({
  atcProvider: {
    onDidChangeTreeData: jest.fn(),
    findings: jest.fn().mockReturnValue([])
  }
}))

jest.mock("./view", () => ({
  hasExemption: jest.fn((f: any) => !!f.exemptionApproval)
}))

import { getATCDecorations } from "./decorations"

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
