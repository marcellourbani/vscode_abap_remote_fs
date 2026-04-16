jest.mock("vscode", () => {
  const Position = jest.fn((line: number, character: number) => ({ line, character }))
  const Range = jest.fn((start: any, end: any) => ({ start, end }))
  const Uri = {
    parse: jest.fn((s: string) => ({
      toString: () => s,
      scheme: s.split("://")[0] || "",
      authority: s.split("://")[1]?.split("/")[0] || "",
      path: "/" + (s.split("://")[1]?.split("/").slice(1).join("/") || ""),
      with: jest.fn(function (this: any, changes: any) { return { ...this, ...changes } })
    }))
  }
  return { Position, Range, Uri, ProgressLocation: { Window: 10, Notification: 15 } }
}, { virtual: true })

jest.mock("../services/funMessenger", () => ({
  funWindow: {
    withProgress: jest.fn((_opts: any, cb: any) => cb()),
    showOpenDialog: jest.fn(),
    showInputBox: jest.fn(),
    showQuickPick: jest.fn(),
    showErrorMessage: jest.fn()
  }
}))

jest.mock("./rfsTaskEither", () => ({
  rfsTryCatch: jest.fn((fn: any) => fn)
}))

jest.mock("./functions", () => ({
  splitAdtUriInternal: jest.fn(),
  isUnDefined: jest.fn((x: any) => x === undefined),
  isFn: jest.fn((x: any) => typeof x === "function"),
  isNonNullable: jest.fn((x: any) => x !== null && x !== undefined),
  caughtToString: jest.fn((e: any) => String(e)),
  isString: jest.fn((x: any) => typeof x === "string")
}))

jest.mock("../adt/conections", () => ({
  ADTSCHEME: "adt"
}))

import {
  uriName,
  withp,
  showErrorMessage,
  inputBox,
  simpleInputBox,
  quickPick,
  createStore,
  vscPosition,
  rangeApi2Vsc,
  lineRange,
  rangeVscToApi,
  splitAdtUri,
  createAdtUri
} from "./vscodefunctions"
import { splitAdtUriInternal, isUnDefined, isFn, isNonNullable } from "./functions"
import { funWindow as window } from "../services/funMessenger"
import { Uri, Position, Range } from "vscode"

const mockSplitAdtUriInternal = splitAdtUriInternal as jest.MockedFunction<typeof splitAdtUriInternal>
const mockIsUnDefined = isUnDefined as jest.MockedFunction<typeof isUnDefined>

describe("uriName", () => {
  it("returns the last path segment", () => {
    const uri = { path: "/sap/bc/adt/programs/ZTEST" } as any
    expect(uriName(uri)).toBe("ZTEST")
  })

  it("returns empty string for root path", () => {
    const uri = { path: "/" } as any
    expect(uriName(uri)).toBe("")
  })

  it("returns the file segment for nested path", () => {
    const uri = { path: "/a/b/c/d" } as any
    expect(uriName(uri)).toBe("d")
  })

  it("handles single segment path", () => {
    const uri = { path: "/single" } as any
    expect(uriName(uri)).toBe("single")
  })
})

describe("showErrorMessage", () => {
  beforeEach(() => jest.clearAllMocks())

  it("calls window.showErrorMessage with stringified error", () => {
    showErrorMessage(new Error("test error"))
    expect(window.showErrorMessage).toHaveBeenCalled()
  })

  it("uses defaultMsg when error is empty", () => {
    showErrorMessage("", "default message")
    expect(window.showErrorMessage).toHaveBeenCalled()
  })
})

describe("vscPosition", () => {
  beforeEach(() => {
    ;(Position as jest.Mock).mockImplementation((line: number, char: number) => ({ line, character: char }))
  })

  it("converts 1-based ADT line to 0-based VS Code line", () => {
    const pos = vscPosition(5, 10)
    expect(pos.line).toBe(4)
    expect(pos.character).toBe(10)
  })

  it("handles line 1 (converts to 0)", () => {
    const pos = vscPosition(1, 0)
    expect(pos.line).toBe(0)
  })

  it("handles line 0 (stays at 0 per boundary check)", () => {
    const pos = vscPosition(0, 5)
    expect(pos.line).toBe(0)
  })

  it("handles negative line numbers by returning 0", () => {
    const pos = vscPosition(-1, 0)
    expect(pos.line).toBe(0)
  })
})

describe("rangeApi2Vsc", () => {
  beforeEach(() => {
    ;(Position as jest.Mock).mockImplementation((line: number, char: number) => ({ line, character: char }))
    ;(Range as jest.Mock).mockImplementation((start: any, end: any) => ({ start, end }))
  })

  it("converts API range to VS Code range", () => {
    const apiRange = {
      start: { line: 5, column: 10 },
      end: { line: 7, column: 3 }
    }
    const result = rangeApi2Vsc(apiRange)
    expect(result.start.line).toBe(4) // 5-1
    expect(result.start.character).toBe(10)
    expect(result.end.line).toBe(6) // 7-1
    expect(result.end.character).toBe(3)
  })

  it("handles single-line range", () => {
    const apiRange = {
      start: { line: 3, column: 0 },
      end: { line: 3, column: 20 }
    }
    const result = rangeApi2Vsc(apiRange)
    expect(result.start.line).toBe(result.end.line)
  })
})

describe("rangeVscToApi", () => {
  it("converts VS Code range to API range", () => {
    const vscRange = {
      start: { line: 4, character: 10 },
      end: { line: 6, character: 3 }
    } as any
    const result = rangeVscToApi(vscRange)
    expect(result.start.line).toBe(5) // 4+1
    expect(result.start.column).toBe(10)
    expect(result.end.line).toBe(7) // 6+1
    expect(result.end.column).toBe(3)
  })

  it("handles zero-based position correctly", () => {
    const vscRange = {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 5 }
    } as any
    const result = rangeVscToApi(vscRange)
    expect(result.start.line).toBe(1)
    expect(result.start.column).toBe(0)
  })
})

