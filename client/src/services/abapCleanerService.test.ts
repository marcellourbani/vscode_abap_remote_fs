/**
 * Tests for abapCleanerService.ts
 * Tests CleanerConfig loading, path validation, availability checks, and CleanerResult.
 */

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn(function (key: string, def: any) {
        return def
      }),
      update: vi.fn()
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    applyEdit: vi.fn().mockResolvedValue(true),
    fs: { writeFile: vi.fn().mockResolvedValue(undefined) }
  },
  commands: {
    executeCommand: vi.fn().mockResolvedValue(undefined),
    registerCommand: vi.fn()
  },
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showQuickPick: vi.fn(),
    showOpenDialog: vi.fn(),
    withProgress: vi.fn(),
    activeTextEditor: undefined,
    visibleTextEditors: []
  },
  ProgressLocation: { Notification: 15 },
  WorkspaceEdit: vi.fn().mockImplementation(function () {
    return {
      replace: vi.fn()
    }
  }),
  Range: vi.fn().mockImplementation(function (s: any, e: any) {
    return { start: s, end: e }
  }),
  Position: vi.fn().mockImplementation(function (l: number, c: number) {
    return { line: l, character: c }
  }),
  Uri: {
    file: vi.fn(function (p: string) {
      return { fsPath: p }
    }),
    parse: vi.fn(function (s: string) {
      return { toString: () => s }
    })
  },
  env: { openExternal: vi.fn() }
}))

vi.mock("./funMessenger", () => ({
  funWindow: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showQuickPick: vi.fn(),
    showOpenDialog: vi.fn(),
    withProgress: vi.fn(),
    activeTextEditor: undefined,
    visibleTextEditors: []
  }
}))

vi.mock("../lib", () => ({ log: vi.fn() }))
vi.mock("./telemetry", () => ({ logTelemetry: vi.fn() }))

// Mock filesystem
vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdtempSync: vi.fn().mockReturnValue("/tmp/abap-cleaner-test"),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue("cleaned code"),
  unlinkSync: vi.fn()
}))

vi.mock("util", () => ({
  promisify: vi.fn(function (fn: any) {
    return fn
  })
}))

vi.mock("child_process", () => ({
  exec: vi.fn()
}))

import * as vscode from "vscode"
import * as fs from "fs"
import { ABAPCleanerService } from "./abapCleanerService"
import * as __$mock_funMessenger from "./funMessenger"
import type { Mock } from "vitest"

// Reset singleton between tests
function resetSingleton() {
  ;(ABAPCleanerService as any).instance = undefined
}

function setupConfig(overrides: Record<string, any> = {}) {
  ;(vscode.workspace.getConfiguration as Mock).mockReturnValue({
    get: vi.fn(function (key: string, def: any) {
      if (key in overrides) return overrides[key]
      return def
    }),
    update: vi.fn()
  })
  ;(vscode.workspace.onDidChangeConfiguration as Mock).mockReturnValue({ dispose: vi.fn() })
}

describe("ABAPCleanerService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      ;(fs.existsSync as Mock).mockReturnValue(false)
      setupConfig({ enabled: true, executablePath: "/path/to/abap-cleanerc.exe" })
      const svc = ABAPCleanerService.getInstance()
      expect(svc.isAvailable()).toBe(false)
    })

    it("returns true when enabled and executable exists", () => {
      ;(fs.existsSync as Mock).mockReturnValue(true)
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
      ;(fs.existsSync as Mock).mockReturnValue(false)
      setupConfig({ executablePath: "/nonexistent/path.exe" })
      const svc = ABAPCleanerService.getInstance()
      expect(svc.isExecutableValid()).toBe(false)
    })

    it("returns true when file exists", () => {
      ;(fs.existsSync as Mock).mockReturnValue(true)
      setupConfig({ executablePath: "/valid/path.exe" })
      const svc = ABAPCleanerService.getInstance()
      expect(svc.isExecutableValid()).toBe(true)
    })
  })

  describe("cleanCode - path validation", () => {
    beforeEach(() => {
      ;(fs.existsSync as Mock).mockReturnValue(true)
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
      const { funWindow } = __$mock_funMessenger
      Object.defineProperty(funWindow, "activeTextEditor", { value: undefined, configurable: true })
      setupConfig({ enabled: true, executablePath: "/valid/path.exe" })
      ;(fs.existsSync as Mock).mockReturnValue(true)
      const svc = ABAPCleanerService.getInstance()
      const result = await svc.cleanActiveEditor()
      expect(result).toBe(false)
    })

    it("returns false when active editor is not ABAP", async () => {
      const { funWindow } = __$mock_funMessenger
      Object.defineProperty(funWindow, "activeTextEditor", {
        value: {
          document: { languageId: "javascript", getText: () => "", fileName: "test.js" },
          selection: { isEmpty: true }
        },
        configurable: true
      })
      funWindow.showWarningMessage = vi.fn()
      setupConfig({ enabled: true, executablePath: "/valid/path.exe" })
      ;(fs.existsSync as Mock).mockReturnValue(true)
      const svc = ABAPCleanerService.getInstance()
      const result = await svc.cleanActiveEditor()
      expect(result).toBe(false)
    })
  })
})
