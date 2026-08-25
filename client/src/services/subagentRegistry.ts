/**
 * Subagent Registry
 *
 * Contains agent metadata, types, and the registry of all available subagents.
 */

import * as vscode from "vscode"
import { isTestFolderValid } from "./testing/config"

// ============================================================================
// TYPES
// ============================================================================

/** Agent metadata (templates loaded from files) */
export interface AgentMeta {
  id: string
  name: string
  description: string
  tier: 1 | 2 | 3
  defaultModel: string
  tools: string[] | null // null means all tools (no restriction)
  templateFile: string // filename in subagent-templates folder
}

export type AgentSection = "general" | "testing"

/** Shared metadata consumed by the model UI, LM tool, and agent visibility state. */
export interface AgentDefinition {
  id: string
  section: AgentSection
  displayName: string
  description: string
  guidance: string
  fileName: string
  tier?: 1 | 2 | 3
  tools: string[] | null
}

export interface SubagentSettings {
  models: Record<string, string>
  enabledAgents: Record<string, boolean>
}

// ============================================================================
// AGENT REGISTRY
// ============================================================================

/**
 * Agent metadata registry - templates are in separate files
 * NOTE: defaultModel is empty - Copilot must specify model when calling the LM tool
 * Tool names use toolReferenceName from package.json (e.g., 'abap-search' not 'search_abap_objects')
 */
export const AGENT_REGISTRY: AgentMeta[] = [
  {
    id: "abap-orchestrator",
    name: "Orchestrator",
    description:
      "Master coordinator - routes tasks to specialized agents, writes all code. Only agent available for you to select in chat",
    tier: 3,
    defaultModel: "",
    tools: null,
    templateFile: "abap-orchestrator.agent.md"
  },
  {
    id: "abap-code-reviewer",
    name: "Code Reviewer",
    description: "Deep expert code review - security, performance, best practices",
    tier: 3,
    defaultModel: "",
    tools: null,
    templateFile: "abap-code-reviewer.agent.md"
  },
  {
    id: "abap-discoverer",
    name: "Discoverer",
    description: "Find ABAP objects by name pattern, identify types",
    tier: 1,
    defaultModel: "",
    tools: ["abap-search", "abap-info", "connected-systems"],
    templateFile: "abap-discoverer.agent.md"
  },
  {
    id: "abap-reader",
    name: "Reader",
    description: "Read ABAP source code and extract specific information",
    tier: 1,
    defaultModel: "",
    tools: ["abap-lines", "abap-batch", "abap-uri", "abap-search-lines", "abap-info"],
    templateFile: "abap-reader.agent.md"
  },
  {
    id: "abap-usage-analyzer",
    name: "Usage Analyzer",
    description: "Where-used analysis, dependencies, change impact",
    tier: 2,
    defaultModel: "",
    tools: ["abap-where-used", "abap-relations", "abap-search", "abap-lines", "abap-info"],
    templateFile: "abap-usage-analyzer.agent.md"
  },
  {
    id: "abap-quality-checker",
    name: "Quality Checker",
    description: "ATC analysis, unit tests, code health checks",
    tier: 2,
    defaultModel: "",
    tools: [
      "atc-analysis",
      "atc-decorations",
      "abap-test",
      "abap_activate",
      "test-include",
      "abap-info"
    ],
    templateFile: "abap-quality-checker.agent.md"
  },
  {
    id: "abap-historian",
    name: "Historian",
    description: "Version history, transport requests, who changed what",
    tier: 2,
    defaultModel: "",
    tools: ["version-history", "transport-requests", "abap-info", "abap-lines"],
    templateFile: "abap-historian.agent.md"
  },
  {
    id: "abap-debugger",
    name: "Debugger",
    description: "Runtime debugging - breakpoints, stepping, variables",
    tier: 2,
    defaultModel: "",
    tools: [
      "debug-session",
      "debug-breakpoint",
      "debug-step",
      "debug-variable",
      "debug-stack",
      "debug-status",
      "abap-workspace-uri",
      "abap-lines"
    ],
    templateFile: "abap-debugger.agent.md"
  },
  {
    id: "abap-troubleshooter",
    name: "Troubleshooter",
    description: "Analyze dumps, traces, performance issues",
    tier: 2,
    defaultModel: "",
    tools: [
      "abap-dumps",
      "abap-traces",
      "abap-lines",
      "abap-info",
      "abap-search-lines",
      "abap_activate"
    ],
    templateFile: "abap-troubleshooter.agent.md"
  },
  {
    id: "abap-data-analyst",
    name: "Data Analyst",
    description: "Query SAP tables, analyze data patterns",
    tier: 2,
    defaultModel: "",
    tools: ["sap-data", "abap-sql-syntax", "connected-systems", "sap-system-info"],
    templateFile: "abap-data-analyst.agent.md"
  },
  {
    id: "abap-creator",
    name: "Creator",
    description: "Create new ABAP objects (blank shells)",
    tier: 1,
    defaultModel: "",
    tools: ["abap-create", "connected-systems", "abap-search", "abap_activate", "abap-test"],
    templateFile: "abap-creator.agent.md"
  },
  {
    id: "abap-visualizer",
    name: "Visualizer",
    description: "Create diagrams from code - class, sequence, flowcharts",
    tier: 1,
    defaultModel: "",
    tools: [
      "mermaid-create",
      "mermaid-validate",
      "mermaid-docs",
      "abap-lines",
      "abap-search-lines",
      "abap-where-used",
      "abap-info"
    ],
    templateFile: "abap-visualizer.agent.md"
  },
  {
    id: "abap-documenter",
    name: "Documenter",
    description: "Generate technical documentation for ABAP objects",
    tier: 1,
    defaultModel: "",
    tools: [
      "abap-lines",
      "abap-batch",
      "abap-search-lines",
      "abap-info",
      "abap-where-used",
      "test-docs"
    ],
    templateFile: "abap-documenter.agent.md"
  }
]

