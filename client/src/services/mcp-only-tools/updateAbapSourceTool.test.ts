jest.mock(
  "vscode",
  () => ({
    Uri: {
      parse: jest.fn((s: string) => {
        // Minimal stub: accept adt://authority/path[/...] ; reject anything that doesn't
        // look like a URI to mimic vscode.Uri.parse(strict) behavior.
        const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/]*)(\/.*)?$/.exec(s)
        if (!m) {
          throw new Error(`invalid uri: ${s}`)
        }
        const [, scheme, authority, path] = m
        return {
          scheme,
          authority,
          path: path || "",
          toString: () => s
        }
      })
    },
    workspace: {
      fs: {
        writeFile: jest.fn()
      },
      textDocuments: [] as any[]
    }
  }),
  { virtual: true }
)

jest.mock("abapfs", () => ({
  isAbapFile: jest.fn()
}))

jest.mock("../../adt/conections", () => ({
  getOrCreateRoot: jest.fn()
}))

jest.mock("../../adt/operations/AdtObjectActivator", () => ({
  AdtObjectActivator: {
    get: jest.fn()
  }
}))

jest.mock("../telemetry", () => ({ logTelemetry: jest.fn() }))

import * as vscode from "vscode"
import { isAbapFile } from "abapfs"
import { getOrCreateRoot } from "../../adt/conections"
import { AdtObjectActivator } from "../../adt/operations/AdtObjectActivator"
import { logTelemetry } from "../telemetry"
import { _internal, registerUpdateAbapSourceTool } from "./updateAbapSourceTool"
import {
  getMcpOnlyTools,
  _resetMcpOnlyRegistryForTests
} from "./mcpOnlyRegistry"

const URI = "adt://dev100/sap/bc/adt/programs/programs/zfoo/source/main"

function makeNode(name = "ZFOO") {
  return { object: { name } }
}

function makeRoot(node: any) {
  return { getNodeAsync: jest.fn().mockResolvedValue(node) }
}

function makeActivator(result: { ok: boolean; summary?: string; details?: string }) {
  return { activate: jest.fn().mockResolvedValue(result) }
}

describe("update_abap_source MCP-only tool", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(vscode.workspace.textDocuments as any) = []
    ;(isAbapFile as unknown as jest.Mock).mockReturnValue(true)
  })

  // ---------------------------------------------------------------------------
  // Validation / error paths
  // ---------------------------------------------------------------------------

  it("throws when workspaceUri is missing", async () => {
    await expect(_internal.invoke({ source: "" } as any)).rejects.toThrow(
      /workspaceUri is required/
    )
  })

  it("throws when source is missing", async () => {
    await expect(_internal.invoke({ workspaceUri: URI } as any)).rejects.toThrow(
      /source is required/
    )
  })

  it("throws when scheme is not adt://", async () => {
    await expect(
      _internal.invoke({ workspaceUri: "file:///tmp/foo", source: "" })
    ).rejects.toThrow(/must use the adt:\/\/ scheme/)
  })

  it("throws when the node is not an AbapFile", async () => {
    ;(getOrCreateRoot as jest.Mock).mockResolvedValue(makeRoot(makeNode()))
    ;(isAbapFile as unknown as jest.Mock).mockReturnValue(false)

    await expect(_internal.invoke({ workspaceUri: URI, source: "" })).rejects.toThrow(
      /Not a writable ABAP source/
    )
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled()
  })

  it("throws when an editor for the same URI has unsaved changes", async () => {
    ;(getOrCreateRoot as jest.Mock).mockResolvedValue(makeRoot(makeNode()))
    ;(vscode.workspace.textDocuments as any) = [
      { uri: { toString: () => URI }, isDirty: true }
    ]

    await expect(_internal.invoke({ workspaceUri: URI, source: "" })).rejects.toThrow(
      /unsaved changes/
    )
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // Success / activation-failure paths
  // ---------------------------------------------------------------------------

  it("writes through workspace.fs.writeFile and reports success when activate ok", async () => {
    ;(getOrCreateRoot as jest.Mock).mockResolvedValue(makeRoot(makeNode("ZFOO")))
    const activator = makeActivator({ ok: true })
    ;(AdtObjectActivator.get as jest.Mock).mockReturnValue(activator)

    const text = await _internal.invoke({ workspaceUri: URI, source: "REPORT zfoo." })

    expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1)
    const [calledUri, calledBytes] = (vscode.workspace.fs.writeFile as jest.Mock).mock.calls[0]
    expect(calledUri.toString()).toBe(URI)
    expect(Buffer.isBuffer(calledBytes) || calledBytes instanceof Uint8Array).toBe(true)
    expect(activator.activate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ZFOO" }),
      expect.objectContaining({ scheme: "adt" }),
      false
    )
    expect(text).toMatch(/Updated and activated/)
    expect(text).toMatch(/ZFOO/)
  })

  it("returns structured failure (with summary/details) when activation fails — source still saved", async () => {
    ;(getOrCreateRoot as jest.Mock).mockResolvedValue(makeRoot(makeNode("ZFOO")))
    const activator = makeActivator({
      ok: false,
      summary: "Activation failed: 1 error",
      details: "ZFOO line 3: Expected '.', got 'BAR'"
    })
    ;(AdtObjectActivator.get as jest.Mock).mockReturnValue(activator)

    const text = await _internal.invoke({
      workspaceUri: URI,
      source: "REPORT zfoo BAR"
    })

    expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1)
    expect(activator.activate).toHaveBeenCalledTimes(1)
    expect(text).toMatch(/Source written but activation failed/)
    expect(text).toMatch(/Activation failed: 1 error/)
    expect(text).toMatch(/Expected '\.', got 'BAR'/)
    expect(text).toMatch(/call `update_abap_source` again/)
  })

  it("logs telemetry with the connectionId taken from the URI authority", async () => {
    ;(getOrCreateRoot as jest.Mock).mockResolvedValue(makeRoot(makeNode()))
    ;(AdtObjectActivator.get as jest.Mock).mockReturnValue(makeActivator({ ok: true }))

    await _internal.invoke({ workspaceUri: URI, source: "" })

    expect(logTelemetry).toHaveBeenCalledWith("tool_update_abap_source_called", {
      connectionId: "dev100"
    })
  })

  // ---------------------------------------------------------------------------
  // Registry wiring
  // ---------------------------------------------------------------------------

  describe("registry wiring", () => {
    beforeEach(() => _resetMcpOnlyRegistryForTests())

    it("registerUpdateAbapSourceTool() adds update_abap_source to the MCP-only registry", () => {
      registerUpdateAbapSourceTool()
      const names = getMcpOnlyTools().map(t => t.name)
      expect(names).toContain("update_abap_source")
    })

    it("registered schema declares both required fields", () => {
      registerUpdateAbapSourceTool()
      const tool = getMcpOnlyTools().find(t => t.name === "update_abap_source")!
      const schema = tool.inputSchema as any
      expect(schema.required).toEqual(expect.arrayContaining(["workspaceUri", "source"]))
      expect(schema.properties.workspaceUri.type).toBe("string")
      expect(schema.properties.source.type).toBe("string")
    })
  })
})
