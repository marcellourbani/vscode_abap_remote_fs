import * as vscode from "vscode"
import { homedir } from "os"
import { setTestFolder as saveTestFolder } from "./config"

/**
 * Show a folder picker and save the choice to abapfs.testing.folder (always Global
 * scope — a test folder is a per-user machine choice, not tied to any one workspace).
 * Returns the chosen path, or undefined if the user cancelled.
 */
export async function pickTestFolder(): Promise<string | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri: vscode.Uri.file(homedir()),
    openLabel: "Use as SAP testing folder",
    title: "Select the folder where SAP test cases, scripts, and results should live"
  })
  if (!picked?.length) return undefined

  const folderPath = picked[0].fsPath
  await saveTestFolder(folderPath)
  return folderPath
}
