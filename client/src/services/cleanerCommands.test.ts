const {
  mockRegisterCommand,
  mockOnWillSaveTextDocument,
  mockOnDidChangeConfiguration,
  mockExecuteCommand,
  mockShowInformationMessage,
  mockShowWarningMessage
} = vi.hoisted(() => {
  const mockRegisterCommand = vi.fn().mockReturnValue({ dispose: vi.fn() })
  const mockOnWillSaveTextDocument = vi.fn().mockReturnValue({ dispose: vi.fn() })
  const mockOnDidChangeConfiguration = vi.fn().mockReturnValue({ dispose: vi.fn() })
  const mockExecuteCommand = vi.fn().mockResolvedValue(undefined)
  const mockShowInformationMessage = vi.fn()
  const mockShowWarningMessage = vi.fn()
  return {
    mockRegisterCommand,
    mockOnWillSaveTextDocument,
    mockOnDidChangeConfiguration,
    mockExecuteCommand,
    mockShowInformationMessage,
    mockShowWarningMessage
  }
})
vi.mock("vscode", () => ({
  commands: {
    registerCommand: mockRegisterCommand,
    executeCommand: mockExecuteCommand
  },
  workspace: {
    onWillSaveTextDocument: mockOnWillSaveTextDocument,
    onDidChangeConfiguration: mockOnDidChangeConfiguration,
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn(function (k: string, d: any) {
        return d
      }),
      update: vi.fn()
    })
  },
  window: {
    showInformationMessage: mockShowInformationMessage,
    showWarningMessage: mockShowWarningMessage,
    visibleTextEditors: []
  }
}))

vi.mock("./funMessenger", () => ({
  funWindow: {
    showInformationMessage: mockShowInformationMessage,
    showWarningMessage: mockShowWarningMessage,
    visibleTextEditors: []
  }
}))

vi.mock("./abapCleanerService", () => ({
  ABAPCleanerService: {
    getInstance: vi.fn().mockReturnValue({
      isAvailable: vi.fn().mockReturnValue(true),
      cleanActiveEditor: vi.fn().mockResolvedValue(true),
      setupWizard: vi.fn().mockResolvedValue(undefined),
      shouldCleanOnSave: vi.fn().mockReturnValue(false)
    })
  }
}))

vi.mock("../lib", () => ({ log: vi.fn() }))
vi.mock("./telemetry", () => ({ logTelemetry: vi.fn() }))

import * as vscode from "vscode"
import {
  registerCleanerCommands,
  updateCleanerContext,
  setupCleanerContextMonitoring
} from "./cleanerCommands"
import { ABAPCleanerService } from "./abapCleanerService"
import type { Mock } from "vitest"

const mockCleanerService = {
  isAvailable: vi.fn().mockReturnValue(true),
  cleanActiveEditor: vi.fn().mockResolvedValue(true),
  setupWizard: vi.fn().mockResolvedValue(undefined),
  shouldCleanOnSave: vi.fn().mockReturnValue(false)
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(ABAPCleanerService.getInstance as Mock).mockReturnValue(mockCleanerService)
})

function makeContext() {
  return {
    subscriptions: [] as any[],
    globalState: { get: vi.fn(), update: vi.fn() }
  } as any
}

