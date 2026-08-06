/**
 * Centralized access to the SAP testing settings. Nothing here should ever be read via
 * `vscode.workspace.getConfiguration` directly outside this file — one place to change
 * if the setting shape ever changes.
 */
import { ConfigurationTarget, extensions, workspace } from "vscode"
import * as fs from "fs/promises"
import { RemoteManager } from "../../config"

const SECTION = "abapfs.testing"

/** Microsoft's Playwright extension — supplies the test sidebar, and nothing else. */
const PLAYWRIGHT_EXTENSION_ID = "ms-playwright.playwright"

export function getTestFolder(): string {
  return workspace.getConfiguration(SECTION).get<string>("folder", "")
}

/** Always Global scope, per design — a test folder is a per-user choice, not per-workspace. */
export async function setTestFolder(folderPath: string): Promise<void> {
  await workspace.getConfiguration(SECTION).update("folder", folderPath, ConfigurationTarget.Global)
}

/** User-configured override for the Edge/Chromium executable. Empty string means "auto-detect". */
export function getEdgePath(): string {
  return workspace.getConfiguration(SECTION).get<string>("edgePath", "")
}

export function getSubagentModels(): Record<string, string> {
  return workspace.getConfiguration(SECTION).get<Record<string, string>>("subagentModels", {})
}

export async function setSubagentModels(models: Record<string, string>): Promise<void> {
  await workspace
    .getConfiguration(SECTION)
    .update("subagentModels", models, ConfigurationTarget.Global)
}

/**
 * Whether Microsoft's Playwright extension is installed. Only the sidebar integration
 * depends on it — running specs and recording both use the bundled Playwright — so the
 * test folder gets its sidebar scaffolding only when this is true.
 */
export function isPlaywrightExtensionInstalled(): boolean {
  return !!extensions.getExtension(PLAYWRIGHT_EXTENSION_ID)
}

/** True if the test folder is set AND currently resolves to a real, existing directory. */
export async function isTestFolderValid(): Promise<boolean> {
  const folder = getTestFolder()
  if (!folder) return false
  try {
    const stat = await fs.stat(folder)
    return stat.isDirectory()
  } catch {
    return false
  }
}

/**
 * Build the SAP WebGUI URL for a configured connection. Returns a string prefixed with
 * "ERROR:" when the connection is unknown or incomplete, so callers can surface the
 * message without throwing.
 */
export async function getWebGuiUrl(connectionId: string): Promise<string> {
  const conn = await RemoteManager.get().byIdAsync(connectionId)
  if (!conn) return `ERROR: No abapfs.remote entry for "${connectionId}".`
  if (!conn.url) return `ERROR: abapfs.remote["${connectionId}"] has no "url" property.`
  if (!conn.client) return `ERROR: abapfs.remote["${connectionId}"] has no "client" property.`

  const base = conn.url.replace(/\/sap\/bc\/adt.*$/, "").replace(/\/$/, "")
  const params = [`sap-client=${conn.client}`, `sap-language=${conn.language || "EN"}`]
  return `${base}/sap/bc/gui/sap/its/webgui?${params.join("&")}`
}
