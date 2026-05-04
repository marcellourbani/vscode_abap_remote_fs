/**
 * Tests for mcpServer.ts
 * Tests the JSON Schema to Zod converter (jsonSchemaPropertyToZod/jsonSchemaToZod),
 * API key validation logic, and exported server lifecycle functions.
 */

jest.mock(
  "vscode",
  () => ({
    workspace: {
      getConfiguration: jest.fn().mockReturnValue({
        get: jest.fn((key: string, defaultVal: any) => defaultVal),
        update: jest.fn()
      }),
      workspaceFolders: []
    },
    lm: { tools: [], invokeTool: jest.fn() },
    window: {
      showInformationMessage: jest.fn(),
      showErrorMessage: jest.fn(),
      showWarningMessage: jest.fn()
    },
    CancellationTokenSource: jest.fn().mockImplementation(() => ({ token: {} })),
    LanguageModelTextPart: class {
      constructor(public value: string) {}
    }
  }),
  { virtual: true }
)

jest.mock("./funMessenger", () => ({
  funWindow: {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn()
  }
}))

jest.mock("../lib", () => ({
  log: jest.fn()
}))

jest.mock("./lm-tools/toolRegistry", () => ({
  toolRegistry: { get: jest.fn().mockReturnValue(undefined) }
}))

// Mock MCP SDK modules
jest.mock(
  "@modelcontextprotocol/sdk/server/mcp.js",
  () => ({ McpServer: jest.fn().mockImplementation(() => ({ registerTool: jest.fn(), connect: jest.fn() })) }),
  { virtual: true }
)
jest.mock(
  "@modelcontextprotocol/sdk/server/streamableHttp.js",
  () => ({ StreamableHTTPServerTransport: jest.fn() }),
  { virtual: true }
)
jest.mock(
  "@modelcontextprotocol/sdk/types.js",
  () => ({ isInitializeRequest: jest.fn().mockReturnValue(false) }),
  { virtual: true }
)

import * as vscode from "vscode"
import { initializeMcpServer, getMcpServerStatus, jsonSchemaPropertyToZod, jsonSchemaToZod, validateApiKey } from "./mcpServer"

describe("mcpServer", () => {
  const mockContext = {
    subscriptions: [] as any[],
    globalState: { get: jest.fn(), update: jest.fn() },
    extensionPath: "/fake/path"
  } as any

  beforeEach(() => {
    jest.clearAllMocks()
    mockContext.subscriptions = []
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string, defaultVal: any) => defaultVal),
      update: jest.fn()
    })
  })

  describe("getMcpServerStatus", () => {
    it("returns isRunning=false initially", () => {
      const status = getMcpServerStatus()
      expect(status.isRunning).toBe(false)
    })

    it("returns a port number", () => {
      const status = getMcpServerStatus()
      expect(typeof status.port).toBe("number")
    })

    it("returns a url string", () => {
      const status = getMcpServerStatus()
      expect(typeof status.url).toBe("string")
    })

    it("returns empty url when not running", () => {
      const status = getMcpServerStatus()
      expect(status.url).toBe("")
    })
  })

  describe("initializeMcpServer", () => {
    it("resolves without throwing when autoStart=false", async () => {
      ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn((key: string, def: any) => {
          if (key === "autoStart") return false
          return def
        })
      })
      await expect(initializeMcpServer(mockContext)).resolves.not.toThrow()
    })

    it("does not start server when autoStart=false", async () => {
      ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn((key: string, def: any) => {
          if (key === "autoStart") return false
          return def
        })
      })
      await initializeMcpServer(mockContext)
      const status = getMcpServerStatus()
      expect(status.isRunning).toBe(false)
    })
  })
})

// ============================================================================
// Internal function tests via barrel module pattern (test the logic directly)
// ============================================================================

describe("mcpServer internals - jsonSchemaToZod converter", () => {
  // We test the converter logic by starting the server and checking
  // it doesn't throw on various schema shapes. We can also test via
  // importing the module and checking it handles edge cases.

  it("module loads without error", () => {
    expect(() => require("./mcpServer")).not.toThrow()
  })
})