const TESTING_AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    id: "sap-code-grep",
    section: "testing",
    displayName: "Code Grep",
    description: "Exhaustively counts ABAP decision-surface statements in a local source snapshot.",
    guidance:
      "Mechanical local-source counting. Prefer the smallest fast model that reliably follows strict output formats.",
    fileName: "sap-code-grep.agent.md",
    tools: null
  },
  {
    id: "sap-source-download",
    section: "testing",
    displayName: "Source Download",
    description: "Downloads and verifies a complete local ABAP source snapshot.",
    guidance:
      "Tool-driven source discovery and download verification. Prefer a small, inexpensive model with dependable tool use.",
    fileName: "sap-source-download.agent.md",
    tools: null
  },
  {
    id: "anst-enhancement-analyser",
    section: "testing",
    displayName: "ANST Enhancement Analyser",
    description: "Classifies ANST results and researches enhancement behavior.",
    guidance:
      "Classifies ANST results and researches enhancement behavior. Prefer a capable small or mid-tier model with strong tool use.",
    fileName: "anst-enhancement-analyser.agent.md",
    tools: null
  },
  {
    id: "sap-enhancement-research",
    section: "testing",
    displayName: "Enhancement Research",
    description: "Finds and explains customer enhancements involved in a tested SAP flow.",
    guidance:
      "Recursive SAP enhancement research needs careful reasoning. Prefer a capable mid-tier model rather than the cheapest option.",
    fileName: "sap-enhancement-research.agent.md",
    tools: null
  },
  {
    id: "sap-findings-reviewer",
    section: "testing",
    displayName: "Findings Reviewer",
    description: "Adversarially reviews ABAP analysis findings against the downloaded source.",
    guidance:
      "Use a strong model from a different family than the main agent for an independent adversarial review.",
    fileName: "sap-findings-reviewer.agent.md",
    tools: null
  },
  {
    id: "sap-screens-reviewer",
    section: "testing",
    displayName: "Screens Reviewer",
    description: "Reviews the live WebGUI control map for accuracy and completeness.",
    guidance:
      "A capable mid-tier model with careful reading is sufficient; prefer a different family than the main agent.",
    fileName: "sap-screens-reviewer.agent.md",
    tools: null
  },
  {
    id: "sap-test-plan-reviewer",
    section: "testing",
    displayName: "Test Plan Reviewer",
    description: "Adversarially reviews the generated SAP test-case plan against source behavior.",
    guidance:
      "Use a strong model from a different family than the main agent for an independent adversarial review.",
    fileName: "sap-test-plan-reviewer.agent.md",
    tools: null
  },
  {
    id: "sap-data-scout",
    section: "testing",
    displayName: "Data Scout",
    description: "Finds valid read-only SAP data for test prerequisites.",
    guidance:
      "Focused read-only SAP data discovery. Prefer a small, fast model with reliable SQL and tool use.",
    fileName: "sap-data-scout.agent.md",
    tools: null
  },
  {
    id: "sap-task-helper",
    section: "testing",
    displayName: "Task Helper",
    description: "Handles bounded, high-volume SAP testing support tasks.",
    guidance:
      "Handles varied bounded work. Prefer a balanced general-purpose model; raise capability only when delegated tasks require it.",
    fileName: "sap-task-helper.agent.md",
    tools: null
  }
]

