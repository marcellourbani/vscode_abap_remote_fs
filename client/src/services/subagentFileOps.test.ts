/**
 * Tests for subagentFileOps.ts
 * Tests template processing, file operations, and agent enable/disable logic.
 */

jest.mock(
  "vscode",
  () => ({
    workspace: {
      getConfiguration: jest.fn().mockReturnValue({
        get: jest.fn((key: string, def: any) => def),
        update: jest.fn().mockResolvedValue(undefined)
      }),
      fs: {
        readFile: jest.fn(),
        writeFile: jest.fn().mockResolvedValue(undefined),
        createDirectory: jest.fn().mockResolvedValue(undefined),
        stat: jest.fn(),
        rename: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
        readDirectory: jest.fn().mockResolvedValue([])
      },
      openTextDocument: jest.fn().mockResolvedValue({})
    },
    commands: {
      executeCommand: jest.fn().mockResolvedValue(undefined)
    },
    window: {
      showWarningMessage: jest.fn(),
      showInformationMessage: jest.fn(),
      tabGroups: { all: [] }
    },
    Uri: {
      file: jest.fn((p: string) => ({ fsPath: p, toString: () => p })),
      joinPath: jest.fn((base: any, ...segs: string[]) => {
        const joined = [base?.fsPath || String(base), ...segs].join("/")
        return { fsPath: joined, toString: () => joined }
      })
    },
    FileType: { File: 1, Directory: 2 },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    languages: {
      getDiagnostics: jest.fn().mockReturnValue([])
    },
    TabInputText: class {
      constructor(public uri: any) {}
    },
    ConfigurationTarget: { Global: 1, Workspace: 2 }
  }),
  { virtual: true }
)

jest.mock("./funMessenger", () => ({
  funWindow: {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    tabGroups: { all: [], close: jest.fn() }
  }
}))

jest.mock("./subagentRegistry", () => ({
  AGENT_REGISTRY: [
    { id: "abap-reader", templateFile: "abap-reader.agent.md", tools: ["tool1"] },
    { id: "abap-discoverer", templateFile: "abap-discoverer.agent.md", tools: null }
  ],
  getSubagentSettings: jest.fn().mockReturnValue({ models: { "abap-reader": "gpt-4o", "abap-discoverer": "gpt-4o" } }),
  getWorkspaceFolder: jest.fn().mockReturnValue({ fsPath: "/workspace", toString: () => "/workspace" }),
  getExtensionId: jest.fn().mockReturnValue("murbani.vscode-abap-remote-fs"),
  buildFullToolName: jest.fn((ext: string, t: string) => `${ext}_${t}`)
}))

import * as vscode from "vscode"
import {
  processTemplate,
  loadTemplate,
  refreshExplorer,
  closeAgentEditors,
  disableAgentFiles,
  hasDisabledAgentFiles,
  enableSubagentsCore,
  disableSubagentsCore
} from "./subagentFileOps"
import { getWorkspaceFolder } from "./subagentRegistry"

