/**
 * Centralized access to the SAP testing settings. Nothing here should ever be read via
 * `vscode.workspace.getConfiguration` directly outside this file — one place to change
 * if the setting shape ever changes.
 */
import { ConfigurationTarget, workspace } from "vscode"
import * as fs from "fs/promises"
import { getAuthMethod } from "vscode-abap-remote-fs-sharedapi"
import { RemoteManager } from "../../config"

const SECTION = "abapfs.testing"

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
  // saml2=disabled forces the basic-auth logon screen; on an SSO-authenticated system
  // it would suppress the very redirect that logs the user in.
  if (getAuthMethod(conn) === "basic") params.push("saml2=disabled")
  return `${base}/sap/bc/gui/sap/its/webgui?${params.join("&")}`
}
