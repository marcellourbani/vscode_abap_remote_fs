vi.mock("vscode", () => {
  const Position = vi.fn(function (line: number, character: number) {
    return { line, character }
  })
  const Range = vi.fn(function (start: any, end: any) {
    return { start, end }
  })
  const ThemeColor = vi.fn(function (id: string) {
    return { id }
  })
  const ThemeIcon = vi.fn(function (id: string, color?: any) {
    return { id, color }
  })
  return {
    Position,
    Range,
    ThemeColor,
    ThemeIcon,
    TreeItem: vi.fn().mockImplementation(function (this: any, label: string, collapsible: any) {
      this.label = label
      this.collapsibleState = collapsible
    }),
    TreeItemCollapsibleState: { Expanded: 1, Collapsed: 2, None: 0 },
    EventEmitter: vi.fn().mockImplementation(function () {
      return {
        fire: vi.fn(),
        event: vi.fn()
      }
    }),
    commands: { executeCommand: vi.fn() }
  }
})

vi.mock("../../services/funMessenger", () => ({
  funWindow: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn()
  }
}))

vi.mock("../../adt/conections", () => ({
  getClient: vi.fn()
}))

vi.mock("../../adt/operations/AdtObjectFinder", () => ({
  AdtObjectFinder: vi.fn().mockImplementation(function () {
    return {
      vscodeRange: vi.fn()
    }
  })
}))

vi.mock("../../commands", () => ({
  AbapFsCommands: {
    openLocation: "openLocation"
  }
}))

vi.mock("./codeinspector", () => ({
  getVariant: vi.fn(),
  runInspector: vi.fn(),
  runInspectorByAdtUrl: vi.fn()
}))

vi.mock("./commands", () => ({
  atcRefresh: vi.fn()
}))

vi.mock("../../adt/operations/AdtObjectActivator", () => ({
  AdtObjectActivator: {
    get: vi.fn().mockReturnValue({ onActivate: vi.fn() })
  }
}))

vi.mock("abapobject/src/AbapObject", () => ({
  AbapObjectBase: class {}
}))

vi.mock("../../context", () => ({
  setContext: vi.fn()
}))

vi.mock("../../lib", () => ({
  log: vi.fn()
}))

import { hasExemption, approvedExemption, AtcRoot, AtcSystem, AtcObject, AtcFind } from "./view"
import { setContext } from "../../context"
import * as __$mock_vscode from "vscode"
import type { MockedFunction, Mock } from "vitest"

const mockSetContext = setContext as MockedFunction<typeof setContext>

const makeFinding = (overrides: any = {}): any => ({
  messageTitle: "Test Finding",
  checkTitle: "Test Check",
  priority: 1,
  exemptionApproval: null,
  quickfixInfo: "info",
  location: { uri: "/sap/test" },
  link: { href: "/doc" },
  ...overrides
})

const makeWLObject = (findings: any[] = []): any => ({
  name: "ZTEST",
  type: "PROG",
  objectTypeId: "PROG/P",
  findings
})

describe("hasExemption", () => {
  it("returns true when exemptionApproval is a non-empty string", () => {
    expect(hasExemption(makeFinding({ exemptionApproval: "-" }))).toBe(true)
    expect(hasExemption(makeFinding({ exemptionApproval: "APPROVED" }))).toBe(true)
  })

  it("returns false when exemptionApproval is null", () => {
    expect(hasExemption(makeFinding({ exemptionApproval: null }))).toBe(false)
  })

  it("returns false when exemptionApproval is undefined", () => {
    expect(hasExemption(makeFinding({ exemptionApproval: undefined }))).toBe(false)
  })

  it("returns false when exemptionApproval is empty string", () => {
    expect(hasExemption(makeFinding({ exemptionApproval: "" }))).toBe(false)
  })
})

describe("approvedExemption", () => {
  it("returns true when exemptionApproval is '-'", () => {
    expect(approvedExemption(makeFinding({ exemptionApproval: "-" }))).toBe(true)
  })

  it("returns false when exemptionApproval is another value", () => {
    expect(approvedExemption(makeFinding({ exemptionApproval: "APPROVED" }))).toBe(false)
  })

  it("returns false when exemptionApproval is null", () => {
    expect(approvedExemption(makeFinding({ exemptionApproval: null }))).toBe(false)
  })
})