describe("subagentFileOps", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ============================================================================
  // processTemplate
  // ============================================================================
  describe("processTemplate", () => {
    it("replaces {{MODEL}} with provided model", () => {
      const result = processTemplate("model: '{{MODEL}}'", "gpt-4o", null, "ext-id")
      expect(result).toBe("model: 'gpt-4o'")
    })

    it("removes model line when model is empty string", () => {
      const result = processTemplate("model: '{{MODEL}}'\nother: content", "", null, "ext-id")
      expect(result).not.toContain("{{MODEL}}")
    })

    it("replaces {{TOOLS}} with full tool names when tools provided", () => {
      const result = processTemplate("tools: [{{TOOLS}}]", "gpt-4o", ["tool1", "tool2"], "ext-id")
      expect(result).toContain("ext-id_tool1")
      expect(result).toContain("ext-id_tool2")
    })

    it("removes tools line when tools is null", () => {
      const result = processTemplate("tools: [{{TOOLS}}]\nother: content", "gpt-4o", null, "ext-id")
      expect(result).not.toContain("{{TOOLS}}")
    })

    it("replaces multiple occurrences of {{MODEL}}", () => {
      const result = processTemplate("model: {{MODEL}}\n# Using {{MODEL}}", "gpt-4o", null, "ext-id")
      expect(result).toBe("model: gpt-4o\n# Using gpt-4o")
    })

    it("handles template with no placeholders", () => {
      const result = processTemplate("# Static content", "gpt-4o", null, "ext-id")
      expect(result).toBe("# Static content")
    })

    it("quotes tool names with single quotes", () => {
      const result = processTemplate("tools: [{{TOOLS}}]", "gpt-4o", ["myTool"], "ext")
      expect(result).toContain("'ext_myTool'")
    })
  })

  // ============================================================================
  // loadTemplate
  // ============================================================================
  describe("loadTemplate", () => {
    const mockContext = {
      extensionPath: "/ext",
      subscriptions: []
    } as any

    it("loads template from dist path first", async () => {
      const content = Buffer.from("template content")
      ;(vscode.workspace.fs.readFile as jest.Mock).mockResolvedValueOnce(content)
      const result = await loadTemplate(mockContext, "test.agent.md")
      expect(result).toBe("template content")
    })

    it("falls back to dev path when dist path fails", async () => {
      ;(vscode.workspace.fs.readFile as jest.Mock)
        .mockRejectedValueOnce(new Error("not found"))
        .mockResolvedValueOnce(Buffer.from("dev content"))
      const result = await loadTemplate(mockContext, "test.agent.md")
      expect(result).toBe("dev content")
    })

    it("throws when both paths fail", async () => {
      ;(vscode.workspace.fs.readFile as jest.Mock)
        .mockRejectedValueOnce(new Error("not found"))
        .mockRejectedValueOnce(new Error("also not found"))
      await expect(loadTemplate(mockContext, "missing.md")).rejects.toThrow(
        "Could not load template"
      )
    })
  })

  // ============================================================================
  // refreshExplorer
  // ============================================================================
  describe("refreshExplorer", () => {
    it("executes the refreshFilesExplorer command", async () => {
      jest.useFakeTimers()
      const promise = refreshExplorer()
      await jest.runAllTimersAsync()
      await promise
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "workbench.files.action.refreshFilesExplorer"
      )
      jest.useRealTimers()
    })

    it("does not throw when command fails", async () => {
      jest.useFakeTimers()
      ;(vscode.commands.executeCommand as jest.Mock).mockRejectedValueOnce(new Error("no command"))
      const promise = refreshExplorer()
      await jest.runAllTimersAsync()
      await expect(promise).resolves.not.toThrow()
      jest.useRealTimers()
    })
  })

  // ============================================================================
  // closeAgentEditors
  // ============================================================================
  describe("closeAgentEditors", () => {
    it("closes tabs that contain .github/agents/ path", async () => {
      const { TabInputText } = vscode as any
      const mockTab = {
        input: new TabInputText({ fsPath: "/workspace/.github/agents/abap-reader.agent.md" })
      }
      const mockTabGroups = {
        all: [{ tabs: [mockTab] }],
        close: jest.fn().mockResolvedValue(undefined)
      }
      const { funWindow } = require("./funMessenger")
      funWindow.tabGroups = mockTabGroups

      const workspaceUri = { fsPath: "/workspace" } as any
      await closeAgentEditors(workspaceUri)
      expect(mockTabGroups.close).toHaveBeenCalledWith(mockTab)
    })

    it("does not close tabs outside agents folder", async () => {
      const { TabInputText } = vscode as any
      const mockTab = {
        input: new TabInputText({ fsPath: "/workspace/src/main.ts" })
      }
      const mockTabGroups = {
        all: [{ tabs: [mockTab] }],
        close: jest.fn()
      }
      const { funWindow } = require("./funMessenger")
      funWindow.tabGroups = mockTabGroups

      const workspaceUri = { fsPath: "/workspace" } as any
      await closeAgentEditors(workspaceUri)
      expect(mockTabGroups.close).not.toHaveBeenCalled()
    })
  })

  // ============================================================================
  // hasDisabledAgentFiles
  // ============================================================================
  describe("hasDisabledAgentFiles", () => {
    it("returns true when agents_disabled folder exists", async () => {
      ;(vscode.workspace.fs.stat as jest.Mock).mockResolvedValueOnce({})
      const result = await hasDisabledAgentFiles({ fsPath: "/workspace" } as any)
      expect(result).toBe(true)
    })

    it("returns false when agents_disabled folder does not exist", async () => {
      ;(vscode.workspace.fs.stat as jest.Mock).mockRejectedValueOnce(new Error("not found"))
      const result = await hasDisabledAgentFiles({ fsPath: "/workspace" } as any)
      expect(result).toBe(false)
    })
  })

  // ============================================================================
  // disableAgentFiles
  // ============================================================================
  describe("disableAgentFiles", () => {
    it("returns true after successful rename", async () => {
      ;(vscode.workspace.fs.stat as jest.Mock).mockResolvedValueOnce({}) // agents dir exists
      ;(vscode.workspace.fs.delete as jest.Mock).mockRejectedValueOnce(new Error("not found")) // disabled dir doesn't exist
      jest.useFakeTimers()
      const promise = disableAgentFiles({ fsPath: "/workspace" } as any)
      await jest.runAllTimersAsync()
      const result = await promise
      expect(result).toBe(true)
      jest.useRealTimers()
    })

    it("returns false when agents folder does not exist", async () => {
      ;(vscode.workspace.fs.stat as jest.Mock).mockRejectedValueOnce(new Error("not found"))
      const result = await disableAgentFiles({ fsPath: "/workspace" } as any)
      expect(result).toBe(false)
    })
  })

  // ============================================================================
  // disableSubagentsCore
  // ============================================================================
  describe("disableSubagentsCore", () => {
    it("returns success=true", async () => {
      ;(getWorkspaceFolder as jest.Mock).mockReturnValue({ fsPath: "/workspace" })
      ;(vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error("not found"))
      const result = await disableSubagentsCore()
      expect(result.success).toBe(true)
    })

    it("updates abapfs.subagents.enabled to false", async () => {
      ;(getWorkspaceFolder as jest.Mock).mockReturnValue({ fsPath: "/workspace" })
      ;(vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error("not found"))
      const mockUpdate = jest.fn().mockResolvedValue(undefined)
      ;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn((k: string, d: any) => d),
        update: mockUpdate
      })
      await disableSubagentsCore()
      expect(mockUpdate).toHaveBeenCalledWith("enabled", false, vscode.ConfigurationTarget.Workspace)
    })
  })
})
