jest.mock(
  "vscode",
  () => ({
    LanguageModelToolResult: jest.fn().mockImplementation((parts: any[]) => ({ parts })),
    LanguageModelTextPart: jest.fn().mockImplementation((text: string) => ({ text })),
    MarkdownString: jest.fn().mockImplementation((value: string) => ({ value })),
    workspace: {
      getConfiguration: jest.fn(() => ({
        get: jest.fn((key: string, fallback: unknown) =>
          key === "models"
            ? { "abap-reader": "Model A" }
            : key === "enabledAgents"
              ? { "abap-reader": false }
              : fallback
        ),
        inspect: jest.fn(() => ({ workspaceFolderValue: false })),
        update: jest.fn().mockResolvedValue(undefined)
      })),
      onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() }))
    },
    commands: { executeCommand: jest.fn().mockResolvedValue(undefined) },
    lm: { onDidChangeChatModels: jest.fn(() => ({ dispose: jest.fn() })) },
    ConfigurationTarget: { Workspace: 2, Global: 1 }
  }),
  { virtual: true }
)

jest.mock("./toolRegistry", () => ({
  registerToolWithRegistry: jest.fn((name: string, tool: unknown) => ({
    name,
    tool,
    dispose: jest.fn()
  }))
}))
jest.mock("./toolGuard", () => ({ assertToolInvocationAuthorized: jest.fn() }))
jest.mock("../telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("../funMessenger", () => ({
  funWindow: { showWarningMessage: jest.fn(), showInformationMessage: jest.fn() }
}))
jest.mock("../testing/config", () => ({ isTestFolderValid: jest.fn().mockResolvedValue(false) }))
jest.mock("../testing/subagents/modelConfiguration", () => ({
  discoverLanguageModels: jest.fn().mockResolvedValue({
    models: [{ id: "1", name: "Model A", vendor: "copilot", family: "test", version: "" }]
  }),
  effectiveSubagentModels: jest.fn().mockResolvedValue({ "abap-reader": "Model A" }),
  saveSubagentModels: jest.fn().mockResolvedValue({ changedFiles: [] })
}))
jest.mock("../testing/subagents/modelConfigurationCore", () => ({
  validateModelSelections: jest.fn(
    (selections: Record<string, string>, _models: unknown[], ids: string[]) => ({
      missingAgentIds: ids.filter(id => !selections[id]),
      unavailable: []
    })
  )
}))
jest.mock("../subagentRegistry", () => ({
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
  getSubagentSettings: jest.fn(() => ({
    models: { "abap-reader": "Model A" },
    enabledAgents: { "abap-reader": false }
  })),
  getTestingAgentReadiness: jest.fn().mockResolvedValue({
    ready: false,
    missing: ["sap-code-grep"],
    unavailable: []
  }),
  ensureCustomAgentDelegationEnabled: jest.fn().mockResolvedValue(false),
  migrateSubagentSettings: jest.fn().mockResolvedValue(undefined),
  syncGeneralAgentContexts: jest.fn().mockResolvedValue(undefined)
}))

import * as vscode from "vscode"
import { registerSubagentConfigTool } from "./subagentConfigTool"
import { registerToolWithRegistry } from "./toolRegistry"
import { syncGeneralAgentContexts } from "../subagentRegistry"

function getTool(): any {
  const registration = (registerToolWithRegistry as jest.Mock).mock.results[0].value
  return registration.tool
}

const context = { subscriptions: [], extensionPath: "C:/extension" } as any
const token = {} as any

beforeEach(() => {
  jest.clearAllMocks()
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
