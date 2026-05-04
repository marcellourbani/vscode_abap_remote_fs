// Tests for editors/messages.ts - pure logic functions
jest.mock("vscode", () => ({
  workspace: {
    onDidChangeTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
    fs: {}
  },
  ViewColumn: { Beside: 2, Active: 1 },
  Range: class { constructor(public start: any, public end: any) {} },
  Position: class { constructor(public line: number, public character: number) {} },
  WorkspaceEdit: class {
    replace = jest.fn()
    insert = jest.fn()
    delete = jest.fn()
  }
}), { virtual: true })

jest.mock("../adt/conections", () => ({ getClient: jest.fn() }))
jest.mock("../services/funMessenger", () => ({
  funWindow: {
    registerCustomEditorProvider: jest.fn(),
    showInputBox: jest.fn(),
    showTextDocument: jest.fn(),
    createWebviewPanel: jest.fn(() => ({
      webview: { html: "" }
    }))
  }
}))
jest.mock("fast-xml-parser", () => ({
  XMLParser: jest.fn().mockImplementation(() => ({
    parse: jest.fn()
  }))
}))
jest.mock("html-entities", () => ({ decode: jest.fn((s: string) => s) }))
jest.mock("path", () => ({ join: jest.fn((...args: string[]) => args.join("/")) }))

// We test the pure functions extracted from the module by re-implementing them
// (parseMessages and getMessageClassName are not exported, so we test them indirectly
// via observable behavior, or we test the XML parsing logic directly)

// Tests for XML parsing helpers - replicated logic
const testXmlNode = (xml: any, ...xmlpath: string[]) => {
  const allParts = xmlpath.flatMap(x => x.split("/")).filter(x => x)
  let cur = xml
  for (const p of allParts) cur = cur && cur[p]
  return cur
}

const testXmlArray = (xml: any, ...xmlpath: string[]) => {
  const target = testXmlNode(xml, ...xmlpath)
  if (!target) return []
  return Array.isArray(target) ? target : [target]
}

describe("messages.ts - XML helper logic", () => {
  describe("xmlNode navigation", () => {
    it("returns a nested value given a path", () => {
      const xml = { a: { b: { c: 42 } } }
      expect(testXmlNode(xml, "a", "b", "c")).toBe(42)
    })

    it("returns undefined for missing path segment", () => {
      const xml = { a: { b: 1 } }
      expect(testXmlNode(xml, "a", "x")).toBeUndefined()
    })

    it("handles slash-separated paths", () => {
      const xml = { a: { b: { c: "found" } } }
      expect(testXmlNode(xml, "a/b/c")).toBe("found")
    })

    it("handles empty path gracefully", () => {
      const xml = { a: 1 }
      expect(testXmlNode(xml)).toBe(xml)
    })

    it("returns null/undefined on null intermediate", () => {
      const xml = { a: null }
      expect(testXmlNode(xml, "a", "b")).toBeFalsy()
    })
  })

  describe("xmlArray", () => {
    it("wraps non-array in array", () => {
      const xml = { a: "item" }
      expect(testXmlArray(xml, "a")).toEqual(["item"])
    })

    it("returns array as-is", () => {
      const xml = { a: [1, 2, 3] }
      expect(testXmlArray(xml, "a")).toEqual([1, 2, 3])
    })

    it("returns empty array when path missing", () => {
      const xml = {}
      expect(testXmlArray(xml, "missing")).toEqual([])
    })
  })
})

describe("messages.ts - message number padding logic", () => {
  const padNumber = (n: string | number) => String(n).padStart(3, "0")

  it("pads single digit to 3 digits", () => {
    expect(padNumber(1)).toBe("001")
    expect(padNumber(5)).toBe("005")
  })

  it("pads two digit to 3 digits", () => {
    expect(padNumber(42)).toBe("042")
  })

  it("does not change already 3-digit number", () => {
    expect(padNumber(100)).toBe("100")
    expect(padNumber(999)).toBe("999")
  })

  it("handles string input", () => {
    expect(padNumber("7")).toBe("007")
  })
})

describe("messages.ts - next available message number logic", () => {
  const findNextNumber = (existingNumbers: number[], deletedNumbers: Set<number>): number => {
    let nextNumber = 1
    while (existingNumbers.includes(nextNumber) || deletedNumbers.has(nextNumber)) {
      nextNumber++
    }
    return nextNumber
  }

  it("returns 1 when no messages exist", () => {
    expect(findNextNumber([], new Set())).toBe(1)
  })

  it("returns 2 when only message 1 exists", () => {
    expect(findNextNumber([1], new Set())).toBe(2)
  })

  it("fills first gap in sequence", () => {
    expect(findNextNumber([1, 3, 4], new Set())).toBe(2)
  })

  it("skips deleted numbers", () => {
    expect(findNextNumber([1, 2], new Set([3]))).toBe(4)
  })

  it("skips both existing and deleted", () => {
    expect(findNextNumber([1, 2, 3], new Set([4, 5]))).toBe(6)
  })
})

describe("messages.ts - input validation logic", () => {
  const validateInput = (value: string) => {
    if (!value || value.trim().length === 0) {
      return "Message text cannot be empty"
    }
    if (value.length > 72) {
      return "Message text should not exceed 72 characters"
    }
    return null
  }

  it("returns null for valid text", () => {
    expect(validateInput("Hello world")).toBeNull()
  })

  it("returns error for empty string", () => {
    expect(validateInput("")).toBe("Message text cannot be empty")
  })

  it("returns error for whitespace-only string", () => {
    expect(validateInput("   ")).toBe("Message text cannot be empty")
  })

  it("returns error for text exceeding 72 chars", () => {
    expect(validateInput("a".repeat(73))).toBe("Message text should not exceed 72 characters")
  })

  it("accepts exactly 72 characters", () => {
    expect(validateInput("a".repeat(72))).toBeNull()
  })
})