describe("registerCleanerCommands", () => {
  it("registers abapfs.cleanCode command", () => {
    const context = makeContext()
    registerCleanerCommands(context)
    const registeredNames = mockRegisterCommand.mock.calls.map((c: any) => c[0])
    expect(registeredNames).toContain("abapfs.cleanCode")
  })

  it("registers abapfs.setupCleaner command", () => {
    const context = makeContext()
    registerCleanerCommands(context)
    const registeredNames = mockRegisterCommand.mock.calls.map((c: any) => c[0])
    expect(registeredNames).toContain("abapfs.setupCleaner")
  })

  it("adds disposables to context.subscriptions", () => {
    const context = makeContext()
    registerCleanerCommands(context)
    expect(context.subscriptions.length).toBeGreaterThan(0)
  })

  it("registers onWillSaveTextDocument listener", () => {
    const context = makeContext()
    registerCleanerCommands(context)
    expect(mockOnWillSaveTextDocument).toHaveBeenCalledTimes(1)
  })

  describe("abapfs.cleanCode command handler", () => {
    it("calls cleanActiveEditor when service is available", async () => {
      mockCleanerService.isAvailable.mockReturnValue(true)
      const context = makeContext()
      registerCleanerCommands(context)

      // Find the cleanCode command handler
      const cleanCodeCall = mockRegisterCommand.mock.calls.find(
        (c: any) => c[0] === "abapfs.cleanCode"
      )
      const handler = cleanCodeCall?.[1]
      await handler?.()

      expect(mockCleanerService.cleanActiveEditor).toHaveBeenCalledTimes(1)
    })

    it("shows setup prompt when service is not available", async () => {
      mockCleanerService.isAvailable.mockReturnValue(false)
      mockShowInformationMessage.mockResolvedValue("Cancel")
      const context = makeContext()
      registerCleanerCommands(context)

      const cleanCodeCall = mockRegisterCommand.mock.calls.find(
        (c: any) => c[0] === "abapfs.cleanCode"
      )
      const handler = cleanCodeCall?.[1]
      await handler?.()

      expect(mockCleanerService.cleanActiveEditor).not.toHaveBeenCalled()
      expect(mockShowInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining("not configured"),
        expect.any(String),
        expect.any(String)
      )
    })

    it("calls setupWizard when user clicks 'Setup Now'", async () => {
      mockCleanerService.isAvailable.mockReturnValue(false)
      mockShowInformationMessage.mockResolvedValue("Setup Now")
      const context = makeContext()
      registerCleanerCommands(context)

      const cleanCodeCall = mockRegisterCommand.mock.calls.find(
        (c: any) => c[0] === "abapfs.cleanCode"
      )
      const handler = cleanCodeCall?.[1]
      await handler?.()

      expect(mockCleanerService.setupWizard).toHaveBeenCalledTimes(1)
    })
  })

  describe("abapfs.setupCleaner command handler", () => {
    it("calls setupWizard", async () => {
      const context = makeContext()
      registerCleanerCommands(context)

      const setupCall = mockRegisterCommand.mock.calls.find(
        (c: any) => c[0] === "abapfs.setupCleaner"
      )
      const handler = setupCall?.[1]
      await handler?.()

      expect(mockCleanerService.setupWizard).toHaveBeenCalledTimes(1)
    })
  })
})

describe("updateCleanerContext", () => {
  it("calls setContext with abapfs.cleanerAvailable=true when available", () => {
    mockCleanerService.isAvailable.mockReturnValue(true)
    updateCleanerContext()
    expect(mockExecuteCommand).toHaveBeenCalledWith("setContext", "abapfs.cleanerAvailable", true)
  })

  it("calls setContext with abapfs.cleanerAvailable=false when not available", () => {
    mockCleanerService.isAvailable.mockReturnValue(false)
    updateCleanerContext()
    expect(mockExecuteCommand).toHaveBeenCalledWith("setContext", "abapfs.cleanerAvailable", false)
  })
})

describe("setupCleanerContextMonitoring", () => {
  it("registers onDidChangeConfiguration listener", () => {
    const context = makeContext()
    setupCleanerContextMonitoring(context)
    expect(mockOnDidChangeConfiguration).toHaveBeenCalledTimes(1)
  })

  it("adds disposable to context.subscriptions", () => {
    const context = makeContext()
    setupCleanerContextMonitoring(context)
    expect(context.subscriptions.length).toBeGreaterThan(0)
  })

  it("calls updateCleanerContext immediately on setup", () => {
    const context = makeContext()
    mockCleanerService.isAvailable.mockReturnValue(true)
    setupCleanerContextMonitoring(context)
    // updateCleanerContext is called internally, verify via setContext
    expect(mockExecuteCommand).toHaveBeenCalledWith("setContext", "abapfs.cleanerAvailable", true)
  })

  it("updates context when cleaner config changes", () => {
    const context = makeContext()
    setupCleanerContextMonitoring(context)

    // Simulate a configuration change event
    const changeHandler = mockOnDidChangeConfiguration.mock.calls[0][0]
    mockCleanerService.isAvailable.mockReturnValue(false)
    changeHandler({ affectsConfiguration: (s: string) => s === "abapfs.cleaner" })

    expect(mockExecuteCommand).toHaveBeenCalledWith("setContext", "abapfs.cleanerAvailable", false)
  })

  it("does not update context for unrelated config changes", () => {
    const context = makeContext()
    setupCleanerContextMonitoring(context)
    mockExecuteCommand.mockClear()

    const changeHandler = mockOnDidChangeConfiguration.mock.calls[0][0]
    changeHandler({ affectsConfiguration: (s: string) => s === "editor.fontSize" })

    expect(mockExecuteCommand).not.toHaveBeenCalled()
  })
})
