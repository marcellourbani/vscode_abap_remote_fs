import * as vscode from "vscode"
import { log } from "../lib"

const WALKTHROUGH_SHOWN_KEY = "abapfs.walkthroughShown"
const EXTENSION_QUALIFIED_ID = "murbani.vscode-abap-remote-fs"

export function showWelcomeWalkthrough(context: vscode.ExtensionContext): void {
  const shown = context.globalState.get<boolean>(WALKTHROUGH_SHOWN_KEY)
  if (shown) return

  context.globalState.update(WALKTHROUGH_SHOWN_KEY, true)

  // Small delay so the extension finishes activating before the walkthrough opens
  setTimeout(() => {
    vscode.commands.executeCommand(
      "workbench.action.openWalkthrough",
      `${EXTENSION_QUALIFIED_ID}#abapfs.gettingStarted`,
      false
    )
    log("📖 Opened Getting Started walkthrough for first-time user")
  }, 5000)
}
