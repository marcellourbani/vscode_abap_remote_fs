/**
 * Tests for abapCleanerService.ts
 * Tests CleanerConfig loading, path validation, availability checks, and CleanerResult.
 */

jest.mock(
  "vscode",
  () => ({
    workspace: {
      getConfiguration: jest.fn().mockReturnValue({
        get: jest.fn((key: string, def: any) => def),
        update: jest.fn()
      }),
      onDidChangeConfiguration: jest.fn().mockReturnValue({ dispose: jest.fn() }),
      applyEdit: jest.fn().mockResolvedValue(true),
      fs: { writeFile: jest.fn().mockResolvedValue(undefined) }
    },
    commands: {
      executeCommand: jest.fn().mockResolvedValue(undefined),
      registerCommand: jest.fn()
    },
    window: {
      showInformationMessage: jest.fn(),
      showErrorMessage: jest.fn(),
      showWarningMessage: jest.fn(),
      showQuickPick: jest.fn(),
      showOpenDialog: jest.fn(),
      withProgress: jest.fn(),
      activeTextEditor: undefined,
      visibleTextEditors: []
    },
    ProgressLocation: { Notification: 15 },
    WorkspaceEdit: jest.fn().mockImplementation(() => ({
      replace: jest.fn()
    })),
    Range: jest.fn().mockImplementation((s: any, e: any) => ({ start: s, end: e })),
    Position: jest.fn().mockImplementation((l: number, c: number) => ({ line: l, character: c })),
    Uri: { file: jest.fn((p: string) => ({ fsPath: p })), parse: jest.fn((s: string) => ({ toString: () => s })) },
    env: { openExternal: jest.fn() }
  }),
  { virtual: true }
)

jest.mock("./funMessenger", () => ({
  funWindow: {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    showQuickPick: jest.fn(),
    showOpenDialog: jest.fn(),
    withProgress: jest.fn(),
    activeTextEditor: undefined,
    visibleTextEditors: []
  }
}))

jest.mock("../lib", () => ({ log: jest.fn() }))
jest.mock("./telemetry", () => ({ logTelemetry: jest.fn() }))

// Mock filesystem
jest.mock("fs", () => ({
  existsSync: jest.fn().mockReturnValue(true),
  mkdtempSync: jest.fn().mockReturnValue("/tmp/abap-cleaner-test"),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn().mockReturnValue("cleaned code"),
  unlinkSync: jest.fn()
}))

jest.mock("util", () => ({
  promisify: jest.fn((fn: any) => fn)
}))

jest.mock("child_process", () => ({
  exec: jest.fn()
}))

import * as vscode from "vscode"
import * as fs from "fs"
import { ABAPCleanerService } from "./abapCleanerService"

// Reset singleton between tests
function resetSingleton() {
  (ABAPCleanerService as any).instance = undefined
}

function setupConfig(overrides: Record<string, any> = {}) {
  ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
    get: jest.fn((key: string, def: any) => {
      if (key in overrides) return overrides[key]
      return def
    }),
    update: jest.fn()
  })
  ;(vscode.workspace.onDidChangeConfiguration as jest.Mock).mockReturnValue({ dispose: jest.fn() })
}

