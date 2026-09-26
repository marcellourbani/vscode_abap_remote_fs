/**
 * Tests for virtualToolsFix.ts
 * Tests the disableVirtualToolGrouping function behavior under various conditions.
 */

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn(),
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }]
  },
  window: {
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    withProgress: vi.fn()
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2
  },
  ProgressLocation: { Notification: 15 },
  lm: {
    selectChatModels: vi.fn().mockResolvedValue([{}])
  },
  TreeItem: class {
    constructor(
      public label: string,
      public collapsibleState?: any
    ) {}
  },
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2
  },
  EventEmitter: class {
    event = vi.fn()
    fire = vi.fn()
  },
  Uri: {
    parse: vi.fn(),
    file: vi.fn()
  }
}))

vi.mock("./lm-tools/toolGuard", () => ({
  assertToolInvocationAuthorized: vi.fn(),
  isToolInvocationAuthorized: vi.fn(function () {
    return true
  })
}))

vi.mock("./funMessenger", () => ({
  funWindow: {
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    withProgress: vi.fn(function (options, task) {
      return task({ report: vi.fn() })
    })
  }
}))

vi.mock("../adt/conections", () => ({
  ADTSCHEME: "adt"
}))

vi.mock("../lib", () => ({
  log: vi.fn()
}))

import * as vscode from "vscode"
import { funWindow } from "./funMessenger"
import { disableVirtualToolGrouping } from "./virtualToolsFix"
import type { Mocked, Mock } from "vitest"

const mockFunWindow = funWindow as Mocked<typeof funWindow>

function makeContext(dismissed = false): any {
  return {
    globalState: {
      get: vi.fn(function (key: string) {
        if (key === "abapfs.virtualToolsFix.dismissed") return dismissed
        return undefined
      }),
      update: vi.fn().mockResolvedValue(undefined)
    },
    subscriptions: []
  }
}

function makeConfig(
  effectiveValue: number | undefined,
  workspaceValue?: number,
  globalValue?: number
) {
  return {
    inspect: vi.fn().mockReturnValue({
      defaultValue: 128,
      workspaceValue,
      globalValue,
      key: "github.copilot.chat.virtualTools.threshold"
    }),
    update: vi.fn().mockResolvedValue(undefined),
    get: vi.fn()
  }
}

describe("disableVirtualToolGrouping", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: "/workspace" } }]
  })

  it("does nothing when user previously dismissed", async () => {
    const context = makeContext(true)
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(makeConfig(128))
    await disableVirtualToolGrouping(context)
    expect(mockFunWindow.showWarningMessage).not.toHaveBeenCalled()
  })

  it("does nothing when threshold is already 0", async () => {
    const context = makeContext(false)
    const cfg = makeConfig(0, 0, 0)
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)
    await disableVirtualToolGrouping(context)
    expect(mockFunWindow.showWarningMessage).not.toHaveBeenCalled()
  })

  it("shows warning message when threshold > 0", async () => {
    const context = makeContext(false)
    const cfg = makeConfig(128, undefined, undefined)
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)
    ;(mockFunWindow.showWarningMessage as Mock).mockResolvedValue(undefined) // user dismissed
    await disableVirtualToolGrouping(context)
    expect(mockFunWindow.showWarningMessage).toHaveBeenCalledTimes(1)
  })

  it("includes the effective threshold value in the warning message", async () => {
    const context = makeContext(false)
    const cfg = makeConfig(64, 64, undefined)
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)
    ;(mockFunWindow.showWarningMessage as Mock).mockResolvedValue(undefined)
    await disableVirtualToolGrouping(context)
    const msgArg = (mockFunWindow.showWarningMessage as Mock).mock.calls[0][0] as string
    expect(msgArg).toContain("64")
  })

  it("saves dismissed flag when user chooses 'Don't Ask Again'", async () => {
    const context = makeContext(false)
    const cfg = makeConfig(128)
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)
    ;(mockFunWindow.showWarningMessage as Mock).mockResolvedValue("Don't Ask Again")
    await disableVirtualToolGrouping(context)
    expect(context.globalState.update).toHaveBeenCalledWith(
      "abapfs.virtualToolsFix.dismissed",
      true
    )
  })

  it("does NOT update settings when user chooses 'Remind Me Next Time'", async () => {
    const context = makeContext(false)
    const cfg = makeConfig(128)
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)
    ;(mockFunWindow.showWarningMessage as Mock).mockResolvedValue("Remind Me Next Time")
    await disableVirtualToolGrouping(context)
    expect(cfg.update).not.toHaveBeenCalled()
    expect(context.globalState.update).not.toHaveBeenCalled()
  })

  it("does NOT update settings when user dismisses dialog (undefined)", async () => {
    const context = makeContext(false)
    const cfg = makeConfig(128)
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)
    ;(mockFunWindow.showWarningMessage as Mock).mockResolvedValue(undefined)
    await disableVirtualToolGrouping(context)
    expect(cfg.update).not.toHaveBeenCalled()
  })

  it("calls withProgress when user chooses 'Disable & Reload'", async () => {
    const context = makeContext(false)
    const cfg = makeConfig(128)
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)
    ;(mockFunWindow.showWarningMessage as Mock).mockResolvedValue("Disable & Reload")
    ;(mockFunWindow.withProgress as Mock).mockImplementation(function (_opts: any, task: any) {
      return task({ report: vi.fn() }, {})
    })
    ;(vscode.workspace as any).workspaceFolders = []
    // Prevent reloadWindow from throwing
    const mockCommands = { executeCommand: vi.fn().mockResolvedValue(undefined) }
    ;(vscode as any).commands = mockCommands
    await disableVirtualToolGrouping(context)
    expect(mockFunWindow.withProgress).toHaveBeenCalledTimes(1)
  })

  it("updates config at global level when disabling", async () => {
    const context = makeContext(false)
    const cfg = makeConfig(128)
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)
    ;(mockFunWindow.showWarningMessage as Mock).mockResolvedValue("Disable & Reload")
    ;(mockFunWindow.withProgress as Mock).mockImplementation(function (_opts: any, task: any) {
      return task({ report: vi.fn() }, {})
    })
    ;(vscode as any).commands = { executeCommand: vi.fn().mockResolvedValue(undefined) }
    ;(vscode.workspace as any).workspaceFolders = []
    await disableVirtualToolGrouping(context)
    expect(cfg.update).toHaveBeenCalledWith(
      "github.copilot.chat.virtualTools.threshold",
      0,
      vscode.ConfigurationTarget.Global
    )
  })

  it("does not throw when an unexpected error occurs", async () => {
    const context = makeContext(false)
    ;(vscode.workspace.getConfiguration as Mock).mockImplementation(function () {
      throw new Error("Unexpected error")
    })
    await expect(disableVirtualToolGrouping(context)).resolves.not.toThrow()
  })

  it("uses workspace value when available (takes precedence over global)", async () => {
    const context = makeContext(false)
    // workspaceValue=64, globalValue=128 — effective should be 64
    const cfg = makeConfig(64, 64, 128)
    ;(vscode.workspace.getConfiguration as Mock).mockReturnValue(cfg)
    ;(mockFunWindow.showWarningMessage as Mock).mockResolvedValue(undefined)
    await disableVirtualToolGrouping(context)
    const msgArg = (mockFunWindow.showWarningMessage as Mock).mock.calls[0][0] as string
    expect(msgArg).toContain("64")
  })
})
