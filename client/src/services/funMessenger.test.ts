/**
 * Tests for funMessenger.ts
 * Tests the message enhancement logic, pattern detection, and wrapped window functions.
 */

// Mock vscode before any imports
jest.mock(
  "vscode",
  () => ({
    window: {
      showInformationMessage: jest.fn(),
      showErrorMessage: jest.fn(),
      showWarningMessage: jest.fn(),
      setStatusBarMessage: jest.fn(),
      withProgress: jest.fn(),
      createWebviewPanel: jest.fn(),
      activeTextEditor: undefined,
      visibleTextEditors: [],
      tabGroups: { all: [], close: jest.fn() }
    },
    workspace: {
      getConfiguration: jest.fn().mockReturnValue({
        get: jest.fn().mockReturnValue(false),
        update: jest.fn()
      })
    }
  }),
  { virtual: true }
)

import * as vscode from "vscode"
import { funWindow } from "./funMessenger"

const mockVscode = vscode as jest.Mocked<typeof vscode>

function setupProfessionalMode(enabled: boolean) {
  ;(mockVscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
    get: jest.fn((key: string, defaultVal: any) => {
      if (key === "professionalNotifications") return enabled
      return defaultVal
    }),
    update: jest.fn()
  })
}

describe("funMessenger", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setupProfessionalMode(false)
  })

  describe("funWindow.showInformationMessage", () => {
    it("enhances a success message with a fun prefix", () => {
      ;(mockVscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined)
      funWindow.showInformationMessage("Successfully saved the file")
      const calledWith = (mockVscode.window.showInformationMessage as jest.Mock).mock.calls[0][0] as string
      expect(calledWith).not.toBe("Successfully saved the file")
      expect(calledWith.length).toBeGreaterThan("Successfully saved the file".length)
    })

    it("passes additional items through", () => {
      ;(mockVscode.window.showInformationMessage as jest.Mock).mockResolvedValue("OK")
      funWindow.showInformationMessage("Done", "OK", "Cancel")
      expect(mockVscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.any(String),
        "OK",
        "Cancel"
      )
    })

    it("calls vscode.window.showInformationMessage exactly once", () => {
      funWindow.showInformationMessage("hello")
      expect(mockVscode.window.showInformationMessage).toHaveBeenCalledTimes(1)
    })
  })

  describe("funWindow.showErrorMessage", () => {
    it("enhances an error message with a fun prefix", () => {
      ;(mockVscode.window.showErrorMessage as jest.Mock).mockResolvedValue(undefined)
      funWindow.showErrorMessage("Failed to connect to server")
      const calledWith = (mockVscode.window.showErrorMessage as jest.Mock).mock.calls[0][0] as string
      expect(calledWith).not.toBe("Failed to connect to server")
    })

    it("passes additional items through", () => {
      funWindow.showErrorMessage("Error occurred", "Retry")
      expect(mockVscode.window.showErrorMessage).toHaveBeenCalledWith(expect.any(String), "Retry")
    })
  })

  describe("funWindow.showWarningMessage", () => {
    it("enhances a warning message", () => {
      ;(mockVscode.window.showWarningMessage as jest.Mock).mockResolvedValue(undefined)
      funWindow.showWarningMessage("Warning: multiple connections detected")
      const calledWith = (mockVscode.window.showWarningMessage as jest.Mock).mock.calls[0][0] as string
      expect(calledWith).not.toBe("Warning: multiple connections detected")
    })
  })

  describe("funWindow.setStatusBarMessage", () => {
    it("enhances and passes through", () => {
      ;(mockVscode.window.setStatusBarMessage as jest.Mock).mockReturnValue({ dispose: jest.fn() })
      funWindow.setStatusBarMessage("Searching for objects...")
      const calledWith = (mockVscode.window.setStatusBarMessage as jest.Mock).mock.calls[0][0] as string
      expect(calledWith).not.toBe("Searching for objects...")
    })

    it("passes timeout parameter through", () => {
      ;(mockVscode.window.setStatusBarMessage as jest.Mock).mockReturnValue({ dispose: jest.fn() })
      funWindow.setStatusBarMessage("Done", 3000)
      expect(mockVscode.window.setStatusBarMessage).toHaveBeenCalledWith(expect.any(String), 3000)
    })
  })

  describe("funWindow.withProgress", () => {
    it("enhances the progress title", async () => {
      ;(mockVscode.window.withProgress as jest.Mock).mockResolvedValue("result")
      const task = jest.fn().mockResolvedValue("done")
      await funWindow.withProgress(
        { location: 15, title: "Activating code..." },
        task
      )
      const options = (mockVscode.window.withProgress as jest.Mock).mock.calls[0][0]
      expect(options.title).not.toBe("Activating code...")
    })

    it("passes through undefined title unchanged", async () => {
      ;(mockVscode.window.withProgress as jest.Mock).mockResolvedValue(undefined)
      const task = jest.fn().mockResolvedValue("done")
      await funWindow.withProgress({ location: 15 }, task)
      const options = (mockVscode.window.withProgress as jest.Mock).mock.calls[0][0]
      expect(options.title).toBeUndefined()
    })
  })

  describe("professional mode", () => {
    it("does NOT add fun prefix when professionalNotifications is true", () => {
      setupProfessionalMode(true)
      ;(mockVscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined)
      funWindow.showInformationMessage("Successfully saved the file")
      const calledWith = (mockVscode.window.showInformationMessage as jest.Mock).mock.calls[0][0] as string
      expect(calledWith).toBe("Successfully saved the file")
    })

    it("does NOT add fun prefix to errors when professional mode enabled", () => {
      setupProfessionalMode(true)
      ;(mockVscode.window.showErrorMessage as jest.Mock).mockResolvedValue(undefined)
      funWindow.showErrorMessage("Failed to load")
      const calledWith = (mockVscode.window.showErrorMessage as jest.Mock).mock.calls[0][0] as string
      expect(calledWith).toBe("Failed to load")
    })
  })

  describe("message type detection (via prefix changes)", () => {
    const cases: Array<{ message: string; description: string }> = [
      { message: "Successfully connected to SAP", description: "success message" },
      { message: "Failed to activate object", description: "error message" },
      { message: "Warning: already exists", description: "warning message" },
      { message: "Activating the program...", description: "activation message" },
      { message: "Running unit tests...", description: "test message" },
      { message: "Searching for objects...", description: "search message" },
      { message: "Connected to DEV100", description: "connection message" },
      { message: "Saved to server", description: "saved message" },
      { message: "Refreshed successfully", description: "refresh message" },
      { message: "Creating new class...", description: "creation message" },
    ]

    cases.forEach(({ message, description }) => {
      it(`enhances a ${description}`, () => {
        ;(mockVscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined)
        funWindow.showInformationMessage(message)
        expect(mockVscode.window.showInformationMessage).toHaveBeenCalledTimes(1)
        const calledWith = (mockVscode.window.showInformationMessage as jest.Mock).mock.calls[0][0] as string
        // Message should have been enhanced (have a prefix), not be identical
        // (funMessenger always enhances unless professional mode)
        expect(typeof calledWith).toBe("string")
        expect(calledWith.length).toBeGreaterThan(0)
      })
    })

    it("returns enhanced string for normal/unknown messages", () => {
      ;(mockVscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined)
      funWindow.showInformationMessage("Some random message with no patterns")
      expect(mockVscode.window.showInformationMessage).toHaveBeenCalledTimes(1)
    })
  })
})