describe("ABAPCleanerService", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetSingleton()
    setupConfig()
  })

  describe("getInstance", () => {
    it("returns singleton instance", () => {
      const a = ABAPCleanerService.getInstance()
      const b = ABAPCleanerService.getInstance()
      expect(a).toBe(b)
    })
  })

  describe("isAvailable", () => {
    it("returns false when disabled in config", () => {
      setupConfig({ enabled: false })
      const svc = ABAPCleanerService.getInstance()
      expect(svc.isAvailable()).toBe(false)
    })

    it("returns false when enabled but no executable path", () => {
      setupConfig({ enabled: true, executablePath: "" })
      const svc = ABAPCleanerService.getInstance()
      expect(svc.isAvailable()).toBe(false)
    })

    it("returns false when enabled but executable does not exist", () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)
      setupConfig({ enabled: true, executablePath: "/path/to/abap-cleanerc.exe" })
      const svc = ABAPCleanerService.getInstance()
      expect(svc.isAvailable()).toBe(false)
    })

    it("returns true when enabled and executable exists", () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      setupConfig({ enabled: true, executablePath: "/path/to/abap-cleanerc.exe" })
      const svc = ABAPCleanerService.getInstance()
      expect(svc.isAvailable()).toBe(true)
    })
  })

  describe("isExecutableValid", () => {
    it("returns false when executablePath is empty", () => {
      setupConfig({ executablePath: "" })
      const svc = ABAPCleanerService.getInstance()
      expect(svc.isExecutableValid()).toBe(false)
    })

    it("returns false when file does not exist on filesystem", () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)
      setupConfig({ executablePath: "/nonexistent/path.exe" })
      const svc = ABAPCleanerService.getInstance()
      expect(svc.isExecutableValid()).toBe(false)
    })

    it("returns true when file exists", () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      setupConfig({ executablePath: "/valid/path.exe" })
      const svc = ABAPCleanerService.getInstance()
      expect(svc.isExecutableValid()).toBe(true)
    })
  })

  describe("cleanCode - path validation", () => {
    beforeEach(() => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      setupConfig({ enabled: true, executablePath: "/valid/abap-cleanerc.exe" })
    })

    it("returns error when not available", async () => {
      setupConfig({ enabled: false })
      const svc = ABAPCleanerService.getInstance()
      const result = await svc.cleanCode("DATA: lv_test TYPE string.")
      expect(result.success).toBe(false)
      expect(result.error).toContain("not available")
    })

    it("rejects executable path with path traversal (..) ", async () => {
      setupConfig({ enabled: true, executablePath: "/valid/../etc/malicious.exe" })
      const svc = ABAPCleanerService.getInstance()
      const result = await svc.cleanCode("DATA lv_x.")
      expect(result.success).toBe(false)
      expect(result.error).toContain("Security validation failed")
    })

    it("rejects executable path with semicolon injection", async () => {
      setupConfig({ enabled: true, executablePath: "/valid/path.exe; rm -rf /" })
      const svc = ABAPCleanerService.getInstance()
      const result = await svc.cleanCode("DATA lv_x.")
      expect(result.success).toBe(false)
      expect(result.error).toContain("Security validation failed")
    })

    it("rejects executable path with pipe character", async () => {
      setupConfig({ enabled: true, executablePath: "/valid/path.exe | cat /etc/passwd" })
      const svc = ABAPCleanerService.getInstance()
      const result = await svc.cleanCode("DATA lv_x.")
      expect(result.success).toBe(false)
      expect(result.error).toContain("Security validation failed")
    })

    it("rejects executable path with backtick injection", async () => {
      setupConfig({ enabled: true, executablePath: "/valid/path.exe`id`" })
      const svc = ABAPCleanerService.getInstance()
      const result = await svc.cleanCode("DATA lv_x.")
      expect(result.success).toBe(false)
      expect(result.error).toContain("Security validation failed")
    })

    it("rejects relative executable paths", async () => {
      setupConfig({ enabled: true, executablePath: "relative/path/cleaner.exe" })
      const svc = ABAPCleanerService.getInstance()
      const result = await svc.cleanCode("DATA lv_x.")
      expect(result.success).toBe(false)
      expect(result.error).toContain("Security validation failed")
    })
  })

  describe("cleanActiveEditor", () => {
    it("returns false when no active editor", async () => {
      const { funWindow } = require("./funMessenger")
      funWindow.activeTextEditor = undefined
      setupConfig({ enabled: true, executablePath: "/valid/path.exe" })
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      const svc = ABAPCleanerService.getInstance()
      const result = await svc.cleanActiveEditor()
      expect(result).toBe(false)
    })

    it("returns false when active editor is not ABAP", async () => {
      const { funWindow } = require("./funMessenger")
      funWindow.activeTextEditor = {
        document: { languageId: "javascript", getText: () => "", fileName: "test.js" },
        selection: { isEmpty: true }
      }
      funWindow.showWarningMessage = jest.fn()
      setupConfig({ enabled: true, executablePath: "/valid/path.exe" })
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      const svc = ABAPCleanerService.getInstance()
      const result = await svc.cleanActiveEditor()
      expect(result).toBe(false)
    })
  })
})