export const GENERAL_AGENT_REGISTRY: AgentDefinition[] = AGENT_REGISTRY.map(agent => ({
  id: agent.id,
  section: "general",
  displayName: agent.name,
  description: agent.description,
  guidance: agent.description,
  fileName: agent.templateFile,
  tier: agent.tier,
  tools: agent.tools
}))

export const TESTING_AGENT_REGISTRY: AgentDefinition[] = TESTING_AGENT_DEFINITIONS
export const ALL_AGENT_REGISTRY: AgentDefinition[] = [
  ...GENERAL_AGENT_REGISTRY,
  ...TESTING_AGENT_REGISTRY
]

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Read the unified model and per-general-agent settings.
 */
export function getSubagentSettings(): SubagentSettings {
  const config = vscode.workspace.getConfiguration("abapfs.subagents")
  const testingConfig = vscode.workspace.getConfiguration("abapfs.testing")
  const models = {
    ...testingConfig.get<Record<string, string>>("subagentModels", {}),
    ...config.get<Record<string, string>>("models", {})
  }
  return {
    models,
    enabledAgents: config.get<Record<string, boolean>>("enabledAgents", {})
  }
}

export function generalAgentContextKey(agentId: string): `abapfs:generalAgent.${string}.enabled` {
  return `abapfs:generalAgent.${agentId}.enabled`
}

export async function ensureCustomAgentDelegationEnabled(): Promise<boolean> {
  const chatConfig = vscode.workspace.getConfiguration("chat")
  if (chatConfig.get<boolean>("customAgentInSubagent.enabled", false)) return false

  await chatConfig.update("customAgentInSubagent.enabled", true, vscode.ConfigurationTarget.Global)
  return true
}

export async function getTestingAgentReadiness(): Promise<{
  ready: boolean
  missing: string[]
  unavailable: string[]
}> {
  const settings = getSubagentSettings()
  const testingFolderValid = await isTestFolderValid()
  const availableModels = await getAvailableModels()
  const availableNames = new Set(availableModels.map(model => model.name))
  const missing: string[] = []
  const unavailable: string[] = []

  for (const agent of TESTING_AGENT_REGISTRY) {
    const model = settings.models[agent.id]?.trim()
    if (!model) missing.push(agent.id)
    else if (!availableNames.has(model)) unavailable.push(`${agent.id} (${model})`)
  }

  return {
    ready: testingFolderValid && missing.length === 0 && unavailable.length === 0,
    missing,
    unavailable
  }
}

export async function syncTestingAgentContext(): Promise<void> {
  const readiness = await getTestingAgentReadiness()
  await vscode.commands.executeCommand("setContext", "abapfs:testingAgentsReady", readiness.ready)
}

