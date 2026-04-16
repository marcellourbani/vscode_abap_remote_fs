jest.mock("vscode", () => ({
  LanguageModelToolResult: jest.fn().mockImplementation((parts: any[]) => ({ parts })),
  LanguageModelTextPart: jest.fn().mockImplementation((text: string) => ({ text })),
  MarkdownString: jest.fn().mockImplementation((value: string) => ({ value })),
  CancellationTokenSource: jest.fn().mockImplementation(() => ({
    token: { isCancellationRequested: false, onCancellationRequested: jest.fn() }
  })),
  lm: {
    registerTool: jest.fn(() => ({ dispose: jest.fn() })),
    onDidChangeChatModels: jest.fn(() => ({ dispose: jest.fn() }))
  },
  window: { activeTextEditor: undefined },
  workspace: {
    workspaceFolders: [],
    getConfiguration: jest.fn(() => ({
      get: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined)
    })),
    onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() }))
  },
  ConfigurationTarget: { Workspace: 2 },
  Uri: { parse: (s: string) => ({ authority: s.split("/")[2] || "", path: s, scheme: "adt", toString: () => s }) },
  debug: { activeDebugSession: undefined }
}), { virtual: true })

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
    showWarningMessage: jest.fn()
  }
}))
jest.mock("./toolRegistry", () => ({ registerToolWithRegistry: jest.fn(() => ({ dispose: jest.fn() })) }))
jest.mock("../abapCopilotLogger", () => ({ logCommands: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }))

jest.mock("../subagentRegistry", () => ({
  AGENT_REGISTRY: [
    { id: "abap-discoverer", name: "Discoverer", tier: 1, tools: ["abap-search"], templateFile: "test.md", defaultModel: "", description: "Discovers ABAP objects" },
    { id: "abap-reader", name: "Reader", tier: 1, tools: ["abap-read"], templateFile: "test2.md", defaultModel: "", description: "Reads ABAP code" },
    { id: "abap-orchestrator", name: "Orchestrator", tier: 3, tools: null, templateFile: "test3.md", defaultModel: "", description: "Orchestrates tasks" }
  ],
  getSubagentSettings: jest.fn(() => ({ enabled: false, models: {} })),
  getWorkspaceFolder: jest.fn(),
  getAvailableModels: jest.fn(() => []),
  getExtensionId: jest.fn(() => "test.extension"),
  validateModelConfiguration: jest.fn(() => []),
  buildFullToolName: jest.fn((ext: string, tool: string) => `${ext}#${tool}`)
}))

jest.mock("../subagentFileOps", () => ({
  enableSubagentsCore: jest.fn(),
  disableSubagentsCore: jest.fn(),
  disableAgentFiles: jest.fn(),
  writeAgentFile: jest.fn().mockResolvedValue({ created: true, updated: false }),
  refreshExplorer: jest.fn()
}))

// Must import after mocks
import * as vscode from "vscode"
import {
  AGENT_REGISTRY,
  getSubagentSettings,
  getWorkspaceFolder,
  getAvailableModels,
  getExtensionId,
  validateModelConfiguration,
  buildFullToolName
} from "../subagentRegistry"
import {
  enableSubagentsCore,
  disableSubagentsCore,
  writeAgentFile
} from "../subagentFileOps"
import { logTelemetry } from "../telemetry"

// We need to import the class - it's not exported directly, only via registration function
// But the class is the default export of the module. Let's check the actual export.
// The SubagentConfigTool class is not exported directly. We use the registration function.
// Actually, looking at the source, the class is local to the module. We need a different approach.
// Let's import the registration function and test through it, or use a workaround.

// The class is NOT exported. We need to either:
// 1. Access it through the registration mock
// 2. Or import the module and capture what's passed to registerToolWithRegistry

import { registerSubagentConfigTool } from "./subagentConfigTool"
import { registerToolWithRegistry } from "./toolRegistry"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

