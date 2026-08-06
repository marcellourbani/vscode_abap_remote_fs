import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"

import { getSubagentModels, setSubagentModels } from "../config"
import {
  AvailableModel,
  FileChange,
  getFrontmatterModel,
  setFrontmatterModel,
  validateModelSelections,
  writeChangesWithRollback
} from "./modelConfigurationCore"
import { SUBAGENT_REGISTRY } from "./registry"

export interface ModelDiscoveryResult {
  models: AvailableModel[]
  error?: string
}

export interface ApplyModelsResult {
  changedFiles: string[]
}

export type ReconcileModelsResult =
  | { status: "defaults" }
  | {
      status: "invalid"
      validation: ReturnType<typeof validateModelSelections>
    }
  | {
      status: "applied"
      changedFiles: string[]
    }

let operationQueue: Promise<void> = Promise.resolve()

function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation, operation)
  operationQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

function agentFilePath(context: vscode.ExtensionContext, fileName: string): string {
  // Webpack copies client/media verbatim into client/dist/media at build time.
  return path.join(context.extensionPath, "client", "dist", "media", "agents", fileName)
}

/** The only model vendor we offer as a subagent backing model — the real Copilot models. */
const MODEL_VENDOR = "copilot"

/***
 * Allow-list the real Copilot model vendor. This
 * naturally excludes the Copilot CLI vendor (`copilotcli`)
 * and any other provider. We also drop the "Auto" router
 * pseudo-model even under the `copilot` vendor. If nothing
 * remains after filtering, callers correctly treat it as
 * "no models available".
 */
function isSelectableModel(model: { name: string; vendor: string; family: string }): boolean {
  if ((model.vendor ?? "").toLowerCase() !== MODEL_VENDOR) return false
  const name = (model.name ?? "").toLowerCase()
  const family = (model.family ?? "").toLowerCase()
  return name !== "auto" && family !== "auto"
}

export async function discoverLanguageModels(): Promise<ModelDiscoveryResult> {
  try {
    const selected = await vscode.lm.selectChatModels({})
    const byName = new Map<string, AvailableModel>()
    for (const model of selected) {
      if (!isSelectableModel(model)) continue
      if (!byName.has(model.name)) {
        byName.set(model.name, {
          id: model.id,
          name: model.name,
          vendor: model.vendor,
          family: model.family,
          version: model.version
        })
      }
    }
    return {
      models: [...byName.values()].sort(
        (left, right) =>
          left.vendor.localeCompare(right.vendor) || left.name.localeCompare(right.name)
      )
    }
  } catch (error) {
    return {
      models: [],
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export function configuredSubagentModels(): Record<string, string> {
  return getSubagentModels()
}

export function hasAnyConfiguredModel(models: Record<string, string>): boolean {
  return SUBAGENT_REGISTRY.some(agent => Boolean(models[agent.id]?.trim()))
}

async function readAgentFileModels(
  context: vscode.ExtensionContext
): Promise<Record<string, string>> {
  const models: Record<string, string> = {}
  for (const agent of SUBAGENT_REGISTRY) {
    const content = await fs.readFile(agentFilePath(context, agent.fileName), "utf8")
    models[agent.id] = getFrontmatterModel(content) ?? ""
  }
  return models
}

export async function effectiveSubagentModels(
  context: vscode.ExtensionContext
): Promise<Record<string, string>> {
  const configured = configuredSubagentModels()
  return hasAnyConfiguredModel(configured) ? configured : readAgentFileModels(context)
}

function normalizedSelections(selections: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    SUBAGENT_REGISTRY.map(agent => [agent.id, selections[agent.id]?.trim() ?? ""])
  )
}

async function prepareChanges(
  context: vscode.ExtensionContext,
  selections: Record<string, string>
): Promise<FileChange[]> {
  const changes: FileChange[] = []
  for (const agent of SUBAGENT_REGISTRY) {
    const filePath = agentFilePath(context, agent.fileName)
    const previousContent = await fs.readFile(filePath, "utf8")
    const nextContent = setFrontmatterModel(previousContent, selections[agent.id])
    if (nextContent !== previousContent) {
      changes.push({ path: filePath, previousContent, nextContent })
    }
  }
  return changes
}

async function writeChanges(changes: readonly FileChange[]): Promise<void> {
  await writeChangesWithRollback(changes, (filePath, content) =>
    fs.writeFile(filePath, content, "utf8")
  )
}

async function restoreChanges(changes: readonly FileChange[]): Promise<void> {
  await Promise.allSettled(
    changes.map(change => fs.writeFile(change.path, change.previousContent, "utf8"))
  )
}

async function applySubagentModels(
  context: vscode.ExtensionContext,
  selections: Record<string, string>
): Promise<ApplyModelsResult> {
  const normalized = normalizedSelections(selections)
  const changes = await prepareChanges(context, normalized)
  await writeChanges(changes)
  return { changedFiles: changes.map(change => change.path) }
}

export async function saveSubagentModels(
  context: vscode.ExtensionContext,
  selections: Record<string, string>,
  availableModels: readonly AvailableModel[]
): Promise<ApplyModelsResult> {
  return runExclusive(async () => {
    const normalized = normalizedSelections(selections)
    const validation = validateModelSelections(normalized, availableModels)
    if (validation.missingAgentIds.length) {
      throw new Error(`Select a model for: ${validation.missingAgentIds.join(", ")}.`)
    }
    if (validation.unavailable.length) {
      throw new Error(
        `Unavailable model selections: ${validation.unavailable
          .map(item => `${item.agentId} (${item.modelName})`)
          .join(", ")}.`
      )
    }

    const changes = await prepareChanges(context, normalized)
    await writeChanges(changes)
    try {
      await setSubagentModels(normalized)
    } catch (error) {
      await restoreChanges(changes)
      throw error
    }
    return { changedFiles: changes.map(change => change.path) }
  })
}

export async function reconcileConfiguredSubagentModels(
  context: vscode.ExtensionContext,
  availableModels: readonly AvailableModel[]
): Promise<ReconcileModelsResult> {
  return runExclusive(async () => {
    const configured = configuredSubagentModels()
    const hasConfiguredModels = hasAnyConfiguredModel(configured)
    const selections = hasConfiguredModels ? configured : await readAgentFileModels(context)

    const validation = validateModelSelections(selections, availableModels)
    if (validation.missingAgentIds.length || validation.unavailable.length) {
      return { status: "invalid", validation }
    }

    if (!hasConfiguredModels) return { status: "defaults" }

    const result = await applySubagentModels(context, configured)
    return { status: "applied", changedFiles: result.changedFiles }
  })
}