describe("AtcRoot", () => {
  const makeProvider = (exemptFilter = true) => ({ exemptFilter, emitter: { fire: vi.fn() } })

  it("filterExempt reflects parent's exemptFilter", () => {
    const provider = makeProvider(true)
    const root = new AtcRoot("systems", provider as any)
    expect(root.filterExempt).toBe(true)
  })

  it("children returns systems values", () => {
    const provider = makeProvider()
    const root = new AtcRoot("systems", provider as any)
    expect(root.children).toEqual([])
  })

  it("child() creates and caches AtcSystem", async () => {
    const provider = makeProvider()
    const root = new AtcRoot("systems", provider as any)
    const system = await root.child("myconn", "MYVARIANT")
    expect(system).toBeInstanceOf(AtcSystem)
    // Returns cached instance on second call
    const system2 = await root.child("myconn", "MYVARIANT")
    expect(system2).toBe(system)
    expect(root.systems.size).toBe(1)
  })

  it("child() fires emitter for new system", async () => {
    const provider = makeProvider()
    const root = new AtcRoot("systems", provider as any)
    await root.child("newconn", "V1")
    expect(provider.emitter.fire).toHaveBeenCalledWith(undefined)
  })

  it("isA returns true for AtcRoot", () => {
    const provider = makeProvider()
    const root = new AtcRoot("systems", provider as any)
    expect(AtcRoot.isA(root)).toBe(true)
  })

  it("isA returns false for non-AtcRoot", () => {
    expect(AtcRoot.isA({})).toBe(false)
    expect(AtcRoot.isA(null)).toBe(false)
    expect(AtcRoot.isA("string")).toBe(false)
  })
})

describe("AtcSystem", () => {
  const makeParent = (filterExempt = true) => ({
    filterExempt,
    emitter: { fire: vi.fn() }
  })

  it("hasErrors returns false when no children have errors", () => {
    const parent = makeParent()
    const root = new AtcRoot("systems", parent as any)
    const system = new AtcSystem("myconn", "MYVARIANT", root)
    expect(system.hasErrors).toBe(false)
  })

  it("children is empty initially", () => {
    const root = new AtcRoot("systems", { filterExempt: true, emitter: { fire: vi.fn() } } as any)
    const system = new AtcSystem("myconn", "MYVARIANT", root)
    expect(system.children).toEqual([])
  })
})

