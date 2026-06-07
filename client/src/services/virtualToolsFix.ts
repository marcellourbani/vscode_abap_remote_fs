/**
 * Disable VS Code's experimental "virtual tools" feature.
 *
 * When the threshold > 0 and there are many tools registered, VS Code clubs
 * them into groups that Copilot often fails to activate — making our 30+ ABAP
 * tools invisible. Setting threshold to 0 disables grouping entirely.
 *
 * This is triggered once after the user first connects to a SAP system.
 * It shows a non-modal notification rather than a blocking modal dialog.
 */

import * as vscode from "vscode"
import { log } from "../lib"
import { funWindow as window } from "./funMessenger"
import { ADTSCHEME } from "../adt/conections"

const FULL_SETTING_ID = "github.copilot.chat.virtualTools.threshold"
const RESET_COMMAND = "github.copilot.debug.resetVirtualToolGroups"
const DISMISSED_KEY = "abapfs.virtualToolsFix.dismissed"

/**
 * Called on every activation. Handles two scenarios:
 * 1. ADT folders already present (extension restarted after connecting) → check after a delay.
 * 2. No ADT folders yet → register a listener and wait for the first connection.
 *
 * Safe to call on every activation — dismissed/already-fixed state is persisted.
 */
export function registerVirtualToolsFixOnConnect(context: vscode.ExtensionContext): void {
  // Already dismissed — nothing to do ever again
  if (context.globalState.get<boolean>(DISMISSED_KEY)) return

  const hasAdtFolders =
    vscode.workspace.workspaceFolders?.some(f => f.uri.scheme === ADTSCHEME) ?? false

  if (hasAdtFolders) {
    // Extension restarted with ADT folders already mounted (e.g. after connecting).
    // Delay so the workspace finishes settling before showing the notification.
    setTimeout(() => disableVirtualToolGrouping(context), 5000)
    return
  }

  // No ADT folders yet — wait for the first connection
  const listener = vscode.workspace.onDidChangeWorkspaceFolders(e => {
    const hasNewAdtFolder = e.added.some(f => f.uri.scheme === ADTSCHEME)
    if (!hasNewAdtFolder) return

    listener.dispose()
    setTimeout(() => disableVirtualToolGrouping(context), 5000)
  })
  context.subscriptions.push(listener)
}

export async function disableVirtualToolGrouping(context: vscode.ExtensionContext): Promise<void> {
  try {
    if (context.globalState.get<boolean>(DISMISSED_KEY)) return

    // Only proceed if AI models are available — if not, Copilot isn't active yet
    // and there's nothing to fix. Will retry automatically on next activation.
    let hasModels = false
    try {
      const models = await vscode.lm.selectChatModels({})
      hasModels = models.length > 0
    } catch {
      // selectChatModels not available or failed — skip silently
    }
    if (!hasModels) return

    const rootConfig = vscode.workspace.getConfiguration()
    const inspection = rootConfig.inspect<number>(FULL_SETTING_ID)

    const workspaceValue = inspection?.workspaceValue
    const globalValue = inspection?.globalValue
    const effectiveValue = workspaceValue ?? globalValue ?? inspection?.defaultValue ?? 128

    if (effectiveValue === 0) {
      return // Already disabled — stay dormant
    }

    // Non-modal notification — doesn't interrupt the user's workflow
    const selection = await window.showWarningMessage(
      `ABAP FS: Virtual tool grouping is active (threshold: ${effectiveValue}). ` +
        "Copilot may not see all 30+ ABAP tools. " +
        "Disable grouping to make all tools available?",
      "Disable & Reload",
      "Later",
      "Don't Ask Again"
    )

    if (selection === "Don't Ask Again") {
      await context.globalState.update(DISMISSED_KEY, true)
      log("🔧 User chose not to disable virtual tool grouping — won't ask again")
      return
    }

    if (selection !== "Disable & Reload") {
      log("🔧 User deferred virtual tool grouping fix — will ask again next connection")
      return
    }

    // Show progress while applying changes
    await window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Disabling virtual tool grouping..."
      },
      async progress => {
        progress.report({ message: "Updating settings..." })

        await rootConfig.update(FULL_SETTING_ID, 0, vscode.ConfigurationTarget.Global)
        log("🔧 Disabled virtual tool grouping at global level")

        if (vscode.workspace.workspaceFolders?.length) {
          try {
            await rootConfig.update(FULL_SETTING_ID, 0, vscode.ConfigurationTarget.Workspace)
            log("🔧 Disabled virtual tool grouping at workspace level")
          } catch {
            // May fail for single-file mode or readonly workspace — global is enough
          }
        }

        progress.report({ message: "Resetting tool groups..." })
        try {
          await vscode.commands.executeCommand(RESET_COMMAND)
          log("🔧 Reset virtual tool groups")
        } catch {
          // Command may not exist in older Copilot versions — that's fine
        }

        progress.report({ message: "Reloading window..." })
        await vscode.commands.executeCommand("workbench.action.reloadWindow")
      }
    )
  } catch (error) {
    const msg = String(error)
    if (msg.includes("Canceled")) return
    // Unexpected error (e.g. settings write failed, reload command unavailable)
    log(`⚠️ Could not apply virtual tool grouping fix: ${error}`)
  }
}
