jest.mock("vscode", () => {
  const mockUri = {
    scheme: "adt",
    authority: "dev100",
    path: "/sap/bc/adt/programs/programs/ztest/source/main",
    with: jest.fn()
  }
  return {
    Uri: {
      parse: jest.fn((s: string) => {
        const [scheme, rest] = s.split("://")
        const [authority, ...pathParts] = (rest || "").split("/")
        return {
          scheme,
          authority,
          path: "/" + pathParts.join("/"),
          with: jest.fn((opts: any) => ({ ...mockUri, ...opts })),
          toString: () => s
        }
      })
    },
    workspace: {
      fs: {
        stat: jest.fn()
      }
    },
    commands: {
      registerCommand: jest.fn(() => ({ dispose: jest.fn() })),
      executeCommand: jest.fn()
    }
  }
}, { virtual: true })

jest.mock("../services/funMessenger", () => ({
  funWindow: {
    activeTextEditor: undefined,
    showWarningMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showQuickPick: jest.fn()
  }
}))

jest.mock("../adt/conections", () => ({
  ADTSCHEME: "adt"
}))

jest.mock("../config", () => ({
  connectedRoots: jest.fn(),
  formatKey: jest.fn((s: string) => s?.toLowerCase() ?? s)
}))

jest.mock("../services/telemetry", () => ({
  logTelemetry: jest.fn()
}))

import { compareWithOtherSystem, registerCompareWithSystemCommand } from "./compareWithSystem"
import { funWindow as window } from "../services/funMessenger"
import { connectedRoots, formatKey } from "../config"
import * as vscode from "vscode"

const mockWindow = window as jest.Mocked<typeof window>
const mockConnectedRoots = connectedRoots as jest.MockedFunction<typeof connectedRoots>
const mockFormatKey = formatKey as jest.MockedFunction<typeof formatKey>

function makeUri(authority: string, path: string): vscode.Uri {
  return {
    scheme: "adt",
    authority,
    path,
    with: jest.fn((opts: any) => makeUri(opts.authority ?? authority, opts.path ?? path)),
    toString: () => `adt://${authority}${path}`
  } as any
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(mockWindow as any).activeTextEditor = undefined
  ;(vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({})
  ;(vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined)
  mockFormatKey.mockImplementation((s: string) => s?.toLowerCase() ?? s)
})

