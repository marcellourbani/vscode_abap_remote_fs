jest.mock("vscode", () => ({
  LanguageModelToolResult: jest.fn().mockImplementation((parts: any[]) => ({ parts })),
  LanguageModelTextPart: jest.fn().mockImplementation((text: string) => ({ text })),
  MarkdownString: jest.fn().mockImplementation((value: string) => ({ value })),
  CancellationTokenSource: jest.fn().mockImplementation(() => ({
    token: { isCancellationRequested: false, onCancellationRequested: jest.fn() }
  })),
  Position: jest.fn().mockImplementation((line: number, character: number) => ({ line, character })),
  Location: jest.fn().mockImplementation((uri: any, range: any) => ({ uri, range })),
  SourceBreakpoint: jest.fn().mockImplementation((location: any, enabled?: boolean, condition?: string) => ({ location, enabled, condition })),
  lm: { registerTool: jest.fn(() => ({ dispose: jest.fn() })) },
  window: { activeTextEditor: undefined },
  workspace: {
    workspaceFolders: [],
    getConfiguration: jest.fn(() => ({ get: jest.fn() })),
    openTextDocument: jest.fn().mockResolvedValue({ uri: { toString: () => "test" } }),
    textDocuments: []
  },
  Uri: { parse: (s: string) => ({ authority: s.split("/")[2] || "", path: s, scheme: "adt", toString: () => s }) },
  debug: {
    activeDebugSession: undefined,
    startDebugging: jest.fn(),
    stopDebugging: jest.fn(),
    breakpoints: [],
    addBreakpoints: jest.fn(),
    removeBreakpoints: jest.fn()
  },
  env: { openExternal: jest.fn() }
}), { virtual: true })

jest.mock("../../adt/debugger/abapDebugSession", () => ({
  AbapDebugSession: {
    byConnection: jest.fn(),
    activeSessions: 0
  }
}))
jest.mock("../../lib", () => ({
  caughtToString: (e: any) => e instanceof Error ? e.message : String(e),
  log: jest.fn(),
  viewableObjecttypes: new Set()
}))
jest.mock("../../adt/conections", () => ({
  getClient: jest.fn(),
  abapUri: jest.fn()
}))
jest.mock("../telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("../funMessenger", () => ({
  funWindow: {
    activeTextEditor: undefined,
    showQuickPick: jest.fn(),
    showInformationMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    createOutputChannel: jest.fn(() => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), trace: jest.fn() }))
  }
}))
jest.mock("./toolRegistry", () => ({ registerToolWithRegistry: jest.fn(() => ({ dispose: jest.fn() })) }))
jest.mock("../abapCopilotLogger", () => ({ logCommands: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }))
jest.mock("../sapSystemInfo", () => ({ getSAPSystemInfo: jest.fn() }))

import {
  ABAPDebugSessionTool,
  ABAPBreakpointTool,
  ABAPDebugStepTool,
  ABAPDebugVariableTool,
  ABAPDebugStackTool,
  ABAPDebugStatusTool
} from "./abapDebuggerTool"
import { AbapDebugSession } from "../../adt/debugger/abapDebugSession"
import { getSAPSystemInfo } from "../sapSystemInfo"
import { funWindow as window } from "../funMessenger"
import * as vscode from "vscode"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