describe("SubagentConfigTool", () => {
  let tool: any // The actual tool instance captured from registration
  let mockContext: any

  beforeEach(() => {
    jest.clearAllMocks()

    mockContext = {
      subscriptions: { push: jest.fn() },
      extensionUri: { fsPath: "/test" }
    }

    // Register and capture the tool instance
    registerSubagentConfigTool(mockContext)
    const registerCall = (registerToolWithRegistry as jest.Mock).mock.calls[0]
    expect(registerCall[0]).toBe("manage_subagents")
    tool = registerCall[1]
  })

  describe("registration", () => {
    it("registers with correct tool name", () => {
      expect(registerToolWithRegistry).toHaveBeenCalledWith("manage_subagents", expect.anything())
    })

    it("subscribes to config and model change events", () => {
      // subscriptions.push is called for: tool registration, onDidChangeChatModels, onDidChangeConfiguration
      expect(mockContext.subscriptions.push).toHaveBeenCalledTimes(3)
    })
  })

  describe("invoke - get_status", () => {
    it("returns current status with enabled false", async () => {
      ;(getSubagentSettings as jest.Mock).mockReturnValue({ enabled: false, models: {} })
      ;(getWorkspaceFolder as jest.Mock).mockReturnValue({ fsPath: "C:\\workspace" })
      ;(validateModelConfiguration as jest.Mock).mockResolvedValue([])

      const result: any = await tool.invoke(makeOptions({ action: "get_status" }), mockToken)
      expect(result.parts[0].text).toContain("Enabled: NO")
    })

    it("returns current status with enabled true", async () => {
      ;(getSubagentSettings as jest.Mock).mockReturnValue({
        enabled: true,
        models: {
          "abap-discoverer": "Claude Haiku 4.5",
          "abap-reader": "GPT-4o",
          "abap-orchestrator": "Claude Sonnet 4"
        }
      })
      ;(getWorkspaceFolder as jest.Mock).mockReturnValue({ fsPath: "C:\\workspace" })
      ;(validateModelConfiguration as jest.Mock).mockResolvedValue([
        { agentId: "abap-discoverer", configuredModel: "Claude Haiku 4.5", available: true },
        { agentId: "abap-reader", configuredModel: "GPT-4o", available: true },
        { agentId: "abap-orchestrator", configuredModel: "Claude Sonnet 4", available: true }
      ])

      const result: any = await tool.invoke(makeOptions({ action: "get_status" }), mockToken)
      expect(result.parts[0].text).toContain("Enabled: YES")
    })

    it("shows unconfigured agents warning", async () => {
      ;(getSubagentSettings as jest.Mock).mockReturnValue({ enabled: false, models: {} })
      ;(getWorkspaceFolder as jest.Mock).mockReturnValue(undefined)
      ;(validateModelConfiguration as jest.Mock).mockResolvedValue([])

      const result: any = await tool.invoke(makeOptions({ action: "get_status" }), mockToken)
      // 3 agents in mock registry, none configured
      expect(result.parts[0].text).toContain("3 agent(s) need model configuration")
    })

    it("shows unavailable model warnings", async () => {
      ;(getSubagentSettings as jest.Mock).mockReturnValue({
        enabled: true,
        models: { "abap-discoverer": "NonExistentModel" }
      })
      ;(getWorkspaceFolder as jest.Mock).mockReturnValue({ fsPath: "C:\\test" })
      ;(validateModelConfiguration as jest.Mock).mockResolvedValue([
        { agentId: "abap-discoverer", configuredModel: "NonExistentModel", available: false }
      ])

      const result: any = await tool.invoke(makeOptions({ action: "get_status" }), mockToken)
      expect(result.parts[0].text).toContain("NOT AVAILABLE")
    })
  })

  describe("invoke - list_models", () => {
    it("returns available models grouped by vendor", async () => {
      ;(getAvailableModels as jest.Mock).mockResolvedValue([
        { name: "Claude Sonnet 4", vendor: "Anthropic", family: "claude-sonnet" },
        { name: "GPT-4o", vendor: "OpenAI", family: "gpt-4o" }
      ])

      const result: any = await tool.invoke(makeOptions({ action: "list_models" }), mockToken)
      expect(result.parts[0].text).toContain("Anthropic")
      expect(result.parts[0].text).toContain("Claude Sonnet 4")
      expect(result.parts[0].text).toContain("OpenAI")
      expect(result.parts[0].text).toContain("GPT-4o")
    })

    it("returns message when no models available", async () => {
      ;(getAvailableModels as jest.Mock).mockResolvedValue([])

      const result: any = await tool.invoke(makeOptions({ action: "list_models" }), mockToken)
      expect(result.parts[0].text).toContain("No language models available")
    })
  })

  describe("invoke - list_agents", () => {
    it("returns all agents from registry", async () => {
      ;(getSubagentSettings as jest.Mock).mockReturnValue({ enabled: false, models: {} })

      const result: any = await tool.invoke(makeOptions({ action: "list_agents" }), mockToken)
      expect(result.parts[0].text).toContain("abap-discoverer")
      expect(result.parts[0].text).toContain("abap-reader")
      expect(result.parts[0].text).toContain("abap-orchestrator")
    })

    it("shows configured models next to agents", async () => {
      ;(getSubagentSettings as jest.Mock).mockReturnValue({
        enabled: false,
        models: { "abap-discoverer": "Claude Haiku 4.5" }
      })

      const result: any = await tool.invoke(makeOptions({ action: "list_agents" }), mockToken)
      expect(result.parts[0].text).toContain("Claude Haiku 4.5")
    })

    it("shows NOT CONFIGURED for agents without models", async () => {
      ;(getSubagentSettings as jest.Mock).mockReturnValue({ enabled: false, models: {} })

      const result: any = await tool.invoke(makeOptions({ action: "list_agents" }), mockToken)
      expect(result.parts[0].text).toContain("NOT CONFIGURED")
    })

    it("groups agents by tier", async () => {
      ;(getSubagentSettings as jest.Mock).mockReturnValue({ enabled: false, models: {} })

      const result: any = await tool.invoke(makeOptions({ action: "list_agents" }), mockToken)
      expect(result.parts[0].text).toContain("Tier 3")
      expect(result.parts[0].text).toContain("Tier 1")
    })
  })

  describe("invoke - list_tools", () => {
    it("returns tool assignments for agents", async () => {
      ;(getExtensionId as jest.Mock).mockReturnValue("test.ext")

      const result: any = await tool.invoke(makeOptions({ action: "list_tools" }), mockToken)
      expect(result.parts[0].text).toContain("abap-discoverer")
      expect(result.parts[0].text).toContain("abap-search")
    })

    it("shows agents with no tool restriction", async () => {
      const result: any = await tool.invoke(makeOptions({ action: "list_tools" }), mockToken)
      // abap-orchestrator has tools: null
      expect(result.parts[0].text).toContain("all tools")
    })
  })

  describe("invoke - enable", () => {
    it("calls enableSubagentsCore and returns success", async () => {
      ;(enableSubagentsCore as jest.Mock).mockResolvedValue({
        success: true,
        fileStatus: "3 files created"
      })

      const result: any = await tool.invoke(makeOptions({ action: "enable" }), mockToken)
      expect(enableSubagentsCore).toHaveBeenCalledWith(mockContext)
      expect(result.parts[0].text).toContain("ENABLED")
    })

    it("returns error when no workspace", async () => {
      ;(enableSubagentsCore as jest.Mock).mockResolvedValue({
        success: false,
        error: "no_workspace"
      })

      const result: any = await tool.invoke(makeOptions({ action: "enable" }), mockToken)
      expect(result.parts[0].text).toContain("No workspace folder")
    })

    it("returns error when models are missing", async () => {
      ;(enableSubagentsCore as jest.Mock).mockResolvedValue({
        success: false,
        error: "missing_models",
        missingModels: ["abap-discoverer", "abap-reader"]
      })

      const result: any = await tool.invoke(makeOptions({ action: "enable" }), mockToken)
      expect(result.parts[0].text).toContain("CANNOT ENABLE")
      expect(result.parts[0].text).toContain("abap-discoverer")
      expect(result.parts[0].text).toContain("abap-reader")
    })

    it("returns error when validation fails", async () => {
      ;(enableSubagentsCore as jest.Mock).mockResolvedValue({
        success: false,
        error: "validation_failed",
        fileErrors: [
          { agentId: "abap-discoverer", errors: ["Invalid model name"] }
        ]
      })

      const result: any = await tool.invoke(makeOptions({ action: "enable" }), mockToken)
      expect(result.parts[0].text).toContain("AUTO-DISABLED")
      expect(result.parts[0].text).toContain("Invalid model name")
    })
  })

  describe("invoke - disable", () => {
    it("calls disableSubagentsCore and returns success", async () => {
      ;(disableSubagentsCore as jest.Mock).mockResolvedValue({ preserved: true })

      const result: any = await tool.invoke(makeOptions({ action: "disable" }), mockToken)
      expect(disableSubagentsCore).toHaveBeenCalled()
      expect(result.parts[0].text).toContain("DISABLED")
    })

    it("mentions preservation when files exist", async () => {
      ;(disableSubagentsCore as jest.Mock).mockResolvedValue({ preserved: true })

      const result: any = await tool.invoke(makeOptions({ action: "disable" }), mockToken)
      expect(result.parts[0].text).toContain("preserved")
    })

    it("handles case when no files to preserve", async () => {
      ;(disableSubagentsCore as jest.Mock).mockResolvedValue({ preserved: false })

      const result: any = await tool.invoke(makeOptions({ action: "disable" }), mockToken)
      expect(result.parts[0].text).toContain("No agent files to preserve")
    })
  })

  describe("invoke - configure", () => {
    it("returns help when no configurations provided", async () => {
      const result: any = await tool.invoke(
        makeOptions({ action: "configure", configurations: [] }),
        mockToken
      )
      expect(result.parts[0].text).toContain("No configurations provided")
    })

    it("returns help when configurations is undefined", async () => {
      const result: any = await tool.invoke(
        makeOptions({ action: "configure" }),
        mockToken
      )
      expect(result.parts[0].text).toContain("No configurations provided")
    })

    it("applies valid configurations", async () => {
      ;(getSubagentSettings as jest.Mock).mockReturnValue({ enabled: false, models: {} })
      ;(getAvailableModels as jest.Mock).mockResolvedValue([
        { name: "Claude Haiku 4.5", vendor: "Anthropic", family: "claude-haiku" }
      ])
      ;(getWorkspaceFolder as jest.Mock).mockReturnValue(undefined)

      const result: any = await tool.invoke(
        makeOptions({
          action: "configure",
          configurations: [{ agentId: "abap-discoverer", model: "Claude Haiku 4.5" }]
        }),
        mockToken
      )
      expect(result.parts[0].text).toContain("abap-discoverer")
      expect(result.parts[0].text).toContain("Claude Haiku 4.5")
      expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith("abapfs.subagents")
    })

    it("warns about unknown agentId", async () => {
      ;(getSubagentSettings as jest.Mock).mockReturnValue({ enabled: false, models: {} })
      ;(getAvailableModels as jest.Mock).mockResolvedValue([
        { name: "GPT-4o", vendor: "OpenAI", family: "gpt-4o" }
      ])

      const result: any = await tool.invoke(
        makeOptions({
          action: "configure",
          configurations: [{ agentId: "nonexistent-agent", model: "GPT-4o" }]
        }),
        mockToken
      )
      expect(result.parts[0].text).toContain("Unknown agent")
    })

    it("warns about unavailable model but still sets it", async () => {
      ;(getSubagentSettings as jest.Mock).mockReturnValue({ enabled: false, models: {} })
      ;(getAvailableModels as jest.Mock).mockResolvedValue([])

      const result: any = await tool.invoke(
        makeOptions({
          action: "configure",
          configurations: [{ agentId: "abap-discoverer", model: "NonExistentModel" }]
        }),
        mockToken
      )
      expect(result.parts[0].text).toContain("not available")
      expect(result.parts[0].text).toContain("setting anyway")
    })

    it("updates agent files when subagents are enabled", async () => {
      ;(getSubagentSettings as jest.Mock).mockReturnValue({
        enabled: true,
        models: { "abap-discoverer": "Old Model" }
      })
      ;(getAvailableModels as jest.Mock).mockResolvedValue([
        { name: "Claude Haiku 4.5", vendor: "Anthropic", family: "claude-haiku" }
      ])
      ;(getWorkspaceFolder as jest.Mock).mockReturnValue({ fsPath: "C:\\workspace" })

      await tool.invoke(
        makeOptions({
          action: "configure",
          configurations: [{ agentId: "abap-discoverer", model: "Claude Haiku 4.5" }]
        }),
        mockToken
      )
      expect(writeAgentFile).toHaveBeenCalled()
    })

    it("does not update agent files when subagents are disabled", async () => {
      ;(getSubagentSettings as jest.Mock).mockReturnValue({ enabled: false, models: {} })
      ;(getAvailableModels as jest.Mock).mockResolvedValue([
        { name: "GPT-4o", vendor: "OpenAI", family: "gpt-4o" }
      ])

      await tool.invoke(
        makeOptions({
          action: "configure",
          configurations: [{ agentId: "abap-discoverer", model: "GPT-4o" }]
        }),
        mockToken
      )
      expect(writeAgentFile).not.toHaveBeenCalled()
    })
  })

  describe("invoke - validate", () => {
    it("reports all configured and valid", async () => {
      ;(validateModelConfiguration as jest.Mock).mockResolvedValue([
        { agentId: "abap-discoverer", configuredModel: "Claude Haiku 4.5", available: true },
        { agentId: "abap-reader", configuredModel: "GPT-4o", available: true },
        { agentId: "abap-orchestrator", configuredModel: "Claude Sonnet 4", available: true }
      ])
      ;(getSubagentSettings as jest.Mock).mockReturnValue({ enabled: true, models: {} })

      const result: any = await tool.invoke(makeOptions({ action: "validate" }), mockToken)
      expect(result.parts[0].text).toContain("3 agents are configured")
    })

    it("reports unconfigured agents", async () => {
      ;(validateModelConfiguration as jest.Mock).mockResolvedValue([
        { agentId: "abap-discoverer", configuredModel: null, available: false },
        { agentId: "abap-reader", configuredModel: "GPT-4o", available: true },
        { agentId: "abap-orchestrator", configuredModel: null, available: false }
      ])

      const result: any = await tool.invoke(makeOptions({ action: "validate" }), mockToken)
      expect(result.parts[0].text).toContain("INCOMPLETE")
      expect(result.parts[0].text).toContain("abap-discoverer")
      expect(result.parts[0].text).toContain("abap-orchestrator")
    })

    it("reports unavailable models", async () => {
      ;(validateModelConfiguration as jest.Mock).mockResolvedValue([
        { agentId: "abap-discoverer", configuredModel: "BadModel", available: false },
        { agentId: "abap-reader", configuredModel: "GPT-4o", available: true },
        { agentId: "abap-orchestrator", configuredModel: "Claude Sonnet 4", available: true }
      ])
      ;(getSubagentSettings as jest.Mock).mockReturnValue({ enabled: true, models: {} })

      const result: any = await tool.invoke(makeOptions({ action: "validate" }), mockToken)
      expect(result.parts[0].text).toContain("AVAILABILITY ISSUES")
      expect(result.parts[0].text).toContain("BadModel")
    })
  })

  describe("invoke - regenerate", () => {
    it("returns error when subagents not enabled", async () => {
      ;(getSubagentSettings as jest.Mock).mockReturnValue({ enabled: false, models: {} })

      const result: any = await tool.invoke(makeOptions({ action: "regenerate" }), mockToken)
      expect(result.parts[0].text).toContain("not enabled")
    })

    it("returns error when no workspace folder", async () => {
      ;(getSubagentSettings as jest.Mock).mockReturnValue({ enabled: true, models: {} })
      ;(getWorkspaceFolder as jest.Mock).mockReturnValue(undefined)

      const result: any = await tool.invoke(makeOptions({ action: "regenerate" }), mockToken)
      expect(result.parts[0].text).toContain("No workspace folder")
    })

    it("regenerates all agent files", async () => {
      ;(getSubagentSettings as jest.Mock).mockReturnValue({
        enabled: true,
        models: { "abap-discoverer": "Claude Haiku 4.5" }
      })
      ;(getWorkspaceFolder as jest.Mock).mockReturnValue({ fsPath: "C:\\workspace" })
      ;(getExtensionId as jest.Mock).mockReturnValue("test.ext")
      ;(writeAgentFile as jest.Mock).mockResolvedValue({ created: true, updated: false })

      const result: any = await tool.invoke(makeOptions({ action: "regenerate" }), mockToken)
      expect(writeAgentFile).toHaveBeenCalledTimes(3) // 3 agents in mock registry
      expect(result.parts[0].text).toContain("REGENERATED")
    })

    it("reports individual file failures", async () => {
      ;(getSubagentSettings as jest.Mock).mockReturnValue({
        enabled: true,
        models: { "abap-discoverer": "Claude Haiku 4.5" }
      })
      ;(getWorkspaceFolder as jest.Mock).mockReturnValue({ fsPath: "C:\\workspace" })
      ;(getExtensionId as jest.Mock).mockReturnValue("test.ext")
      ;(writeAgentFile as jest.Mock)
        .mockResolvedValueOnce({ created: true, updated: false })
        .mockRejectedValueOnce(new Error("Write failed"))
        .mockResolvedValueOnce({ created: false, updated: true })

      const result: any = await tool.invoke(makeOptions({ action: "regenerate" }), mockToken)
      expect(result.parts[0].text).toContain("Created")
      expect(result.parts[0].text).toContain("Failed")
      expect(result.parts[0].text).toContain("Updated")
    })
  })

  describe("invoke - unknown action", () => {
    it("returns error for invalid action", async () => {
      const result: any = await tool.invoke(makeOptions({ action: "invalid_action" }), mockToken)
      expect(result.parts[0].text).toContain("Unknown action")
      expect(result.parts[0].text).toContain("invalid_action")
    })
  })

  describe("telemetry", () => {
    it("logs telemetry on invoke", async () => {
      ;(getSubagentSettings as jest.Mock).mockReturnValue({ enabled: false, models: {} })
      ;(getWorkspaceFolder as jest.Mock).mockReturnValue(undefined)
      ;(validateModelConfiguration as jest.Mock).mockResolvedValue([])

      await tool.invoke(makeOptions({ action: "get_status" }), mockToken)
      expect(logTelemetry).toHaveBeenCalledWith("tool_manage_subagents_called")
    })
  })
})
