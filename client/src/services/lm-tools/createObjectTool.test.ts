vi.mock("vscode", () => ({
  LanguageModelToolResult: vi.fn().mockImplementation(function (parts: any[]) {
    return { parts }
  }),
  LanguageModelTextPart: vi.fn().mockImplementation(function (text: string) {
    return { text }
  }),
  MarkdownString: vi.fn().mockImplementation(function (text: string) {
    return { text }
  }),
  commands: { executeCommand: vi.fn() },
  lm: {
    registerTool: vi.fn(function () {
      return { dispose: vi.fn() }
    })
  }
}))

vi.mock("../../adt/conections", () => ({}))
vi.mock("../telemetry", () => ({ logTelemetry: vi.fn() }))
vi.mock("./toolRegistry", () => ({
  registerToolWithRegistry: vi.fn(function () {
    return { dispose: vi.fn() }
  })
}))

vi.mock("./toolGuard", () => ({
  assertToolInvocationAuthorized: vi.fn(),
  isToolInvocationAuthorized: vi.fn(function () {
    return true
  })
}))
import { CreateABAPObjectTool } from "./createObjectTool"
import * as vscode from "vscode"
import { logTelemetry } from "../telemetry"
import type { Mock } from "vitest"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

describe("CreateABAPObjectTool", () => {
  let tool: CreateABAPObjectTool

  beforeEach(() => {
    tool = new CreateABAPObjectTool()
    vi.clearAllMocks()
  })

  describe("prepareInvocation", () => {
    it("returns invocation message with type and name", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({
          objectType: "PROG/P",
          name: "ZPROG",
          description: "Test program",
          connectionId: "dev100"
        }),
        mockToken
      )
      expect(result.invocationMessage).toContain("PROG/P")
      expect(result.invocationMessage).toContain("ZPROG")
    })

    it("includes object details in confirmation message", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({
          objectType: "CLAS/OC",
          name: "ZCL_TEST",
          description: "Test class",
          packageName: "ZTEST",
          connectionId: "dev100"
        }),
        mockToken
      )
      const msgText = (result.confirmationMessages as any).message.text
      expect(msgText).toContain("ZCL_TEST")
      expect(msgText).toContain("CLAS/OC")
      expect(msgText).toContain("Test class")
      expect(msgText).toContain("ZTEST")
    })

    it("defaults packageName to $TMP", async () => {
      const result = await tool.prepareInvocation(
        makeOptions({
          objectType: "PROG/P",
          name: "ZPROG",
          description: "Test"
        }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.text).toContain("$TMP")
    })
  })

  describe("invoke", () => {
    it("logs telemetry with connectionId", async () => {
      ;(vscode.commands.executeCommand as Mock).mockResolvedValue({ success: true })
      await tool.invoke(
        makeOptions({
          objectType: "PROG/P",
          name: "ZPROG",
          description: "Test",
          connectionId: "dev100"
        }),
        mockToken
      )
      expect(logTelemetry).toHaveBeenCalledWith("tool_create_abap_object_called", {
        connectionId: "dev100"
      })
    })

    it("normalizes connectionId to lowercase", async () => {
      ;(vscode.commands.executeCommand as Mock).mockResolvedValue({ success: true })
      await tool.invoke(
        makeOptions({
          objectType: "PROG/P",
          name: "ZPROG",
          description: "Test",
          connectionId: "DEV100"
        }),
        mockToken
      )
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "abapfs.createObjectProgrammatically",
        "PROG/P",
        "ZPROG",
        "Test",
        "$TMP",
        undefined,
        "dev100",
        undefined
      )
    })

    it("calls createObjectProgrammatically command with correct args", async () => {
      ;(vscode.commands.executeCommand as Mock).mockResolvedValue({ success: true })
      await tool.invoke(
        makeOptions({
          objectType: "CLAS/OC",
          name: "ZCL_TEST",
          description: "My class",
          packageName: "ZPKG",
          connectionId: "dev100"
        }),
        mockToken
      )
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "abapfs.createObjectProgrammatically",
        "CLAS/OC",
        "ZCL_TEST",
        "My class",
        "ZPKG",
        undefined,
        "dev100",
        undefined
      )
    })

    it("returns success result when command returns {success:true}", async () => {
      ;(vscode.commands.executeCommand as Mock).mockResolvedValue({
        success: true,
        objectUri: "adt://dev100/path"
      })
      const result: any = await tool.invoke(
        makeOptions({
          objectType: "PROG/P",
          name: "ZPROG",
          description: "Test",
          connectionId: "dev100"
        }),
        mockToken
      )
      expect(result.parts[0].text).toContain("ZPROG")
    })

    it("returns error result when command returns {success:false}", async () => {
      ;(vscode.commands.executeCommand as Mock).mockResolvedValue({
        success: false,
        error: "Already exists"
      })
      const result: any = await tool.invoke(
        makeOptions({
          objectType: "PROG/P",
          name: "ZPROG",
          description: "Test",
          connectionId: "dev100"
        }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Already exists")
    })

    it("passes additionalOptions to command", async () => {
      ;(vscode.commands.executeCommand as Mock).mockResolvedValue({ success: true })
      const additionalOptions = {
        transportRequest: { type: "new" as const, description: "Test TR" }
      }
      await tool.invoke(
        makeOptions({
          objectType: "PROG/P",
          name: "ZPROG",
          description: "Test",
          connectionId: "dev100",
          additionalOptions
        }),
        mockToken
      )
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "abapfs.createObjectProgrammatically",
        "PROG/P",
        "ZPROG",
        "Test",
        "$TMP",
        undefined,
        "dev100",
        additionalOptions
      )
    })
  })
})
