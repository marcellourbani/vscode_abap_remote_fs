/**
 * Subagent Registry
 *
 * Contains agent metadata, types, and the registry of all available subagents.
 */

import * as vscode from "vscode"

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

export interface EnableResult {
  success: boolean
  error?: "no_workspace" | "missing_models" | "validation_failed"
  missingModels?: string[]
  fileErrors?: Array<{ agentId: string; errors: string[] }>
  fileStatus?: string
}

export interface DisableResult {
  success: boolean
  preserved: boolean
}

export interface SubagentSettings {
  enabled: boolean
  models: Record<string, string>
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
    description: "Master coordinator - routes tasks to specialized agents, writes all code",
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
    tools: ["abap-where-used", "abap-search", "abap-lines", "abap-info"],
    templateFile: "abap-usage-analyzer.agent.md"
  },
  {
    id: "abap-quality-checker",
    name: "Quality Checker",
    description: "ATC analysis, unit tests, code health checks",
    tier: 2,
    defaultModel: "",
    tools: ["atc-analysis", "atc-decorations", "abap-test", "test-include", "abap-info"],
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
    tools: ["abap-dumps", "abap-traces", "abap-lines", "abap-info", "abap-search-lines"],
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
    tools: ["abap-create", "connected-systems", "abap-search"],
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

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get subagent settings from workspace configuration
 */
export function getSubagentSettings(): SubagentSettings {
  const config = vscode.workspace.getConfiguration("abapfs.subagents")
  return {
    enabled: config.get("enabled", false),
    models: config.get("models", {})
  }
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
