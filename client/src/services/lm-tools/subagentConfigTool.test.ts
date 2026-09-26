vi.mock("vscode", () => ({
  LanguageModelToolResult: vi.fn().mockImplementation(function (parts: any[]) {
    return { parts }
  }),
  LanguageModelTextPart: vi.fn().mockImplementation(function (text: string) {
    return { text }
  }),
  MarkdownString: vi.fn().mockImplementation(function (value: string) {
    return { value }
  }),
  workspace: {
    getConfiguration: vi.fn(function () {
      return {
        get: vi.fn((key: string, fallback: unknown) =>
          key === "models"
            ? { "abap-reader": "Model A" }
            : key === "enabledAgents"
              ? { "abap-reader": false }
              : fallback
        ),
        inspect: vi.fn(() => ({ workspaceFolderValue: false })),
        update: vi.fn().mockResolvedValue(undefined)
      }
    }),
    onDidChangeConfiguration: vi.fn(function () {
      return { dispose: vi.fn() }
    })
  },
  commands: { executeCommand: vi.fn().mockResolvedValue(undefined) },
  lm: {
    onDidChangeChatModels: vi.fn(function () {
      return { dispose: vi.fn() }
    })
  },
  ConfigurationTarget: { Workspace: 2, Global: 1 }
}))

vi.mock("./toolRegistry", () => ({
  registerToolWithRegistry: vi.fn(function (name: string, tool: unknown) {
    return {
      name,
      tool,
      dispose: vi.fn()
    }
  })
}))
vi.mock("./toolGuard", () => ({ assertToolInvocationAuthorized: vi.fn() }))
vi.mock("../telemetry", () => ({ logTelemetry: vi.fn() }))
vi.mock("../funMessenger", () => ({
  funWindow: { showWarningMessage: vi.fn(), showInformationMessage: vi.fn() }
}))
vi.mock("../testing/config", () => ({ isTestFolderValid: vi.fn().mockResolvedValue(false) }))
vi.mock("../testing/subagents/modelConfiguration", () => ({
  discoverLanguageModels: vi.fn().mockResolvedValue({
    models: [{ id: "1", name: "Model A", vendor: "copilot", family: "test", version: "" }]
  }),
  effectiveSubagentModels: vi.fn().mockResolvedValue({ "abap-reader": "Model A" }),
  saveSubagentModels: vi.fn().mockResolvedValue({ changedFiles: [] })
}))
vi.mock("../testing/subagents/modelConfigurationCore", () => ({
  validateModelSelections: vi.fn(function (
    selections: Record<string, string>,
    _models: unknown[],
    ids: string[]
  ) {
    return {
      missingAgentIds: ids.filter(id => !selections[id]),
      unavailable: []
    }
  })
}))
vi.mock("../subagentRegistry", () => ({
  GENERAL_AGENT_REGISTRY: [
    {
      id: "abap-reader",
      section: "general",
      displayName: "Reader",
      description: "Reads ABAP",
      guidance: "Read",
      fileName: "abap-reader.agent.md",
      tier: 1,
      tools: ["abap-lines"]
    }
  ],
  ALL_AGENT_REGISTRY: [
    {
      id: "abap-reader",
      section: "general",
      displayName: "Reader",
      description: "Reads ABAP",
      guidance: "Read",
      fileName: "abap-reader.agent.md",
      tier: 1,
      tools: ["abap-lines"]
    },
    {
      id: "sap-code-grep",
      section: "testing",
      displayName: "Code Grep",
      description: "Counts source",
      guidance: "Count",
      fileName: "sap-code-grep.agent.md",
      tools: null
    }
  ],
  getSubagentSettings: vi.fn(function () {
    return {
      models: { "abap-reader": "Model A" },
      enabledAgents: { "abap-reader": false }
    }
  }),
  getTestingAgentReadiness: vi.fn().mockResolvedValue({
    ready: false,
    missing: ["sap-code-grep"],
    unavailable: []
  }),
  migrateSubagentSettings: vi.fn().mockResolvedValue(undefined),
  syncGeneralAgentContexts: vi.fn().mockResolvedValue(undefined)
}))

import * as vscode from "vscode"
import { registerSubagentConfigTool } from "./subagentConfigTool"
import { registerToolWithRegistry } from "./toolRegistry"
import { syncGeneralAgentContexts } from "../subagentRegistry"
import type { Mock } from "vitest"

function getTool(): any {
  const registration = (registerToolWithRegistry as Mock).mock.results[0].value
  return registration.tool
}

const context = { subscriptions: [], extensionPath: "C:/extension" } as any
const token = {} as any

beforeEach(() => {
  vi.clearAllMocks()
  registerSubagentConfigTool(context)
})

describe("unified subagent manager", () => {
  it("prepares visible messages for read-only actions", () => {
    const result = getTool().prepareInvocation({ input: { action: "list_models" } }, token)
    expect(result.invocationMessage).toContain("available models")
    expect(result.confirmationMessages).toBeUndefined()
  })

  it("prepares a confirmation for settings changes", () => {
    const result = getTool().prepareInvocation(
      { input: { action: "enable", agentIds: ["abap-reader"] } },
      token
    )
    expect(result.invocationMessage).toContain("enable abap-reader")
    expect(result.confirmationMessages.title).toBe("Change ABAP FS subagents")
  })

  it("enables one general agent through its context state", async () => {
    const result = await getTool().invoke(
      { input: { action: "enable", agentIds: ["abap-reader"] } },
      token
    )
    expect(result.parts[0].text).toContain("Enabled 1")
    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith("abapfs.subagents")
    expect(syncGeneralAgentContexts).toHaveBeenCalled()
  })

  it("reports testing agents as unavailable without a test folder", async () => {
    const result = await getTool().invoke({ input: { action: "list_agents" } }, token)
    expect(result.parts[0].text).toContain("unavailable until testing folder is configured")
  })
})
