vi.mock("vscode", () => {
  const mockUri = {
    scheme: "adt",
    authority: "dev100",
    path: "/sap/bc/adt/programs/programs/ztest/source/main",
    with: vi.fn()
  }
  return {
    Uri: {
      parse: vi.fn(function (s: string) {
        const [scheme, rest] = s.split("://")
        const [authority, ...pathParts] = (rest || "").split("/")
        return {
          scheme,
          authority,
          path: "/" + pathParts.join("/"),
          with: vi.fn((opts: any) => ({ ...mockUri, ...opts })),
          toString: () => s
        }
      })
    },
    workspace: {
      fs: {
        stat: vi.fn()
      }
    },
    commands: {
      registerCommand: vi.fn(function () {
        return { dispose: vi.fn() }
      }),
      executeCommand: vi.fn()
    }
  }
})

vi.mock("../services/funMessenger", () => ({
  funWindow: {
    activeTextEditor: undefined,
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showQuickPick: vi.fn()
  }
}))

vi.mock("../adt/conections", () => ({
  ADTSCHEME: "adt"
}))

vi.mock("../config", () => ({
  connectedRoots: vi.fn(),
  formatKey: vi.fn(function (s: string) {
    return s?.toLowerCase() ?? s
  })
}))

vi.mock("../services/telemetry", () => ({
  logTelemetry: vi.fn()
}))

import { compareWithOtherSystem, registerCompareWithSystemCommand } from "./compareWithSystem"
import { funWindow as window } from "../services/funMessenger"
import { connectedRoots, formatKey } from "../config"
import * as vscode from "vscode"
import type { Mocked, MockedFunction, Mock } from "vitest"

const mockWindow = window as Mocked<typeof window>
const mockConnectedRoots = connectedRoots as MockedFunction<typeof connectedRoots>
const mockFormatKey = formatKey as MockedFunction<typeof formatKey>

function makeUri(authority: string, path: string): vscode.Uri {
  return {
    scheme: "adt",
    authority,
    path,
    with: vi.fn(function (opts: any) {
      return makeUri(opts.authority ?? authority, opts.path ?? path)
    }),
    toString: () => `adt://${authority}${path}`
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(mockWindow as any).activeTextEditor = undefined
  ;(vscode.workspace.fs.stat as Mock).mockResolvedValue({})
  ;(vscode.commands.executeCommand as Mock).mockResolvedValue(undefined)
  mockFormatKey.mockImplementation(function (s: string) {
    return s?.toLowerCase() ?? s
  })
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
    const uri = { scheme: "file", authority: "dev100", path: "/test", with: vi.fn() } as any
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
    ;(mockWindow.showQuickPick as Mock).mockResolvedValue(undefined)

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
    ;(mockWindow.showQuickPick as Mock).mockResolvedValue({
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
    ;(mockWindow.showQuickPick as Mock).mockResolvedValue(undefined)

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
    ;(mockWindow.showQuickPick as Mock).mockResolvedValue({
      label: "QAS100",
      description: "qas100"
    })
    // First stat fails, second succeeds
    ;(vscode.workspace.fs.stat as Mock)
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
    ;(mockWindow.showQuickPick as Mock).mockResolvedValue({
      label: "QAS100",
      description: "qas100"
    })
    ;(vscode.workspace.fs.stat as Mock)
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
    ;(mockWindow.showQuickPick as Mock).mockResolvedValue({
      label: "QAS100",
      description: "qas100"
    })
    ;(vscode.workspace.fs.stat as Mock).mockRejectedValue(new Error("not found"))

    await compareWithOtherSystem(sourceUri)
    expect(mockWindow.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("Failed to compare")
    )
  })

  test("diff title strips known ABAP extensions from filename", async () => {
    const sourceUri = makeUri("dev100", "/sap/bc/adt/programs/programs/ztest/ztest.prog.abap")
    const roots = new Map([
      ["dev100", { name: "DEV100" }],
      ["qas100", { name: "QAS100" }]
    ])
    mockConnectedRoots.mockReturnValue(roots as any)
    ;(mockWindow.showQuickPick as Mock).mockResolvedValue({
      label: "QAS100",
      description: "qas100"
    })

    let capturedTitle = ""
    ;(vscode.commands.executeCommand as Mock).mockImplementation(function (
      cmd: string,
      _a: any,
      _b: any,
      title: string
    ) {
      if (cmd === "vscode.diff") capturedTitle = title
    })

    await compareWithOtherSystem(sourceUri)
    expect(capturedTitle).not.toContain(".prog.abap")
  })
})

describe("registerCompareWithSystemCommand", () => {
  test("registers the command with VS Code", () => {
    const ctx = { subscriptions: { push: vi.fn() } } as any
    registerCompareWithSystemCommand(ctx)
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      "abapfs.compareWithOtherSystem",
      compareWithOtherSystem
    )
    expect(ctx.subscriptions.push).toHaveBeenCalled()
  })
})