describe("compareWithOtherSystem", () => {
  test("shows warning when no URI provided and no active editor", async () => {
    await compareWithOtherSystem(undefined)
    expect(mockWindow.showWarningMessage).toHaveBeenCalledWith(
      "Please select an ABAP file to compare"
    )
  })

  test("shows warning when active editor is not ABAP scheme", async () => {
    ;(mockWindow as any).activeTextEditor = {
      document: { uri: { scheme: "file", authority: "", path: "/some/file.ts" } }
    }
    await compareWithOtherSystem(undefined)
    expect(mockWindow.showWarningMessage).toHaveBeenCalledWith(
      "Please select an ABAP file to compare"
    )
  })

  test("shows warning when URI scheme is not adt", async () => {
    const uri = { scheme: "file", authority: "dev100", path: "/test", with: jest.fn() } as any
    await compareWithOtherSystem(uri)
    expect(mockWindow.showWarningMessage).toHaveBeenCalledWith(
      "Please select an ABAP file to compare"
    )
  })

  test("shows warning when only one system connected", async () => {
    const sourceUri = makeUri("dev100", "/sap/bc/adt/programs/programs/ztest/source/main")
    const roots = new Map([["dev100", { name: "DEV100" }]])
    mockConnectedRoots.mockReturnValue(roots as any)

    await compareWithOtherSystem(sourceUri)
    expect(mockWindow.showWarningMessage).toHaveBeenCalledWith(
      "Connect to at least one other SAP system to compare."
    )
  })

  test("shows warning when no other systems available after filtering", async () => {
    const sourceUri = makeUri("dev100", "/sap/bc/adt/programs/programs/ztest/source/main")
    const roots = new Map([
      ["dev100", { name: "DEV100" }],
      ["dev100", { name: "DEV100" }] // same system
    ])
    mockConnectedRoots.mockReturnValue(roots as any)

    await compareWithOtherSystem(sourceUri)
    // With only one unique key, shows warning about single system
    expect(mockWindow.showWarningMessage).toHaveBeenCalled()
  })

  test("returns without diff when user cancels quick pick", async () => {
    const sourceUri = makeUri("dev100", "/sap/bc/adt/programs/programs/ztest/source/main")
    const roots = new Map([
      ["dev100", { name: "DEV100" }],
      ["qas100", { name: "QAS100" }]
    ])
    mockConnectedRoots.mockReturnValue(roots as any)
    ;(mockWindow.showQuickPick as jest.Mock).mockResolvedValue(undefined)

    await compareWithOtherSystem(sourceUri)
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      "vscode.diff",
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
  })

  test("opens diff when valid systems and user selects target", async () => {
    const sourceUri = makeUri("dev100", "/sap/bc/adt/programs/programs/ztest/source/main")
    const roots = new Map([
      ["dev100", { name: "DEV100" }],
      ["qas100", { name: "QAS100" }]
    ])
    mockConnectedRoots.mockReturnValue(roots as any)
    ;(mockWindow.showQuickPick as jest.Mock).mockResolvedValue({
      label: "QAS100",
      description: "qas100"
    })

    await compareWithOtherSystem(sourceUri)
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "vscode.diff",
      expect.anything(),
      expect.anything(),
      expect.stringContaining("↔")
    )
  })

  test("uses active editor URI when none provided", async () => {
    const editorUri = makeUri("dev100", "/sap/bc/adt/programs/programs/ztest/source/main")
    ;(mockWindow as any).activeTextEditor = {
      document: { uri: editorUri }
    }
    const roots = new Map([
      ["dev100", { name: "DEV100" }],
      ["qas100", { name: "QAS100" }]
    ])
    mockConnectedRoots.mockReturnValue(roots as any)
    ;(mockWindow.showQuickPick as jest.Mock).mockResolvedValue(undefined)

    await compareWithOtherSystem(undefined)
    expect(mockWindow.showQuickPick).toHaveBeenCalled()
  })

  test("tries alternate path when target file not found in Source Code Library", async () => {
    const sourceUri = makeUri(
      "dev100",
      "/dev100/Source Code Library/Programs/ztest/ztest.prog.abap"
    )
    const roots = new Map([
      ["dev100", { name: "DEV100" }],
      ["qas100", { name: "QAS100" }]
    ])
    mockConnectedRoots.mockReturnValue(roots as any)
    ;(mockWindow.showQuickPick as jest.Mock).mockResolvedValue({
      label: "QAS100",
      description: "qas100"
    })
    // First stat fails, second succeeds
    ;(vscode.workspace.fs.stat as jest.Mock)
      .mockRejectedValueOnce(new Error("not found"))
      .mockResolvedValueOnce({})

    await compareWithOtherSystem(sourceUri)
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "vscode.diff",
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
  })

  test("tries alternate path when target file not found in Source Library", async () => {
    const sourceUri = makeUri("dev100", "/dev100/Source Library/Programs/ztest/ztest.prog.abap")
    const roots = new Map([
      ["dev100", { name: "DEV100" }],
      ["qas100", { name: "QAS100" }]
    ])
    mockConnectedRoots.mockReturnValue(roots as any)
    ;(mockWindow.showQuickPick as jest.Mock).mockResolvedValue({
      label: "QAS100",
      description: "qas100"
    })
    ;(vscode.workspace.fs.stat as jest.Mock)
      .mockRejectedValueOnce(new Error("not found"))
      .mockResolvedValueOnce({})

    await compareWithOtherSystem(sourceUri)
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "vscode.diff",
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
  })

  test("shows error when object not found in target system", async () => {
    const sourceUri = makeUri("dev100", "/sap/bc/adt/programs/programs/ztest/source/main")
    const roots = new Map([
      ["dev100", { name: "DEV100" }],
      ["qas100", { name: "QAS100" }]
    ])
    mockConnectedRoots.mockReturnValue(roots as any)
    ;(mockWindow.showQuickPick as jest.Mock).mockResolvedValue({
      label: "QAS100",
      description: "qas100"
    })
    ;(vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error("not found"))

    await compareWithOtherSystem(sourceUri)
    expect(mockWindow.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("Failed to compare")
    )
  })

  test("diff title strips known ABAP extensions from filename", async () => {
    const sourceUri = makeUri(
      "dev100",
      "/sap/bc/adt/programs/programs/ztest/ztest.prog.abap"
    )
    const roots = new Map([
      ["dev100", { name: "DEV100" }],
      ["qas100", { name: "QAS100" }]
    ])
    mockConnectedRoots.mockReturnValue(roots as any)
    ;(mockWindow.showQuickPick as jest.Mock).mockResolvedValue({
      label: "QAS100",
      description: "qas100"
    })

    let capturedTitle = ""
    ;(vscode.commands.executeCommand as jest.Mock).mockImplementation(
      (cmd: string, _a: any, _b: any, title: string) => {
        if (cmd === "vscode.diff") capturedTitle = title
      }
    )

    await compareWithOtherSystem(sourceUri)
    expect(capturedTitle).not.toContain(".prog.abap")
  })
})

describe("registerCompareWithSystemCommand", () => {
  test("registers the command with VS Code", () => {
    const ctx = { subscriptions: { push: jest.fn() } } as any
    registerCompareWithSystemCommand(ctx)
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      "abapfs.compareWithOtherSystem",
      compareWithOtherSystem
    )
    expect(ctx.subscriptions.push).toHaveBeenCalled()
  })
})
