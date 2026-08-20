import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import {
  ALL_AGENT_REGISTRY,
  GENERAL_AGENT_REGISTRY,
  ensureCustomAgentDelegationEnabled as enableCustomAgentDelegation,
  getSubagentSettings,
  getTestingAgentReadiness,
  migrateSubagentSettings,
  syncGeneralAgentContexts
} from "../subagentRegistry"
import { isTestFolderValid } from "../testing/config"
import {
  discoverLanguageModels,
  effectiveSubagentModels,
  saveSubagentModels
} from "../testing/subagents/modelConfiguration"
import { validateModelSelections } from "../testing/subagents/modelConfigurationCore"
import { funWindow as window } from "../funMessenger"

interface SubagentConfigInput {
  action:
    | "enable"
    | "disable"
    | "get_status"
    | "list_models"
    | "list_agents"
    | "list_tools"
    | "configure"
    | "validate"
    | "regenerate"
  agentIds?: string[]
  configurations?: Array<{ agentId: string; model: string }>
}

function text(value: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(value)])
}

function generalModelGuidance(agent: (typeof GENERAL_AGENT_REGISTRY)[number]): string {
  if (agent.tier === 1) {
    return "Use a fast, low-cost model for focused discovery, reading, creation, visualization, or documentation."
  }
  if (agent.tier === 2) {
    return "Use a balanced reasoning model for analysis, quality checks, history, debugging, troubleshooting, or data work."
  }
  return "Use the strongest available model for orchestration or deep code review."
}

const MODEL_SELECTION_GUIDANCE = [
  "MODEL SELECTION GUIDANCE",
  "- Use the exact model name returned by list_models.",
  "- General Tier 1 agents: fast/low-cost models are normally sufficient.",
  "- General Tier 2 agents: choose a balanced reasoning model.",
  "- General Tier 3 agents: choose the strongest model for orchestration and deep review.",
  "- Testing mechanical agents (source download, code grep, data scout): fast models are normally sufficient.",
  "- Testing research/reviewer agents: use a stronger model; reviewers should preferably use a different model family from the main agent.",
  "- General agents can be configured selectively. Testing models are all-or-nothing when testing is ready: configure all 9 together.",
  "- Model changes and enable/disable changes take effect without a VS Code reload."
]

function requiredAgentIds(
  settings: ReturnType<typeof getSubagentSettings>,
  testingEnabled: boolean
): string[] {
  return ALL_AGENT_REGISTRY.filter(
    agent =>
      (agent.section === "general" && settings.enabledAgents[agent.id] === true) ||
      (agent.section === "testing" && testingEnabled)
  ).map(agent => agent.id)
}

async function availableModels() {
  const result = await discoverLanguageModels()
  return result
}

async function ensureCustomAgentDelegationEnabled(): Promise<void> {
  const settings = getSubagentSettings()
  const testingReady = await isTestFolderValid()
  const generalEnabled = GENERAL_AGENT_REGISTRY.some(
    agent => settings.enabledAgents[agent.id] === true
  )
  if (!generalEnabled && !testingReady) return

  if (await enableCustomAgentDelegation()) {
    window.showInformationMessage("Custom agent delegation enabled.")
  }
}

async function updateGeneralEnabled(
  agentIds: string[] | undefined,
  enabled: boolean
): Promise<string[]> {
  const requested = agentIds?.length ? agentIds : GENERAL_AGENT_REGISTRY.map(agent => agent.id)
  const unknown = requested.filter(id => !GENERAL_AGENT_REGISTRY.some(agent => agent.id === id))
  if (unknown.length) return unknown.map(id => `Unknown or non-general agent: ${id}`)

  const settings = getSubagentSettings()
  if (enabled) {
    const discovery = await availableModels()
    const required = requested
    const validation = validateModelSelections(settings.models, discovery.models, required)
    if (validation.missingAgentIds.length || validation.unavailable.length) {
      const missing = validation.missingAgentIds.join(", ")
      const unavailable = validation.unavailable
        .map(item => `${item.agentId} (${item.modelName})`)
        .join(", ")
      throw new Error(
        `Cannot enable agents. ${missing ? `Missing models: ${missing}. ` : ""}${unavailable ? `Unavailable models: ${unavailable}.` : ""}`
      )
    }
  }

  const enabledAgents = { ...settings.enabledAgents }
  for (const id of requested) enabledAgents[id] = enabled
  await vscode.workspace
    .getConfiguration("abapfs.subagents")
    .update("enabledAgents", enabledAgents, vscode.ConfigurationTarget.Global)
  await syncGeneralAgentContexts()
  return []
}