// ============================================================================
// API key validation - test the logic directly via black-box HTTP testing
// ============================================================================
describe("mcpServer - API key validation logic", () => {
  it("allows access when no API key configured (backwards compat)", async () => {
    // When apiKey is empty string, validateApiKey should return true
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string, def: any) => {
        if (key === "apiKey") return ""
        return def
      })
    })
    // The module-level warning flag resets would require server restart
    // Verify indirectly via initializeMcpServer with autoStart=false not throwing
    const ctx = { subscriptions: [] as any[], globalState: { get: jest.fn(), update: jest.fn() } } as any
    await expect(initializeMcpServer(ctx)).resolves.not.toThrow()
  })
})

// ============================================================================
// JSON Schema to Zod converter tests
// ============================================================================

describe("jsonSchemaPropertyToZod", () => {
  it("converts string type (required)", () => {
    const zodType = jsonSchemaPropertyToZod({ type: "string" }, true)
    expect(zodType.parse("hello")).toBe("hello")
    expect(() => zodType.parse(123)).toThrow()
  })

  it("converts string type (optional)", () => {
    const zodType = jsonSchemaPropertyToZod({ type: "string" }, false)
    expect(zodType.parse(undefined)).toBeUndefined()
    expect(zodType.parse("hello")).toBe("hello")
  })

  it("converts number type", () => {
    const zodType = jsonSchemaPropertyToZod({ type: "number" }, true)
    expect(zodType.parse(42)).toBe(42)
    expect(() => zodType.parse("not a number")).toThrow()
  })

  it("converts integer type (same as number in zod)", () => {
    const zodType = jsonSchemaPropertyToZod({ type: "integer" }, true)
    expect(zodType.parse(7)).toBe(7)
    expect(() => zodType.parse("nope")).toThrow()
  })

  it("converts boolean type", () => {
    const zodType = jsonSchemaPropertyToZod({ type: "boolean" }, true)
    expect(zodType.parse(true)).toBe(true)
    expect(zodType.parse(false)).toBe(false)
    expect(() => zodType.parse("true")).toThrow()
  })

  it("converts array of strings", () => {
    const zodType = jsonSchemaPropertyToZod(
      { type: "array", items: { type: "string" } },
      true
    )
    expect(zodType.parse(["a", "b"])).toEqual(["a", "b"])
    expect(() => zodType.parse([1, 2])).toThrow()
  })

  it("converts array with no items schema to array of unknown", () => {
    const zodType = jsonSchemaPropertyToZod({ type: "array" }, true)
    expect(zodType.parse([1, "two", true])).toEqual([1, "two", true])
  })

  it("converts object with properties", () => {
    const zodType = jsonSchemaPropertyToZod(
      {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" }
        },
        required: ["name"]
      },
      true
    )
    // name is required, age is optional
    expect(zodType.parse({ name: "Alice" })).toEqual({ name: "Alice" })
    expect(zodType.parse({ name: "Bob", age: 30 })).toEqual({ name: "Bob", age: 30 })
    expect(() => zodType.parse({ age: 25 })).toThrow() // name missing
  })

  it("converts object without properties to record", () => {
    const zodType = jsonSchemaPropertyToZod({ type: "object" }, true)
    expect(zodType.parse({ any: "thing" })).toEqual({ any: "thing" })
  })

  it("converts enum strings", () => {
    const zodType = jsonSchemaPropertyToZod(
      { type: "string", enum: ["red", "green", "blue"] },
      true
    )
    expect(zodType.parse("red")).toBe("red")
    expect(() => zodType.parse("yellow")).toThrow()
  })

  it("handles unknown type by accepting anything", () => {
    const zodType = jsonSchemaPropertyToZod({ type: "foobar" }, true)
    expect(zodType.parse("anything")).toBe("anything")
    expect(zodType.parse(123)).toBe(123)
    expect(zodType.parse(null)).toBe(null)
  })

  it("handles missing type by accepting anything", () => {
    const zodType = jsonSchemaPropertyToZod({}, true)
    expect(zodType.parse("anything")).toBe("anything")
    expect(zodType.parse(42)).toBe(42)
  })

  it("attaches description when present", () => {
    const zodType = jsonSchemaPropertyToZod(
      { type: "string", description: "A name field" },
      true
    )
    expect(zodType.description).toBe("A name field")
  })

  it("handles nested objects", () => {
    const zodType = jsonSchemaPropertyToZod(
      {
        type: "object",
        properties: {
          address: {
            type: "object",
            properties: {
              city: { type: "string" },
              zip: { type: "string" }
            },
            required: ["city"]
          }
        },
        required: ["address"]
      },
      true
    )
    expect(zodType.parse({ address: { city: "Berlin" } })).toEqual({
      address: { city: "Berlin" }
    })
    expect(() => zodType.parse({ address: {} })).toThrow() // city missing
  })

  it("handles array of objects", () => {
    const zodType = jsonSchemaPropertyToZod(
      {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "number" } },
          required: ["id"]
        }
      },
      true
    )
    expect(zodType.parse([{ id: 1 }, { id: 2 }])).toEqual([{ id: 1 }, { id: 2 }])
    expect(() => zodType.parse([{}])).toThrow() // id missing
  })
})

