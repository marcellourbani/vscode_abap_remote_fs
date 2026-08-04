import * as vscode from "vscode"

import { discoverLanguageModels, reconcileConfiguredSubagentModels } from "./modelConfiguration"
import { AvailableModel, modelSetsMatch } from "./modelConfigurationCore"

const INITIAL_DELAY_MS = 10_000
const MODEL_EVENT_DEBOUNCE_MS = 5_000
const STABILITY_CHECK_DELAY_MS = 2_000
const MAX_WAIT_MS = 90_000

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function showConfigurationError(message: string): Promise<void> {
  const action = await vscode.window.showErrorMessage(message, "Configure Models")
  if (action === "Configure Models") {
    await vscode.commands.executeCommand("abapfs.testing.setSubagentModels")
  }
}

async function reconcileModels(
  context: vscode.ExtensionContext,
  availableModels: readonly AvailableModel[]
): Promise<void> {
  try {
    const result = await reconcileConfiguredSubagentModels(context, availableModels)
    if (result.status === "defaults") return
    if (result.status === "invalid") {
      const details = [
        result.validation.missingAgentIds.length
          ? `missing: ${result.validation.missingAgentIds.join(", ")}`
          : "",
        result.validation.unavailable.length
          ? `unavailable: ${result.validation.unavailable
              .map(item => `${item.agentId} (${item.modelName})`)
              .join(", ")}`
          : ""
      ]
        .filter(Boolean)
        .join("; ")
      await showConfigurationError(
        `SAP testing subagent model configuration is invalid: ${details}.`
      )
      return
    }
    if (!result.changedFiles.length) return
    const action = await vscode.window.showInformationMessage(
      "ABAP FS reapplied saved SAP testing subagent models. Reload the window to use them.",
      "Reload Window"
    )
    if (action === "Reload Window") {
      await vscode.commands.executeCommand("workbench.action.reloadWindow")
    }
  } catch (error) {
    await showConfigurationError(
      `ABAP FS could not update its SAP testing subagent files: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

export function registerStartupModelReconciliation(context: vscode.ExtensionContext): void {
  const earliestCheck = Date.now() + INITIAL_DELAY_MS
  let disposed = false
  let checking = false
  let scheduled: ReturnType<typeof setTimeout> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined

  const modelChange = vscode.lm.onDidChangeChatModels(() => scheduleCheck())

  function dispose(): void {
    if (disposed) return
    disposed = true
    if (scheduled) clearTimeout(scheduled)
    if (timeout) clearTimeout(timeout)
    modelChange.dispose()
  }

  function scheduleCheck(): void {
    if (disposed) return
    if (scheduled) clearTimeout(scheduled)
    const delay = Math.max(MODEL_EVENT_DEBOUNCE_MS, earliestCheck - Date.now())
    scheduled = setTimeout(() => {
      scheduled = undefined
      void checkStableModels()
    }, delay)
  }

  async function checkStableModels(): Promise<void> {
    if (disposed || checking) return
    checking = true
    try {
      const first = await discoverLanguageModels()
      if (!first.models.length) return
      await sleep(STABILITY_CHECK_DELAY_MS)
      if (disposed) return
      const second = await discoverLanguageModels()
      if (!second.models.length || !modelSetsMatch(first.models, second.models)) {
        scheduleCheck()
        return
      }
      dispose()
      await reconcileModels(context, second.models)
    } finally {
      checking = false
    }
  }

  scheduleCheck()
  timeout = setTimeout(dispose, MAX_WAIT_MS)
  context.subscriptions.push({ dispose })
}