class SubagentConfigTool implements vscode.LanguageModelTool<SubagentConfigInput> {
  constructor(private readonly context: vscode.ExtensionContext) {}

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<SubagentConfigInput>,
    _token: vscode.CancellationToken
  ) {
    const { action, agentIds, configurations } = options.input
    const changing = action === "configure" || action === "enable" || action === "disable"
    const targets = agentIds?.length
      ? agentIds.join(", ")
      : action === "enable" || action === "disable"
        ? "all 13 general agents"
        : configurations?.length
          ? configurations.map(configuration => configuration.agentId).join(", ")
          : "the subagent registry"

    const invocationMessage =
      action === "get_status"
        ? "Checking subagent status and model guidance"
        : action === "list_models"
          ? "Listing available models and model-selection guidance"
          : action === "list_agents"
            ? "Listing unified general and testing agents"
            : action === "list_tools"
              ? "Listing tools available to subagents"
              : action === "validate"
                ? "Validating active subagent model assignments"
                : action === "regenerate"
                  ? "Checking packaged subagent prompts"
                  : `${action} ${targets}`

    if (!changing) return { invocationMessage }

    return {
      invocationMessage,
      confirmationMessages: {
        title: "Change ABAP FS subagents",
        message: new vscode.MarkdownString(
          `**Action:** ${action}\n\n**Targets:** ${targets}\n\n` +
            (action === "configure"
              ? "Model assignments are stored at user level and take effect without a reload."
              : "Agent visibility changes take effect immediately without a reload.")
        )
      }
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<SubagentConfigInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    logTelemetry("tool_manage_subagents_called")
    const input = options.input

    try {
      switch (input.action) {
        case "enable":
          return await this.enable(input.agentIds)
        case "disable":
          return await this.disable(input.agentIds)
        case "get_status":
          return await this.getStatus()
        case "list_models":
          return await this.listModels()
        case "list_agents":
          return await this.listAgents()
        case "list_tools":
          return this.listTools()
        case "configure":
          return await this.configureModels(input.configurations || [])
        case "validate":
          return await this.validateConfiguration()
        case "regenerate":
          return text(
            "Agent prompts are packaged with ABAP FS. Model assignments are applied without writing workspace files."
          )
        default:
          return text(`Unknown action: ${input.action}.`)
      }
    } catch (error) {
      return text(
        `Subagent operation failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  private async enable(agentIds?: string[]): Promise<vscode.LanguageModelToolResult> {
    const errors = await updateGeneralEnabled(agentIds, true)
    if (errors.length) return text(errors.join("\n"))
    await ensureCustomAgentDelegationEnabled()
    const enabled = agentIds?.length || GENERAL_AGENT_REGISTRY.length
    return text(
      `Enabled ${enabled} general ABAP agent(s). Testing agents are controlled by the SAP testing folder.`
    )
  }

  private async disable(agentIds?: string[]): Promise<vscode.LanguageModelToolResult> {
    const errors = await updateGeneralEnabled(agentIds, false)
    if (errors.length) return text(errors.join("\n"))
    const disabled = agentIds?.length || GENERAL_AGENT_REGISTRY.length
    return text(
      `Disabled ${disabled} general ABAP agent(s). Their packaged agent files remain untouched.`
    )
  }

  private async getStatus(): Promise<vscode.LanguageModelToolResult> {
    const settings = getSubagentSettings()
    const testingEnabled = await isTestFolderValid()
    const testingReadiness = await getTestingAgentReadiness()
    const discovery = await availableModels()
    const lines = [
      "SUBAGENT STATUS",
      "===============",
      `Testing folder: ${testingEnabled ? "READY" : "NOT CONFIGURED"}`,
      `Available models: ${discovery.models.length}`,
      "",
      ...MODEL_SELECTION_GUIDANCE,
      "",
      "GENERAL AGENTS"
    ]

    for (const agent of GENERAL_AGENT_REGISTRY) {
      const model = settings.models[agent.id] || "NOT CONFIGURED"
      lines.push(
        `- ${agent.id}: ${settings.enabledAgents[agent.id] === true ? "ENABLED" : "DISABLED"}; tier=${agent.tier}; model=${model}`,
        `  Guidance: ${generalModelGuidance(agent)}`
      )
    }
    lines.push("", "TESTING AGENTS")
    for (const agent of ALL_AGENT_REGISTRY.filter(item => item.section === "testing")) {
      lines.push(
        `- ${agent.id}: ${testingReadiness.ready ? "AVAILABLE" : "UNAVAILABLE"}; model=${settings.models[agent.id] || "NOT CONFIGURED"}`,
        `  Guidance: ${agent.guidance}`
      )
    }
    return text(lines.join("\n"))
  }

  private async listModels(): Promise<vscode.LanguageModelToolResult> {
    const discovery = await availableModels()
    if (!discovery.models.length) {
      return text(discovery.error || "No Copilot language models are currently available.")
    }
    return text(
      [
        "AVAILABLE LANGUAGE MODELS",
        "========================",
        ...MODEL_SELECTION_GUIDANCE,
        "",
        ...discovery.models.map(
          model =>
            `${model.name} (${model.vendor}, ${model.family}${model.version ? `, ${model.version}` : ""})`
        )
      ].join("\n")
    )
  }

  private async listAgents(): Promise<vscode.LanguageModelToolResult> {
    const settings = getSubagentSettings()
    const testingEnabled = await isTestFolderValid()
    const testingReadiness = await getTestingAgentReadiness()
    const lines = ["AVAILABLE SUBAGENTS", "==================", "", "GENERAL AGENTS"]
    for (const agent of GENERAL_AGENT_REGISTRY) {
      lines.push(
        `${agent.id} - ${settings.enabledAgents[agent.id] === true ? "enabled" : "disabled"} - Tier ${agent.tier} - ${agent.description}`
      )
    }
    lines.push("", "TESTING AGENTS")
    for (const agent of ALL_AGENT_REGISTRY.filter(item => item.section === "testing")) {
      lines.push(
        `${agent.id} - ${testingReadiness.ready ? "available" : testingEnabled ? "unavailable until all testing-agent models are configured" : "unavailable until testing folder is configured"} - ${agent.description}`
      )
    }
    return text(lines.join("\n"))
  }

  private listTools(): vscode.LanguageModelToolResult {
    const tools = new Set<string>()
    for (const agent of ALL_AGENT_REGISTRY) {
      for (const tool of agent.tools || []) tools.add(tool)
    }
    return text(
      ["AVAILABLE SUBAGENT TOOLS", "========================", ...[...tools].sort()].join("\n")
    )
  }

  private async configureModels(
    configurations: Array<{ agentId: string; model: string }>
  ): Promise<vscode.LanguageModelToolResult> {
    if (!configurations.length) return text("Provide configurations as [{ agentId, model }].")

    const discovery = await availableModels()
    const settings = getSubagentSettings()
    const selections = await effectiveSubagentModels(this.context)
    const warnings: string[] = []
    const configuredIds: string[] = []

    for (const configuration of configurations) {
      if (!ALL_AGENT_REGISTRY.some(agent => agent.id === configuration.agentId)) {
        warnings.push(`Unknown agent: ${configuration.agentId}`)
        continue
      }
      selections[configuration.agentId] = configuration.model.trim()
      configuredIds.push(configuration.agentId)
      if (!discovery.models.some(model => model.name === configuration.model)) {
        warnings.push(
          `Model "${configuration.model}" is not currently available for ${configuration.agentId}`
        )
      }
    }

    const testingEnabled = await isTestFolderValid()
    const selectedTesting = configurations.some(configuration =>
      ALL_AGENT_REGISTRY.some(
        agent => agent.id === configuration.agentId && agent.section === "testing"
      )
    )
    const required = [
      ...new Set([
        ...configuredIds,
        ...GENERAL_AGENT_REGISTRY.filter(agent => settings.enabledAgents[agent.id] === true).map(
          agent => agent.id
        ),
        ...(selectedTesting && testingEnabled
          ? ALL_AGENT_REGISTRY.filter(agent => agent.section === "testing").map(agent => agent.id)
          : [])
      ])
    ]
    const result = await saveSubagentModels(this.context, selections, discovery.models, required)
    await syncGeneralAgentContexts()
    await ensureCustomAgentDelegationEnabled()
    return text(
      [
        "MODEL CONFIGURATION UPDATED",
        "",
        ...configurations.map(
          configuration => `- ${configuration.agentId} -> ${configuration.model}`
        ),
        warnings.length ? `\nWarnings:\n${warnings.join("\n")}` : "",
        result.changedFiles.length ? "\nModel assignments are active without a reload." : ""
      ].join("\n")
    )
  }

  private async validateConfiguration(): Promise<vscode.LanguageModelToolResult> {
    const settings = getSubagentSettings()
    const testingEnabled = await isTestFolderValid()
    const discovery = await availableModels()
    const required = requiredAgentIds(settings, testingEnabled)
    const validation = validateModelSelections(settings.models, discovery.models, required)
    if (!validation.missingAgentIds.length && !validation.unavailable.length) {
      return text(`All ${required.length} active subagent(s) have available models.`)
    }
    return text(
      [
        "SUBAGENT MODEL ISSUES",
        "",
        validation.missingAgentIds.length
          ? `Missing: ${validation.missingAgentIds.join(", ")}`
          : "",
        validation.unavailable.length
          ? `Unavailable: ${validation.unavailable.map(item => `${item.agentId} (${item.modelName})`).join(", ")}`
          : ""
      ]
        .filter(Boolean)
        .join("\n")
    )
  }
}

export function registerSubagentConfigTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry("manage_subagents", new SubagentConfigTool(context))
  )

  void migrateSubagentSettings()
    .then(() => syncGeneralAgentContexts())
    .then(() => ensureCustomAgentDelegationEnabled())

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async event => {
      if (event.affectsConfiguration("abapfs.subagents.enabledAgents")) {
        await syncGeneralAgentContexts()
      }
      if (event.affectsConfiguration("abapfs.subagents.models")) {
        await validateSubagentsOnStartup(context)
      }
    })
  )
}

export async function validateSubagentsOnStartup(_context: vscode.ExtensionContext): Promise<void> {
  try {
    await migrateSubagentSettings()
  } catch {
    // migrateSubagentSettings is fail-open; keep startup validation alive if a future change throws.
  }
  await syncGeneralAgentContexts()

  const settings = getSubagentSettings()
  const discovery = await availableModels()
  if (!discovery.models.length) return
  const validation = validateModelSelections(
    settings.models,
    discovery.models,
    GENERAL_AGENT_REGISTRY.filter(agent => settings.enabledAgents[agent.id] === true).map(
      agent => agent.id
    )
  )
  if (!validation.missingAgentIds.length && !validation.unavailable.length) return

  const invalidIds = new Set([
    ...validation.missingAgentIds,
    ...validation.unavailable.map(item => item.agentId)
  ])
  const enabledAgents = { ...settings.enabledAgents }
  for (const agentId of invalidIds) enabledAgents[agentId] = false
  await vscode.workspace
    .getConfiguration("abapfs.subagents")
    .update("enabledAgents", enabledAgents, vscode.ConfigurationTarget.Global)
  await syncGeneralAgentContexts()
  window.showWarningMessage(
    `Disabled ${invalidIds.size} general agent(s) with missing or unavailable models.`
  )
}