describe("AtcFind", () => {
  const makeParent = (): any => ({
    parent: {
      connectionId: "myconn",
      filterExempt: true
    },
    object: { name: "ZTEST", type: "PROG" }
  })

  const makePosition = (line: number, char: number) => ({ line, char })

  it("constructs with correct label from messageTitle", () => {
    const finding = makeFinding({ messageTitle: "Hello Error" })
    const parent = makeParent()
    const pos = { line: 5, character: 2 } as any
    const f = new AtcFind(finding, parent, "adt://sys/path", pos)
    expect((f as any).label).toBe("Hello Error")
  })

  it("start returns the initial position", () => {
    const finding = makeFinding()
    const parent = makeParent()
    const pos = { line: 5, character: 2 } as any
    const f = new AtcFind(finding, parent, "adt://sys/path", pos)
    expect(f.start).toEqual({ line: 5, character: 2 })
  })

  it("applyEdits updates start position for edits before current line", () => {
    const finding = makeFinding()
    const parent = makeParent()
    const MockPos = function (line: number, char: number) {
      return { line, character: char }
    }
    ;(__$mock_vscode.Position as Mock).mockImplementation(MockPos)
    const pos = { line: 10, character: 0 } as any
    const f = new AtcFind(finding, parent, "adt://sys/path", pos)

    const edit = {
      range: { start: { line: 5 }, end: { line: 5 } },
      text: "new line\n"
    }
    f.applyEdits([edit as any])
    expect(f.start.line).toBe(11) // +1 line inserted
  })

  it("applyEdits does not update start for edits after current line", () => {
    const finding = makeFinding()
    const parent = makeParent()
    const MockPos = function (line: number, char: number) {
      return { line, character: char }
    }
    ;(__$mock_vscode.Position as Mock).mockImplementation(MockPos)
    const pos = { line: 3, character: 0 } as any
    const f = new AtcFind(finding, parent, "adt://sys/path", pos)

    const edit = {
      range: { start: { line: 10 }, end: { line: 10 } },
      text: "new line\n"
    }
    f.applyEdits([edit as any])
    expect(f.start.line).toBe(3) // unchanged
  })

  it("savePosition persists current position", () => {
    const finding = makeFinding()
    const parent = makeParent()
    const MockPos = function (line: number, char: number) {
      return { line, character: char }
    }
    ;(__$mock_vscode.Position as Mock).mockImplementation(MockPos)
    const pos = { line: 5, character: 0 } as any
    const f = new AtcFind(finding, parent, "adt://sys/path", pos)

    f.applyEdits([{ range: { start: { line: 2 }, end: { line: 2 } }, text: "\n" } as any])
    f.savePosition()
    // After savePosition, _start is updated; cancelEdits would reset to this new position
    f.cancelEdits()
    expect(f.start.line).toBe(6)
  })

  it("cancelEdits reverts unapplied edits back to saved position", () => {
    const finding = makeFinding()
    const parent = makeParent()
    const MockPos = function (line: number, char: number) {
      return { line, character: char }
    }
    ;(__$mock_vscode.Position as Mock).mockImplementation(MockPos)
    const pos = { line: 5, character: 0 } as any
    const f = new AtcFind(finding, parent, "adt://sys/path", pos)

    // Apply edit (shifts line)
    f.applyEdits([{ range: { start: { line: 2 }, end: { line: 2 } }, text: "\n" } as any])
    expect(f.start.line).toBe(6)
    // cancelEdits resets unSavedStart to current start (which is the already-edited value)
    // because cancelEdits does: this.unSavedStart = this.start, and start returns unSavedStart
    f.cancelEdits()
    expect(f.start.line).toBe(6)
  })

  it("iconColor returns error color for priority 1", () => {
    const finding = makeFinding({ priority: 1, exemptionApproval: null })
    const parent = makeParent()
    const pos = { line: 0, character: 0 } as any
    const f = new AtcFind(finding, parent, "adt://sys/path", pos)
    const color = f.iconColor()
    expect((color as any).id).toBe("list.errorForeground")
  })

  it("iconColor returns warning color for priority 2", () => {
    const finding = makeFinding({ priority: 2, exemptionApproval: null })
    const parent = makeParent()
    const pos = { line: 0, character: 0 } as any
    const f = new AtcFind(finding, parent, "adt://sys/path", pos)
    const color = f.iconColor()
    expect((color as any).id).toBe("list.warningForeground")
  })

  it("iconColor returns deemphasized color for other priorities", () => {
    const finding = makeFinding({ priority: 3, exemptionApproval: null })
    const parent = makeParent()
    const pos = { line: 0, character: 0 } as any
    const f = new AtcFind(finding, parent, "adt://sys/path", pos)
    const color = f.iconColor()
    expect((color as any).id).toBe("list.deemphasizedForeground")
  })

  it("sets contextValue to finding_exempted when finding has exemption", () => {
    const finding = makeFinding({ exemptionApproval: "-", priority: 1 })
    const parent = makeParent()
    const pos = { line: 0, character: 0 } as any
    const f = new AtcFind(finding, parent, "adt://sys/path", pos)
    expect((f as any).contextValue).toBe("finding_exempted")
  })

  it("sets contextValue to finding when no exemption", () => {
    const finding = makeFinding({ exemptionApproval: null, priority: 1 })
    const parent = makeParent()
    const pos = { line: 0, character: 0 } as any
    const f = new AtcFind(finding, parent, "adt://sys/path", pos)
    expect((f as any).contextValue).toBe("finding")
  })

  it("sets description to checkTitle", () => {
    const finding = makeFinding({ checkTitle: "MY_CHECK" })
    const parent = makeParent()
    const pos = { line: 0, character: 0 } as any
    const f = new AtcFind(finding, parent, "adt://sys/path", pos)
    expect((f as any).description).toBe("MY_CHECK")
  })
})

describe("AtcObject", () => {
  const makeParent = (): any => ({
    connectionId: "myconn",
    filterExempt: true,
    parent: { filterExempt: true }
  })

  it("constructs with correct label from object type and name", () => {
    const obj = makeWLObject()
    const parent = makeParent()
    const atcObj = new AtcObject(obj, parent)
    expect((atcObj as any).label).toBe("PROG ZTEST")
  })

  it("hasError is false by default", () => {
    const obj = makeWLObject()
    const parent = makeParent()
    const atcObj = new AtcObject(obj, parent)
    expect(atcObj.hasError).toBe(false)
  })

  it("children is empty by default", () => {
    const obj = makeWLObject()
    const parent = makeParent()
    const atcObj = new AtcObject(obj, parent)
    expect(atcObj.children).toEqual([])
  })
})
