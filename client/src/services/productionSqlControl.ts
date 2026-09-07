import { ConfigurationTarget, workspace } from "vscode"
import { connectedRoots, formatKey } from "../config"
import { funWindow as window } from "./funMessenger"

export const PRODUCTION_SQL_CONTROL_SETTING = "productionSqlControl"

type ProductionSqlPreference = "allow"

const sessionPreferences = new Map<string, ProductionSqlPreference>()

function getGlobalPreferences(): Record<string, ProductionSqlPreference> {
  const inspection = workspace
    .getConfiguration("abapfs")
    .inspect<Record<string, ProductionSqlPreference>>(PRODUCTION_SQL_CONTROL_SETTING)

  const stored = inspection?.globalValue

  if (!stored || typeof stored !== "object") return {}

  return Object.fromEntries(
    Object.entries(stored).map(([connectionId, preference]) => [
      formatKey(connectionId),
      preference
    ])
  )
}

async function updateGlobalPreference(
  connectionId: string,
  preference?: ProductionSqlPreference
): Promise<void> {
  const key = formatKey(connectionId)
  const preferences = getGlobalPreferences()
  if (preference) preferences[key] = preference
  else delete preferences[key]

  await workspace
    .getConfiguration("abapfs")
    .update(PRODUCTION_SQL_CONTROL_SETTING, preferences, ConfigurationTarget.Global)
}

export function getProductionSqlPreference(
  connectionId: string
): ProductionSqlPreference | undefined {
  const key = formatKey(connectionId)
  const sessionPreference = sessionPreferences.get(key)
  if (sessionPreference) return sessionPreference

  return getGlobalPreferences()[key]
}

export function setSessionProductionSqlPreference(connectionId: string): void {
  sessionPreferences.set(formatKey(connectionId), "allow")
}

export function clearSessionProductionSqlPreference(connectionId: string): void {
  sessionPreferences.delete(formatKey(connectionId))
}

export async function configureProductionSqlControlForConnection(
  connectionId: string
): Promise<ProductionSqlPreference | undefined> {
  const key = formatKey(connectionId)
  const reset = "Reset preference"
  const session = "Allow in this session"
  const always = "Allow always"
  const choice = await window.showQuickPick([reset, session, always], {
    title: `Production SQL control: ${key}`,
    placeHolder: "Choose how internal SQL queries may return production data to AI"
  })
  if (!choice) return undefined

  if (choice === reset) {
    clearSessionProductionSqlPreference(key)
    await updateGlobalPreference(key)
    window.showInformationMessage(`Production SQL preference reset for ${key}.`)
    return undefined
  }

  if (choice === session) {
    setSessionProductionSqlPreference(key)
    window.showInformationMessage(`Production SQL allowed for ${key} for this session.`)
    return "allow"
  }

  await updateGlobalPreference(key, "allow")
  window.showInformationMessage(`Production SQL allowed for ${key} across workspaces.`)
  return "allow"
}

export async function configureProductionSqlControl(): Promise<void> {
  const connections = Array.from(connectedRoots().keys()).sort()

  if (connections.length === 0) {
    window.showWarningMessage("No SAP systems are currently connected.")
    return
  }

  const connectionId = await window.showQuickPick(connections, {
    title: "Configure Production SQL Control",
    placeHolder: "Select an SAP connection"
  })
  if (!connectionId) return

  await configureProductionSqlControlForConnection(connectionId)
}

export function clearSessionProductionSqlPreferences(): void {
  sessionPreferences.clear()
}
