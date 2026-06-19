jest.mock("vscode", () => ({
  lm: {
    registerTool: jest.fn(() => ({ dispose: jest.fn() }))
  }
}), { virtual: true })

import { toolRegistry, registerToolWithRegistry } from "./toolRegistry"

beforeEach(() => {
  toolRegistry.clear()
})

describe("toolRegistry", () => {
  test("is initially empty", () => {
    expect(toolRegistry.size).toBe(0)
  })

  test("stores tools by name", () => {
    const fakeTool = { invoke: jest.fn() } as any
    toolRegistry.set("test-tool", fakeTool)
    expect(toolRegistry.get("test-tool")).toBe(fakeTool)
  })
})

describe("registerToolWithRegistry", () => {
  test("adds tool to registry and registers with vscode.lm", () => {
    const vscode = require("vscode")
    const fakeTool = { invoke: jest.fn() } as any
    const disposable = registerToolWithRegistry("my-tool", fakeTool)

    expect(toolRegistry.get("my-tool")).toBe(fakeTool)
    expect(vscode.lm.registerTool).toHaveBeenCalledWith("my-tool", fakeTool)
    expect(disposable).toBeDefined()
    expect(disposable.dispose).toBeDefined()
  })

  test("overwrites existing tool with same name", () => {
    const tool1 = { invoke: jest.fn(), id: 1 } as any
    const tool2 = { invoke: jest.fn(), id: 2 } as any

    registerToolWithRegistry("dup", tool1)
    registerToolWithRegistry("dup", tool2)

    expect(toolRegistry.get("dup")).toBe(tool2)
  })
})
