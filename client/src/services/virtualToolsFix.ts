/**
 * Disable VS Code's experimental "virtual tools" feature.
 *
 * When the threshold > 0 and there are many tools registered, VS Code clubs
 * them into groups that Copilot often fails to activate — making our 30+ ABAP
 * tools invisible. Setting threshold to 0 disables grouping entirely.
 *
 * This runs once on activation. If the threshold is already 0, it stays dormant.
 */

import * as vscode from "vscode"
import { log } from "../lib"
import { funWindow as window } from "./funMessenger"

const FULL_SETTING_ID = "github.copilot.chat.virtualTools.threshold"
const RESET_COMMAND = "github.copilot.debug.resetVirtualToolGroups"
const DISMISSED_KEY = "abapfs.virtualToolsFix.dismissed"

export async function disableVirtualToolGrouping(
  context: vscode.ExtensionContext
): Promise<void> {
  try {
    // User previously chose "Don't Ask Again" — respect that
    if (context.globalState.get<boolean>(DISMISSED_KEY)) {
      return
    }

    const rootConfig = vscode.workspace.getConfiguration()
    const inspection = rootConfig.inspect<number>(FULL_SETTING_ID)

    const workspaceValue = inspection?.workspaceValue
    const globalValue = inspection?.globalValue
    const effectiveValue = workspaceValue ?? globalValue ?? inspection?.defaultValue ?? 128

    if (effectiveValue === 0) {
      return // Already disabled — stay dormant
    }

    // Ask the user before changing anything
    const selection = await window.showWarningMessage(
      "VS Code's experimental \"virtual tool grouping\" is active (threshold: "
        + effectiveValue
        + "). This groups extension tools and Copilot often fails to activate the groups, "
        + "making ABAP FS tools invisible to AI. "
        + "We recommend setting the threshold to 0 to disable grouping so all 30+ ABAP tools are always available to Copilot.",
      { modal: true, detail: "This changes the setting \"github.copilot.chat.virtualTools.threshold\" to 0 at both global and workspace level. A window reload will be needed afterwards." },
      "Disable Grouping & Reload",
      "Remind Me Next Time",
      "Don't Ask Again"
    )

    if (selection === "Don't Ask Again") {
      await context.globalState.update(DISMISSED_KEY, true)
      log("🔧 User chose not to disable virtual tool grouping — won't ask again")
      return
    }

    if (selection === "Remind Me Next Time") {
      log("🔧 User deferred virtual tool grouping fix — will ask again next activation")
      return
    }

    if (selection !== "Disable Grouping & Reload") {
      // User dismissed the dialog (pressed Escape / clicked X) — same as remind me
      return
    }

    // Show progress while applying changes — settings updates trigger config change events across all extensions which takes a moment
    await window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Disabling virtual tool grouping..." },
      async (progress) => {
        progress.report({ message: "Updating settings..." })

        // Always update global
        await rootConfig.update(FULL_SETTING_ID, 0, vscode.ConfigurationTarget.Global)
        log("🔧 Disabled virtual tool grouping at global level")

        // Update workspace level only if a workspace is open — this throws otherwise
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
    // "Canceled" is expected — the window reload disposes the extension mid-execution
    const msg = String(error)
    if (!msg.includes("Canceled")) {
      log(`⚠️ Could not check/disable virtual tool grouping: ${error}`)
    }
  }
}