// ====================================
// ABAPDebugSessionTool
// ====================================
describe("ABAPDebugSessionTool", () => {
  let tool: ABAPDebugSessionTool

  beforeEach(() => {
    tool = new ABAPDebugSessionTool()
    jest.clearAllMocks()
    ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue(undefined)
    Object.defineProperty(AbapDebugSession, "activeSessions", { value: 0, writable: true })
  })

  describe("prepareInvocation", () => {
    it("returns invocation message with connectionId", async () => {
      const result: any = await tool.prepareInvocation(
        makeOptions({ connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("dev100")
    })

    it("includes debugUser in confirmation when provided", async () => {
      const result: any = await tool.prepareInvocation(
        makeOptions({ connectionId: "dev100", debugUser: "TESTUSER" }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.value).toContain("TESTUSER")
    })

    it("includes terminal mode in confirmation", async () => {
      const result: any = await tool.prepareInvocation(
        makeOptions({ connectionId: "dev100", terminalMode: true }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.value).toContain("Yes")
    })

    it("shows No for terminal mode when false", async () => {
      const result: any = await tool.prepareInvocation(
        makeOptions({ connectionId: "dev100", terminalMode: false }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.value).toContain("No")
    })
  })

  describe("invoke - status action", () => {
    it("returns no active session when none exists", async () => {
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue(undefined)
      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100", action: "status" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("No active session")
    })

    it("returns active status when session exists", async () => {
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({ debugListener: {} })
      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100", action: "status" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Active")
    })

    it("includes total sessions count in status", async () => {
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({ debugListener: {} })
      Object.defineProperty(AbapDebugSession, "activeSessions", { value: 3, writable: true })
      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100", action: "status" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("3")
    })
  })

  describe("invoke - stop action", () => {
    it("stops existing session successfully", async () => {
      const mockLogOut = jest.fn().mockResolvedValue(undefined)
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({ logOut: mockLogOut })
      ;(vscode.debug as any).activeDebugSession = undefined

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100", action: "stop" }),
        mockToken
      )
      expect(mockLogOut).toHaveBeenCalled()
      expect(result.parts[0].text).toContain("stopped")
    })

    it("stops VS Code debug session if active and type is abap", async () => {
      const mockLogOut = jest.fn().mockResolvedValue(undefined)
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({ logOut: mockLogOut })
      const mockAbapSession = { type: "abap" }
      ;(vscode.debug as any).activeDebugSession = mockAbapSession

      await tool.invoke(makeOptions({ connectionId: "dev100", action: "stop" }), mockToken)
      expect(vscode.debug.stopDebugging).toHaveBeenCalledWith(mockAbapSession)
    })

    it("returns warning when no session to stop", async () => {
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue(undefined)
      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100", action: "stop" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("No active debug session")
    })
  })

  describe("invoke - start action", () => {
    it("returns already-active message when session exists", async () => {
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({ debugListener: {} })
      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100", action: "start" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("already active")
    })

    it("calls debug.startDebugging with correct config", async () => {
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue(undefined)
      ;(getSAPSystemInfo as jest.Mock).mockResolvedValue({ currentClient: { category: "Development" } })
      ;(vscode.debug.startDebugging as jest.Mock).mockResolvedValue(true)

      await tool.invoke(
        makeOptions({ connectionId: "dev100", action: "start", debugUser: "USER1", terminalMode: true }),
        mockToken
      )

      expect(vscode.debug.startDebugging).toHaveBeenCalledWith(undefined, expect.objectContaining({
        type: "abap",
        request: "attach",
        connId: "dev100",
        debugUser: "USER1",
        terminalMode: true
      }))
    })

    it("returns error when startDebugging fails", async () => {
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue(undefined)
      ;(getSAPSystemInfo as jest.Mock).mockResolvedValue({ currentClient: { category: "Development" } })
      ;(vscode.debug.startDebugging as jest.Mock).mockResolvedValue(false)

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100", action: "start" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Failed")
    })

    it("defaults action to start when not specified", async () => {
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue(undefined)
      ;(getSAPSystemInfo as jest.Mock).mockResolvedValue({ currentClient: { category: "Development" } })
      ;(vscode.debug.startDebugging as jest.Mock).mockResolvedValue(true)

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100" }),
        mockToken
      )
      expect(vscode.debug.startDebugging).toHaveBeenCalled()
      expect(result.parts[0].text).toContain("started")
    })
  })

  describe("production guard", () => {
    it("cancels when system is production and user declines", async () => {
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue(undefined)
      ;(getSAPSystemInfo as jest.Mock).mockResolvedValue({
        currentClient: { category: "Production", clientNumber: "100", clientName: "PROD" }
      })
      ;(window.showWarningMessage as jest.Mock).mockResolvedValue(undefined) // user dismisses

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "prod100", action: "start" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("cancelled")
    })

    it("proceeds when system is production and user confirms", async () => {
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue(undefined)
      ;(getSAPSystemInfo as jest.Mock).mockResolvedValue({
        currentClient: { category: "Production", clientNumber: "100", clientName: "PROD" }
      })
      ;(window.showWarningMessage as jest.Mock).mockResolvedValue({ action: "proceed" })
      ;(vscode.debug.startDebugging as jest.Mock).mockResolvedValue(true)

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "prod100", action: "start" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("started")
    })

    it("cancels when production guard check fails (fail-closed)", async () => {
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue(undefined)
      ;(getSAPSystemInfo as jest.Mock).mockRejectedValue(new Error("connection error"))

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100", action: "start" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("cancelled")
    })

    it("skips guard for non-production system", async () => {
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue(undefined)
      ;(getSAPSystemInfo as jest.Mock).mockResolvedValue({
        currentClient: { category: "Development" }
      })
      ;(vscode.debug.startDebugging as jest.Mock).mockResolvedValue(true)

      await tool.invoke(
        makeOptions({ connectionId: "dev100", action: "start" }),
        mockToken
      )
      expect(window.showWarningMessage).not.toHaveBeenCalled()
    })

    it("detects production via category starting with P", async () => {
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue(undefined)
      ;(getSAPSystemInfo as jest.Mock).mockResolvedValue({
        currentClient: { category: "P" }
      })
      ;(window.showWarningMessage as jest.Mock).mockResolvedValue(undefined)

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "prod100", action: "start" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("cancelled")
    })
  })
})

// ====================================
// ABAPBreakpointTool
// ====================================
describe("ABAPBreakpointTool", () => {
  let tool: ABAPBreakpointTool

  beforeEach(() => {
    tool = new ABAPBreakpointTool()
    jest.clearAllMocks()
  })

  describe("prepareInvocation", () => {
    it("returns invocation message with filePath", async () => {
      const result: any = await tool.prepareInvocation(
        makeOptions({ connectionId: "dev100", filePath: "adt://dev100/src/ZTEST.prog.abap", lineNumbers: [10, 20] }),
        mockToken
      )
      expect(result.invocationMessage).toContain("adt://dev100/src/ZTEST.prog.abap")
    })

    it("includes line numbers in confirmation", async () => {
      const result: any = await tool.prepareInvocation(
        makeOptions({ connectionId: "dev100", filePath: "test.abap", lineNumbers: [5, 15, 25] }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.value).toContain("5, 15, 25")
    })

    it("includes condition in confirmation when provided", async () => {
      const result: any = await tool.prepareInvocation(
        makeOptions({ connectionId: "dev100", filePath: "test.abap", lineNumbers: [10], condition: "SY-SUBRC = 0" }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.value).toContain("SY-SUBRC = 0")
    })
  })

  describe("invoke", () => {
    it("throws when no debug session exists", async () => {
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue(undefined)
      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100", filePath: "test.abap", lineNumbers: [10], action: "set" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("No active debug session")
    })

    it("sets breakpoints via breakpoint manager", async () => {
      const mockSetBreakpoints = jest.fn().mockResolvedValue([
        { verified: true, line: 10 },
        { verified: false, line: 20 }
      ])
      const mockSession = {
        debugListener: {
          breakpointManager: { setBreakpoints: mockSetBreakpoints }
        }
      }
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue(mockSession)

      const result: any = await tool.invoke(
        makeOptions({
          connectionId: "dev100",
          filePath: "adt://dev100/src/ZTEST.prog.abap",
          lineNumbers: [10, 20],
          action: "set"
        }),
        mockToken
      )
      expect(mockSetBreakpoints).toHaveBeenCalled()
      expect(result.parts[0].text).toContain("1 of 2")
    })

    it("removes breakpoints with empty array", async () => {
      const mockSetBreakpoints = jest.fn().mockResolvedValue([])
      const mockSession = {
        debugListener: {
          breakpointManager: { setBreakpoints: mockSetBreakpoints }
        }
      }
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue(mockSession)

      const result: any = await tool.invoke(
        makeOptions({
          connectionId: "dev100",
          filePath: "adt://dev100/src/ZTEST.prog.abap",
          lineNumbers: [10],
          action: "remove"
        }),
        mockToken
      )
      expect(result.parts[0].text).toContain("removed")
    })

    it("defaults action to set", async () => {
      const mockSetBreakpoints = jest.fn().mockResolvedValue([{ verified: true, line: 10 }])
      const mockSession = {
        debugListener: {
          breakpointManager: { setBreakpoints: mockSetBreakpoints }
        }
      }
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue(mockSession)

      await tool.invoke(
        makeOptions({
          connectionId: "dev100",
          filePath: "test.abap",
          lineNumbers: [10]
        }),
        mockToken
      )
      expect(mockSetBreakpoints).toHaveBeenCalledWith(
        expect.objectContaining({ path: "test.abap" }),
        expect.arrayContaining([expect.objectContaining({ line: 10 })])
      )
    })

    it("reports error when debugListener is missing", async () => {
      const mockSession = { debugListener: undefined }
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue(mockSession)

      const result: any = await tool.invoke(
        makeOptions({
          connectionId: "dev100",
          filePath: "test.abap",
          lineNumbers: [10],
          action: "set"
        }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Debug listener not available")
    })

    it("reports error for unknown action", async () => {
      const mockSession = {
        debugListener: {
          breakpointManager: { setBreakpoints: jest.fn().mockResolvedValue([]) }
        }
      }
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue(mockSession)

      const result: any = await tool.invoke(
        makeOptions({
          connectionId: "dev100",
          filePath: "test.abap",
          lineNumbers: [10],
          action: "toggle"
        }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Unknown breakpoint action")
    })

    it("passes condition to source breakpoints", async () => {
      const mockSetBreakpoints = jest.fn().mockResolvedValue([{ verified: true, line: 10 }])
      const mockSession = {
        debugListener: {
          breakpointManager: { setBreakpoints: mockSetBreakpoints }
        }
      }
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue(mockSession)

      await tool.invoke(
        makeOptions({
          connectionId: "dev100",
          filePath: "test.abap",
          lineNumbers: [10],
          condition: "SY-SUBRC <> 0"
        }),
        mockToken
      )
      expect(mockSetBreakpoints).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([expect.objectContaining({ condition: "SY-SUBRC <> 0" })])
      )
    })
  })
})

// ====================================
// ABAPDebugStepTool
// ====================================
describe("ABAPDebugStepTool", () => {
  let tool: ABAPDebugStepTool

  beforeEach(() => {
    tool = new ABAPDebugStepTool()
    jest.clearAllMocks()
    ;(vscode.debug as any).activeDebugSession = undefined
  })

  describe("prepareInvocation", () => {
    it("returns step description for continue", async () => {
      const result: any = await tool.prepareInvocation(
        makeOptions({ connectionId: "dev100", stepType: "continue" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("F5")
    })

    it("returns step description for stepOver", async () => {
      const result: any = await tool.prepareInvocation(
        makeOptions({ connectionId: "dev100", stepType: "stepOver" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("F6")
    })

    it("returns step description for stepInto", async () => {
      const result: any = await tool.prepareInvocation(
        makeOptions({ connectionId: "dev100", stepType: "stepInto" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("F7")
    })

    it("returns step description for stepReturn", async () => {
      const result: any = await tool.prepareInvocation(
        makeOptions({ connectionId: "dev100", stepType: "stepReturn" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("F8")
    })

    it("includes targetLine for jumpToLine", async () => {
      const result: any = await tool.prepareInvocation(
        makeOptions({ connectionId: "dev100", stepType: "jumpToLine", targetLine: 42 }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.value).toContain("42")
    })
  })

  describe("invoke", () => {
    it("throws when no ABAP debug session exists", async () => {
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue(undefined)
      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100", stepType: "continue" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("No active debug session")
    })

    it("throws when VS Code debug session is not abap type", async () => {
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({})
      ;(vscode.debug as any).activeDebugSession = { type: "node" }

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100", stepType: "continue" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("No active ABAP debug session")
    })

    it("sends continue request", async () => {
      const mockCustomRequest = jest.fn().mockResolvedValue({})
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({})
      ;(vscode.debug as any).activeDebugSession = { type: "abap", customRequest: mockCustomRequest }

      // Mock stackTrace for post-step location
      mockCustomRequest.mockImplementation((cmd: string) => {
        if (cmd === "stackTrace") return Promise.resolve({ stackFrames: [] })
        return Promise.resolve({})
      })

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100", stepType: "continue" }),
        mockToken
      )
      expect(mockCustomRequest).toHaveBeenCalledWith("continue", { threadId: 1 })
      expect(result.parts[0].text).toContain("F5")
    })

    it("sends next request for stepOver", async () => {
      const mockCustomRequest = jest.fn().mockImplementation((cmd: string) => {
        if (cmd === "stackTrace") return Promise.resolve({ stackFrames: [] })
        return Promise.resolve({})
      })
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({})
      ;(vscode.debug as any).activeDebugSession = { type: "abap", customRequest: mockCustomRequest }

      await tool.invoke(
        makeOptions({ connectionId: "dev100", stepType: "stepOver" }),
        mockToken
      )
      expect(mockCustomRequest).toHaveBeenCalledWith("next", { threadId: 1 })
    })

    it("sends stepIn request for stepInto", async () => {
      const mockCustomRequest = jest.fn().mockImplementation((cmd: string) => {
        if (cmd === "stackTrace") return Promise.resolve({ stackFrames: [] })
        return Promise.resolve({})
      })
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({})
      ;(vscode.debug as any).activeDebugSession = { type: "abap", customRequest: mockCustomRequest }

      await tool.invoke(
        makeOptions({ connectionId: "dev100", stepType: "stepInto" }),
        mockToken
      )
      expect(mockCustomRequest).toHaveBeenCalledWith("stepIn", { threadId: 1 })
    })

    it("sends stepOut request for stepReturn", async () => {
      const mockCustomRequest = jest.fn().mockImplementation((cmd: string) => {
        if (cmd === "stackTrace") return Promise.resolve({ stackFrames: [] })
        return Promise.resolve({})
      })
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({})
      ;(vscode.debug as any).activeDebugSession = { type: "abap", customRequest: mockCustomRequest }

      await tool.invoke(
        makeOptions({ connectionId: "dev100", stepType: "stepReturn" }),
        mockToken
      )
      expect(mockCustomRequest).toHaveBeenCalledWith("stepOut", { threadId: 1 })
    })

    it("requires targetLine for jumpToLine", async () => {
      const mockCustomRequest = jest.fn().mockResolvedValue({})
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({})
      ;(vscode.debug as any).activeDebugSession = { type: "abap", customRequest: mockCustomRequest }

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100", stepType: "jumpToLine" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Target line is required")
    })

    it("handles jumpToLine with no available targets", async () => {
      const mockCustomRequest = jest.fn().mockImplementation((cmd: string) => {
        if (cmd === "gotoTargets") return Promise.resolve({ targets: [] })
        return Promise.resolve({})
      })
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({})
      ;(vscode.debug as any).activeDebugSession = { type: "abap", customRequest: mockCustomRequest }

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100", stepType: "jumpToLine", targetLine: 99 }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Cannot jump to line 99")
    })

    it("uses custom threadId when provided", async () => {
      const mockCustomRequest = jest.fn().mockImplementation((cmd: string) => {
        if (cmd === "stackTrace") return Promise.resolve({ stackFrames: [] })
        return Promise.resolve({})
      })
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({})
      ;(vscode.debug as any).activeDebugSession = { type: "abap", customRequest: mockCustomRequest }

      await tool.invoke(
        makeOptions({ connectionId: "dev100", stepType: "continue", threadId: 5 }),
        mockToken
      )
      expect(mockCustomRequest).toHaveBeenCalledWith("continue", { threadId: 5 })
    })

    it("reports unknown step type", async () => {
      const mockCustomRequest = jest.fn().mockResolvedValue({})
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({})
      ;(vscode.debug as any).activeDebugSession = { type: "abap", customRequest: mockCustomRequest }

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100", stepType: "invalid" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Unknown step type")
    })
  })
})

// ====================================
// ABAPDebugVariableTool
// ====================================
describe("ABAPDebugVariableTool", () => {
  let tool: ABAPDebugVariableTool

  beforeEach(() => {
    tool = new ABAPDebugVariableTool()
    jest.clearAllMocks()
    ;(vscode.debug as any).activeDebugSession = undefined
  })

  describe("prepareInvocation", () => {
    it("shows variable name in invocation message", async () => {
      const result: any = await tool.prepareInvocation(
        makeOptions({ connectionId: "dev100", variableName: "LV_TEST" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("LV_TEST")
    })

    it("shows expression when no variable name", async () => {
      const result: any = await tool.prepareInvocation(
        makeOptions({ connectionId: "dev100", expression: "SY-SUBRC" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("SY-SUBRC")
    })

    it("falls back to 'variables' when neither name nor expression given", async () => {
      const result: any = await tool.prepareInvocation(
        makeOptions({ connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("variables")
    })

    it("includes filter in confirmation when provided", async () => {
      const result: any = await tool.prepareInvocation(
        makeOptions({ connectionId: "dev100", variableName: "LT_DATA", filter: "ERROR" }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.value).toContain("ERROR")
    })
  })

  describe("invoke", () => {
    it("throws when no debug session exists", async () => {
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue(undefined)
      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100", variableName: "LV_TEST" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("No active debug session")
    })

    it("throws when VS Code debug session is not abap type", async () => {
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({})
      ;(vscode.debug as any).activeDebugSession = { type: "node" }

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100", variableName: "LV_TEST" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("No active ABAP debug session")
    })

    it("auto-recovers invalid frameId from stack trace", async () => {
      const mockCustomRequest = jest.fn().mockImplementation((cmd: string, args: any) => {
        if (cmd === "scopes" && args.frameId === 0) {
          return Promise.reject(new Error("Invalid frame"))
        }
        if (cmd === "scopes" && args.frameId === 1000000000) {
          return Promise.resolve({ scopes: [{ name: "Local Variables", variablesReference: 1 }] })
        }
        if (cmd === "stackTrace") {
          return Promise.resolve({
            stackFrames: [{ id: 1000000000, name: "TEST_METHOD", line: 10 }]
          })
        }
        if (cmd === "variables") {
          return Promise.resolve({
            variables: [{ name: "LV_TEST", value: "42", variablesReference: 0 }]
          })
        }
        return Promise.resolve({})
      })
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({})
      ;(vscode.debug as any).activeDebugSession = { type: "abap", customRequest: mockCustomRequest }

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100", variableName: "LV_TEST", frameId: 0 }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Auto-recovered")
    })

    it("evaluates expressions", async () => {
      const mockCustomRequest = jest.fn().mockImplementation((cmd: string) => {
        if (cmd === "scopes") return Promise.resolve({ scopes: [{ name: "Local Variables", variablesReference: 1 }] })
        if (cmd === "evaluate") {
          return Promise.resolve({ result: "0", type: "I" })
        }
        return Promise.resolve({})
      })
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({})
      ;(vscode.debug as any).activeDebugSession = { type: "abap", customRequest: mockCustomRequest }

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100", expression: "SY-SUBRC", frameId: 100 }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Expression")
      expect(result.parts[0].text).toContain("0")
    })

    it("lists scopes when no variableName or expression given", async () => {
      const mockCustomRequest = jest.fn().mockImplementation((cmd: string) => {
        if (cmd === "scopes") {
          return Promise.resolve({
            scopes: [
              { name: "Local Variables", variablesReference: 1 },
              { name: "SY", variablesReference: 2 }
            ]
          })
        }
        if (cmd === "variables") {
          return Promise.resolve({
            variables: [{ name: "LV_TEST", value: "hello", variablesReference: 0 }]
          })
        }
        return Promise.resolve({})
      })
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({})
      ;(vscode.debug as any).activeDebugSession = { type: "abap", customRequest: mockCustomRequest }

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100", frameId: 100 }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Available Scopes")
      expect(result.parts[0].text).toContain("Local Variables")
    })

    it("returns not-found message for non-existent variable", async () => {
      const mockCustomRequest = jest.fn().mockImplementation((cmd: string) => {
        if (cmd === "scopes") {
          return Promise.resolve({
            scopes: [{ name: "Local Variables", variablesReference: 1 }]
          })
        }
        if (cmd === "stackTrace") {
          return Promise.resolve({
            stackFrames: [{ id: 100, name: "MAIN" }]
          })
        }
        if (cmd === "variables") {
          return Promise.resolve({
            variables: [{ name: "OTHER_VAR", value: "abc", variablesReference: 0 }]
          })
        }
        return Promise.resolve({})
      })
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({})
      ;(vscode.debug as any).activeDebugSession = { type: "abap", customRequest: mockCustomRequest }

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100", variableName: "LV_MISSING", frameId: 100 }),
        mockToken
      )
      expect(result.parts[0].text).toContain("not found")
    })

    it("defaults frameId to 0", async () => {
      // frameId defaults to 0, which will trigger auto-recovery if invalid
      const mockCustomRequest = jest.fn().mockImplementation((cmd: string, args: any) => {
        if (cmd === "scopes") {
          return Promise.resolve({
            scopes: [{ name: "Local Variables", variablesReference: 1 }]
          })
        }
        if (cmd === "variables") {
          return Promise.resolve({ variables: [] })
        }
        return Promise.resolve({})
      })
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({})
      ;(vscode.debug as any).activeDebugSession = { type: "abap", customRequest: mockCustomRequest }

      await tool.invoke(
        makeOptions({ connectionId: "dev100" }),
        mockToken
      )
      // Scopes should be called with default frameId 0
      expect(mockCustomRequest).toHaveBeenCalledWith("scopes", { frameId: 0 })
    })
  })
})

// ====================================
// ABAPDebugStackTool
// ====================================
describe("ABAPDebugStackTool", () => {
  let tool: ABAPDebugStackTool

  beforeEach(() => {
    tool = new ABAPDebugStackTool()
    jest.clearAllMocks()
    ;(vscode.debug as any).activeDebugSession = undefined
  })

  describe("prepareInvocation", () => {
    it("returns invocation message with connectionId", async () => {
      const result: any = await tool.prepareInvocation(
        makeOptions({ connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("dev100")
    })

    it("includes threadId in confirmation when provided", async () => {
      const result: any = await tool.prepareInvocation(
        makeOptions({ connectionId: "dev100", threadId: 3 }),
        mockToken
      )
      expect((result.confirmationMessages as any).message.value).toContain("3")
    })
  })

  describe("invoke", () => {
    it("throws when no debug session exists", async () => {
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue(undefined)
      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("No active debug session")
    })

    it("throws when no VS Code abap debug session", async () => {
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({})
      ;(vscode.debug as any).activeDebugSession = { type: "node" }

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("No active ABAP debug session")
    })

    it("returns stack frames", async () => {
      const mockCustomRequest = jest.fn().mockResolvedValue({
        stackFrames: [
          { id: 1000, name: "IF_TEST~METHOD1", source: { name: "ZCL_TEST" }, line: 42, column: 0 },
          { id: 1001, name: "MAIN", source: { name: "ZPROGRAM" }, line: 10, column: 0 }
        ]
      })
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({})
      ;(vscode.debug as any).activeDebugSession = { type: "abap", customRequest: mockCustomRequest }

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("2 frames")
      expect(result.parts[0].text).toContain("IF_TEST~METHOD1")
      expect(result.parts[0].text).toContain("Current execution point")
    })

    it("throws when no stack trace available", async () => {
      const mockCustomRequest = jest.fn().mockResolvedValue({ stackFrames: null })
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({})
      ;(vscode.debug as any).activeDebugSession = { type: "abap", customRequest: mockCustomRequest }

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("No stack trace available")
    })

    it("uses default threadId of 1", async () => {
      const mockCustomRequest = jest.fn().mockResolvedValue({
        stackFrames: [{ id: 1, name: "MAIN", source: { name: "TEST" }, line: 1 }]
      })
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({})
      ;(vscode.debug as any).activeDebugSession = { type: "abap", customRequest: mockCustomRequest }

      await tool.invoke(makeOptions({ connectionId: "dev100" }), mockToken)
      expect(mockCustomRequest).toHaveBeenCalledWith("stackTrace", expect.objectContaining({ threadId: 1 }))
    })

    it("uses custom threadId when provided", async () => {
      const mockCustomRequest = jest.fn().mockResolvedValue({
        stackFrames: [{ id: 1, name: "MAIN", source: { name: "TEST" }, line: 1 }]
      })
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({})
      ;(vscode.debug as any).activeDebugSession = { type: "abap", customRequest: mockCustomRequest }

      await tool.invoke(makeOptions({ connectionId: "dev100", threadId: 7 }), mockToken)
      expect(mockCustomRequest).toHaveBeenCalledWith("stackTrace", expect.objectContaining({ threadId: 7 }))
    })
  })
})

// ====================================
// ABAPDebugStatusTool
// ====================================
describe("ABAPDebugStatusTool", () => {
  let tool: ABAPDebugStatusTool

  beforeEach(() => {
    tool = new ABAPDebugStatusTool()
    jest.clearAllMocks()
    ;(vscode.debug as any).activeDebugSession = undefined
  })

  describe("prepareInvocation", () => {
    it("returns invocation message with connectionId", async () => {
      const result: any = await tool.prepareInvocation(
        makeOptions({ connectionId: "dev100" }),
        mockToken
      )
      expect(result.invocationMessage).toContain("dev100")
    })
  })

  describe("invoke", () => {
    it("returns no active session info when nothing running", async () => {
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue(undefined)
      Object.defineProperty(AbapDebugSession, "activeSessions", { value: 0, writable: true })

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("ABAP Session Active:** No")
      expect(result.parts[0].text).toContain("No active debugging session")
    })

    it("shows active session details when running", async () => {
      const mockCustomRequest = jest.fn().mockImplementation((cmd: string) => {
        if (cmd === "threads") return Promise.resolve({ threads: [{ id: 1, name: "Main" }] })
        if (cmd === "stackTrace") return Promise.resolve({ stackFrames: [] })
        return Promise.resolve({})
      })
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({
        debugListener: { activeServices: () => [] }
      })
      ;(vscode.debug as any).activeDebugSession = { type: "abap", customRequest: mockCustomRequest }
      Object.defineProperty(AbapDebugSession, "activeSessions", { value: 1, writable: true })

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("ABAP Session Active:** Yes")
      expect(result.parts[0].text).toContain("VS Code Debug Active:** Yes")
    })

    it("shows paused state with current location", async () => {
      const mockCustomRequest = jest.fn().mockImplementation((cmd: string) => {
        if (cmd === "threads") return Promise.resolve({ threads: [{ id: 1, name: "Main" }] })
        if (cmd === "stackTrace") {
          return Promise.resolve({
            stackFrames: [{
              id: 1000,
              name: "IF_TEST~DO_SOMETHING",
              source: { name: "ZCL_TEST", path: "adt://dev100/ZCL_TEST" },
              line: 25
            }]
          })
        }
        return Promise.resolve({})
      })
      ;(AbapDebugSession.byConnection as jest.Mock).mockReturnValue({
        debugListener: { activeServices: () => [] }
      })
      ;(vscode.debug as any).activeDebugSession = { type: "abap", customRequest: mockCustomRequest }

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Paused at breakpoint")
      expect(result.parts[0].text).toContain("ZCL_TEST")
      expect(result.parts[0].text).toContain("line 25")
    })

    it("handles error during status check gracefully", async () => {
      ;(AbapDebugSession.byConnection as jest.Mock).mockImplementation(() => {
        throw new Error("Connection lost")
      })

      const result: any = await tool.invoke(
        makeOptions({ connectionId: "dev100" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Connection lost")
    })
  })
})
