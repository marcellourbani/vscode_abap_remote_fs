/**
 * Activation for the SAP UI testing features.
 *
 * Everything here is dormant until a test folder is configured: the `abapfs:testingEnabled`
 * context key gates all testing skills, agents and LM tools, so a user who never runs
 * "ABAP FS: Enable SAP UI Testing Features" sees none of it.
 *
 * Scaffolding inside the test folder comes in two tiers — see testFolderScaffold.ts. The
 * Playwright-sidebar tier is applied and removed as that extension is installed or
 * removed, so it is never left behind for someone who does not use it.
 */
import * as path from "path"
import * as vscode from "vscode"

import { pickAdtRoot } from "../../config"
import { setContext } from "../../context"
import {
  getTestFolder,
  getWebGuiUrl,
  isPlaywrightExtensionInstalled,
  isTestFolderValid
} from "./config"
import { pickTestFolder } from "./setTestFolder"
import { runRecordWebGuiFlow } from "./recordWebGuiFlow"
import {
  RuntimePaths,
  ensurePlaywrightSidebarSupport,
  ensureTestFolderBaseline,
  readActiveSystem,
  removePlaywrightSidebarSupport,
  writeActiveSystem
} from "./testFolderScaffold"
import { SubagentModelsPanel } from "./subagents/subagentModelsPanel"
import { registerStartupModelReconciliation } from "./subagents/startupReconciliation"

const NO_SYSTEM_LABEL = "$(beaker) SAP: (no system)"

function runtimePathsFor(context: vscode.ExtensionContext): RuntimePaths {
  const dist = path.join(context.extensionPath, "client", "dist")
  return {
    runtimeDir: path.join(dist, "runtime"),
    playwrightDir: path.join(dist, "vendor", "node_modules", "playwright"),
    typesDir: path.join(context.extensionPath, "client", "node_modules", "@types")
  }
}

export function registerTestingFeatures(context: vscode.ExtensionContext): void {
  const runtimePaths = runtimePathsFor(context)

  // Only useful for the Playwright sidebar, which cannot take arguments and so reads the
  // chosen system from .sap-active-system. Hidden entirely when that extension is absent.
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10)
  statusBar.command = "abapfs.testing.selectSystem"
  statusBar.tooltip = "ABAP FS: select the SAP system the Playwright sidebar runs against"
  statusBar.text = NO_SYSTEM_LABEL
  context.subscriptions.push(statusBar)

  async function refreshStatusBar(): Promise<void> {
    const folder = getTestFolder()
    if (!folder || !isPlaywrightExtensionInstalled()) {
      statusBar.hide()
      return
    }
    const active = await readActiveSystem(folder)
    statusBar.text = active ? `$(beaker) SAP: ${active}` : NO_SYSTEM_LABEL
    statusBar.show()
  }

  async function syncTestFolderUnsafe(): Promise<void> {
    const enabled = await isTestFolderValid()
    await setContext("abapfs:testingEnabled", enabled)
    if (!enabled) {
      statusBar.hide()
      return
    }

    const folder = getTestFolder()
    await ensureTestFolderBaseline(folder, runtimePaths)
    if (isPlaywrightExtensionInstalled()) {
      await ensurePlaywrightSidebarSupport(folder, runtimePaths)
    } else {
      await removePlaywrightSidebarSupport(folder)
    }
    await refreshStatusBar()
  }

  // Multiple triggers (command, config-change event, extensions-change event) can fire
  // for the same folder in quick succession. Chain them onto one promise so the
  // filesystem scaffolding in testFolderScaffold.ts never runs concurrently with itself —
  // overlapping junction creation/removal races and fails with EEXIST otherwise.
  let syncChain: Promise<void> = Promise.resolve()
  function syncTestFolder(): Promise<void> {
    syncChain = syncChain.catch(() => undefined).then(syncTestFolderUnsafe)
    return syncChain
  }

  async function setTestFolderCommand(): Promise<void> {
    const folder = await pickTestFolder()
    if (!folder) return
    await syncTestFolder()
    const openInWorkspace = (vscode.workspace.workspaceFolders ?? []).some(
      wf => folder === wf.uri.fsPath || folder.startsWith(wf.uri.fsPath + path.sep)
    )
    const action = await vscode.window.showInformationMessage(
      `SAP testing folder set to ${folder}.` +
        (openInWorkspace ? "" : " Add it to your workspace so test artifacts are editable."),
      ...(openInWorkspace ? [] : ["Add to Workspace"])
    )
    if (action === "Add to Workspace") {
      vscode.workspace.updateWorkspaceFolders(
        vscode.workspace.workspaceFolders?.length ?? 0,
        null,
        { uri: vscode.Uri.file(folder) }
      )
    }
  }

  async function openTestFolder(): Promise<void> {
    const folder = getTestFolder()
    if (!folder) {
      vscode.window.showWarningMessage(
        "No SAP testing folder is set yet. Run 'ABAP FS: Enable SAP UI Testing Features' first."
      )
      return
    }
    await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(folder))
  }

  async function selectSystem(): Promise<void> {
    const folder = getTestFolder()
    if (!folder) {
      vscode.window.showWarningMessage("No SAP testing folder is set yet.")
      return
    }
    const root = await pickAdtRoot()
    if (!root) return

    const connectionId = root.uri.authority
    const url = await getWebGuiUrl(connectionId)
    if (url.startsWith("ERROR:")) {
      vscode.window.showErrorMessage(url)
      return
    }
    await writeActiveSystem(folder, connectionId, url)
    await refreshStatusBar()
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("abapfs.testing.setTestFolder", setTestFolderCommand),
    vscode.commands.registerCommand("abapfs.testing.openTestFolder", openTestFolder),
    vscode.commands.registerCommand("abapfs.testing.selectSystem", selectSystem),
    vscode.commands.registerCommand("abapfs.testing.recordWebGuiFlow", () =>
      runRecordWebGuiFlow(context)
    ),
    vscode.commands.registerCommand("abapfs.testing.setSubagentModels", () =>
      SubagentModelsPanel.show(context)
    ),
    // The folder can be pointed elsewhere, or deleted from disk, at any time.
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("abapfs.testing.folder")) void syncTestFolder()
    }),
    // Installing or removing the Playwright extension adds or retires the sidebar tier.
    vscode.extensions.onDidChange(() => void syncTestFolder())
  )

  registerStartupModelReconciliation(context)
  void syncTestFolder()
}