describe("lineRange", () => {
  beforeEach(() => {
    ;(Position as jest.Mock).mockImplementation((line: number, char: number) => ({ line, character: char }))
    ;(Range as jest.Mock).mockImplementation((start: any, end: any) => ({ start, end }))
  })

  it("creates a range spanning column 0-1 for given line", () => {
    const result = lineRange(5)
    expect(result.start.line).toBe(4) // converted via vscPosition
    expect(result.start.character).toBe(0)
    expect(result.end.character).toBe(1)
  })
})

describe("createStore", () => {
  const makeMockMemento = (initial?: [string, any][]) => {
    let stored: [string, any][] = initial || []
    return {
      keys: jest.fn(() => stored.map(([k]) => k)),
      get: jest.fn((key: string) => stored.find(([k]) => k === key)?.[1]),
      update: jest.fn(async (key: string, value: any) => {
        stored = [...stored.filter(([k]) => k !== key), [key, value]]
      })
    }
  }

  it("creates a store that can set and get values", async () => {
    const memento = makeMockMemento()
    const store = createStore<string>("mystore", memento)
    await store.update("key1", "value1")
    expect(store.get("key1")).toBe("value1")
  })

  it("returns default value when key not found", () => {
    const memento = makeMockMemento()
    const store = createStore<string>("mystore", memento)
    expect(store.get("nonexistent", "default")).toBe("default")
  })

  it("does not update when value is unchanged", async () => {
    const memento = makeMockMemento()
    const store = createStore<string>("mystore", memento)
    await store.update("key1", "value1")
    jest.clearAllMocks()
    await store.update("key1", "value1") // same value
    expect(memento.update).not.toHaveBeenCalled()
  })

  it("returns keys from underlying storage", async () => {
    const memento = makeMockMemento()
    const store = createStore<string>("mystore", memento)
    await store.update("a", "1")
    await store.update("b", "2")
    expect(store.keys()).toContain("a")
    expect(store.keys()).toContain("b")
  })
})

describe("splitAdtUri", () => {
  beforeEach(() => {
    ;(Position as jest.Mock).mockImplementation((line: number, char: number) => ({ line, character: char }))
    mockSplitAdtUriInternal.mockReturnValue({
      path: "/sap/bc/adt/programs/ZTEST",
      type: "PROG",
      name: "ZTEST",
      fragparms: {},
      start: undefined,
      end: undefined
    } as any)
  })

  it("calls splitAdtUriInternal for string uri", () => {
    splitAdtUri("adt://sys/sap/bc/adt/programs/ZTEST")
    expect(mockSplitAdtUriInternal).toHaveBeenCalledWith("adt://sys/sap/bc/adt/programs/ZTEST")
  })

  it("returns path from parsed result", () => {
    const result = splitAdtUri("adt://sys/path")
    expect(result.path).toBe("/sap/bc/adt/programs/ZTEST")
  })

  it("handles UriParts object input", () => {
    ;(mockSplitAdtUriInternal as jest.Mock).mockClear()
    const uriParts = {
      uri: "/sap/bc/adt/programs/ZTEST",
      range: {
        start: { line: 5, column: 0 },
        end: { line: 5, column: 10 }
      },
      hashparms: { type: "PROG", name: "ZTEST" }
    } as any
    const result = splitAdtUri(uriParts)
    expect(result.path).toBe("/sap/bc/adt/programs/ZTEST")
    expect(result.type).toBe("PROG")
    expect(result.name).toBe("ZTEST")
  })

  it("handles UriParts with start=end (sets no end)", () => {
    const uriParts = {
      uri: "/path",
      range: {
        start: { line: 5, column: 0 },
        end: { line: 5, column: 0 }  // same as start
      },
      hashparms: {}
    } as any
    const result = splitAdtUri(uriParts)
    expect(result.end).toBeUndefined()
  })

  it("includes start when range has actual extent", () => {
    ;(Position as jest.Mock).mockImplementation((line: number, char: number) => ({ line, character: char }))
    const uriParts = {
      uri: "/path",
      range: {
        start: { line: 5, column: 3 },
        end: { line: 5, column: 10 }
      },
      hashparms: {}
    } as any
    const result = splitAdtUri(uriParts)
    expect(result.start).toBeDefined()
    expect(result.end).toBeDefined()
  })
})

describe("createAdtUri", () => {
  it("creates URI with adt scheme and authority", () => {
    ;(Uri.parse as jest.Mock).mockReturnValue({
      with: jest.fn().mockReturnValue({ toString: () => "adt://sys/path?q#f" })
    })
    const result = createAdtUri("sys", "/path", "q", "f")
    expect(Uri.parse).toHaveBeenCalledWith("adt://sys")
  })
})

describe("withp", () => {
  beforeEach(() => jest.clearAllMocks())

  it("calls window.withProgress with correct options", async () => {
    const cb = jest.fn().mockResolvedValue("result")
    ;(window.withProgress as jest.Mock).mockImplementation((_opts: any, fn: any) => fn())

    await withp("My Task", cb)

    expect(window.withProgress).toHaveBeenCalledWith(
      expect.objectContaining({ title: "My Task" }),
      cb
    )
  })

  it("returns the result of the callback", async () => {
    ;(window.withProgress as jest.Mock).mockImplementation((_opts: any, fn: any) => fn())
    const cb = jest.fn().mockResolvedValue(42)

    const result = await withp("Task", cb)
    expect(result).toBe(42)
  })
})