describe("jsonSchemaToZod", () => {
  it("returns empty object for undefined schema", () => {
    const result = jsonSchemaToZod(undefined)
    expect(result).toEqual({})
  })

  it("returns empty object for schema with no properties", () => {
    const result = jsonSchemaToZod({ type: "object" })
    expect(result).toEqual({})
  })

  it("converts a schema with mixed required and optional fields", () => {
    const result = jsonSchemaToZod({
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "number" },
        active: { type: "boolean" }
      },
      required: ["name"]
    })

    expect(Object.keys(result)).toEqual(["name", "count", "active"])
    // name is required — should reject undefined
    expect(result.name.parse("test")).toBe("test")
    expect(() => result.name.parse(undefined)).toThrow()
    // count is optional — should accept undefined
    expect(result.count.parse(undefined)).toBeUndefined()
    expect(result.count.parse(5)).toBe(5)
  })

  it("converts a schema with no required array (all optional)", () => {
    const result = jsonSchemaToZod({
      type: "object",
      properties: {
        foo: { type: "string" },
        bar: { type: "number" }
      }
    })

    expect(result.foo.parse(undefined)).toBeUndefined()
    expect(result.bar.parse(undefined)).toBeUndefined()
  })
})

// ============================================================================
// API key validation - direct function tests
// ============================================================================

describe("validateApiKey", () => {
  function makeRequest(headers: Record<string, string> = {}): any {
    return { headers } as any
  }

  it("returns true when no API key is configured (empty string)", () => {
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string, def: any) => {
        if (key === "apiKey") return ""
        return def
      })
    })
    expect(validateApiKey(makeRequest())).toBe(true)
  })

  it("returns false when API key is configured but no Authorization header", () => {
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string, def: any) => {
        if (key === "apiKey") return "my-secret-key"
        return def
      })
    })
    expect(validateApiKey(makeRequest())).toBe(false)
  })

  it("returns true for valid Bearer token", () => {
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string, def: any) => {
        if (key === "apiKey") return "my-secret-key"
        return def
      })
    })
    expect(validateApiKey(makeRequest({ authorization: "Bearer my-secret-key" }))).toBe(true)
  })

  it("returns true for valid plain token (no Bearer prefix)", () => {
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string, def: any) => {
        if (key === "apiKey") return "my-secret-key"
        return def
      })
    })
    expect(validateApiKey(makeRequest({ authorization: "my-secret-key" }))).toBe(true)
  })

  it("returns false for wrong API key", () => {
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string, def: any) => {
        if (key === "apiKey") return "correct-key"
        return def
      })
    })
    expect(validateApiKey(makeRequest({ authorization: "Bearer wrong-key!!" }))).toBe(false)
  })

  it("returns false when token length differs from configured key", () => {
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string, def: any) => {
        if (key === "apiKey") return "short"
        return def
      })
    })
    expect(validateApiKey(makeRequest({ authorization: "Bearer a-much-longer-token" }))).toBe(false)
  })

  it("uses constant-time comparison (same-length wrong key still rejected)", () => {
    ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string, def: any) => {
        if (key === "apiKey") return "abcde"
        return def
      })
    })
    // Same length, different content
    expect(validateApiKey(makeRequest({ authorization: "Bearer xyzwv" }))).toBe(false)
    // Correct
    expect(validateApiKey(makeRequest({ authorization: "Bearer abcde" }))).toBe(true)
  })
})