export async function migrateSubagentSettings(): Promise<void> {
  try {
    const config = vscode.workspace.getConfiguration("abapfs.subagents")
    const hasWorkspace = (vscode.workspace.workspaceFolders?.length || 0) > 0
    const enabledInspection = config.inspect<Record<string, boolean>>("enabledAgents")
    const userEnabledAgents = enabledInspection?.globalValue || {}
    const workspaceEnabledAgents = {
      ...(enabledInspection?.workspaceValue || {}),
      ...(enabledInspection?.workspaceFolderValue || {})
    }
    const legacyInspection = config.inspect<boolean>("enabled")
    const legacyEnabled =
      legacyInspection?.globalValue ??
      legacyInspection?.workspaceFolderValue ??
      legacyInspection?.workspaceValue ??
      false
    const migratedEnabledAgents = {
      ...workspaceEnabledAgents,
      ...(Object.keys(userEnabledAgents).length === 0 && legacyEnabled
        ? Object.fromEntries(GENERAL_AGENT_REGISTRY.map(agent => [agent.id, true]))
        : {}),
      ...userEnabledAgents
    }
    const enabledChanged =
      Object.keys(migratedEnabledAgents).length > 0 &&
      JSON.stringify(migratedEnabledAgents) !== JSON.stringify(userEnabledAgents)
    if (enabledChanged) {
      await config.update("enabledAgents", migratedEnabledAgents, vscode.ConfigurationTarget.Global)
    }
    if (hasWorkspace && enabledInspection?.workspaceValue !== undefined) {
      await config.update("enabledAgents", undefined, vscode.ConfigurationTarget.Workspace)
    }
    if (hasWorkspace && enabledInspection?.workspaceFolderValue !== undefined) {
      await config.update("enabledAgents", undefined, vscode.ConfigurationTarget.WorkspaceFolder)
    }

    const legacyTestingModels = vscode.workspace
      .getConfiguration("abapfs.testing")
      .get<Record<string, string>>("subagentModels", {})
    const modelInspection = config.inspect<Record<string, string>>("models")
    const userModels = modelInspection?.globalValue || {}
    const workspaceModels = {
      ...(modelInspection?.workspaceValue || {}),
      ...(modelInspection?.workspaceFolderValue || {})
    }
    const migratedModels = { ...workspaceModels, ...legacyTestingModels, ...userModels }
    if (JSON.stringify(migratedModels) !== JSON.stringify(userModels)) {
      await config.update("models", migratedModels, vscode.ConfigurationTarget.Global)
    }
    if (hasWorkspace && modelInspection?.workspaceValue !== undefined) {
      await config.update("models", undefined, vscode.ConfigurationTarget.Workspace)
    }
    if (hasWorkspace && modelInspection?.workspaceFolderValue !== undefined) {
      await config.update("models", undefined, vscode.ConfigurationTarget.WorkspaceFolder)
    }

    if (hasWorkspace && legacyInspection?.workspaceValue !== undefined) {
      await config.update("enabled", undefined, vscode.ConfigurationTarget.Workspace)
    }
    if (hasWorkspace && legacyInspection?.workspaceFolderValue !== undefined) {
      await config.update("enabled", undefined, vscode.ConfigurationTarget.WorkspaceFolder)
    }
  } catch (error) {
    vscode.window.showWarningMessage(
      `ABAP FS could not migrate subagent settings. Existing settings were left unchanged. ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export async function syncGeneralAgentContexts(): Promise<void> {
  const settings = getSubagentSettings()
  await Promise.all(
    GENERAL_AGENT_REGISTRY.map(agent =>
      vscode.commands.executeCommand(
        "setContext",
        generalAgentContextKey(agent.id),
        settings.enabledAgents[agent.id] === true
      )
    )
  )
}

/**
 * Get the workspace folder for agent files (first non-ADT folder)
 */
export function getWorkspaceFolder(): vscode.Uri | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return undefined
  }
  // Find first non-ADT workspace folder
  for (const folder of workspaceFolders) {
    if (!folder.uri.scheme.startsWith("adt")) {
      return folder.uri
    }
  }
  return workspaceFolders[0].uri
}

/**
 * Get available language models from VS Code
 */
export async function getAvailableModels(): Promise<
  Array<{ id: string; name: string; vendor: string; family: string }>
> {
  try {
    const models = await vscode.lm.selectChatModels({})
    return models.map(m => ({
      id: m.id,
      name: m.name,
      vendor: m.vendor,
      family: m.family
    }))
  } catch {
    return []
  }
}

/**
 * Get current extension ID dynamically
 */
export function getExtensionId(context: vscode.ExtensionContext): string {
  return context.extension.id
}

/**
 * Build full tool name with extension prefix
 */
export function buildFullToolName(extensionId: string, toolName: string): string {
  return `${extensionId}/${toolName}`
}

/**
 * Validate that configured models are still available
 */
export async function validateModelConfiguration(): Promise<
  Array<{ agentId: string; configuredModel: string; available: boolean }>
> {
  const settings = getSubagentSettings()
  const availableModels = await getAvailableModels()
  const availableNames = new Set(availableModels.map(m => m.name))

  const results: Array<{ agentId: string; configuredModel: string; available: boolean }> = []

  for (const agent of AGENT_REGISTRY) {
    const configuredModel = settings.models[agent.id]
    if (!configuredModel) {
      results.push({
        agentId: agent.id,
        configuredModel: "",
        available: false
      })
    } else {
      results.push({
        agentId: agent.id,
        configuredModel,
        available: availableNames.has(configuredModel)
      })
    }
  }

  return results
}
