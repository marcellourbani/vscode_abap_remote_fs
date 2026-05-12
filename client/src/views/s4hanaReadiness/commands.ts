/**
 * Command handlers for S/4HANA Readiness Dashboard.
 */

import { commands, env, ProgressLocation, Uri } from "vscode"
import { funWindow as window } from "../../services/funMessenger"
import { getClient } from "../../adt/conections"
import { AbapFsCommands, command } from "../../commands"
import { loadReadinessData } from "./dataFetcher"
import { S4HItemNode, S4HRefNode, S4HRoot, s4hProvider } from "./view"
import { log, showErrorMessage } from "../../lib"
import { connectedRoots } from "../../config"
import { atcProvider } from "../abaptestcockpit"

const LOG_PREFIX = "[S4H Readiness]"

async function pickConnection(): Promise<string | undefined> {
  const roots = connectedRoots()
  log.debug(`${LOG_PREFIX} pickConnection: found ${roots.size} connected roots`)
  if (roots.size === 0) {
    window.showErrorMessage("No SAP connections available. Connect to a system first.")
    return undefined
  }
  const keys = [...roots.keys()]
  if (keys.length === 1) {
    log.debug(`${LOG_PREFIX} pickConnection: auto-selecting '${keys[0]}'`)
    return keys[0]
  }
  const picked = await window.showQuickPick(
    keys.map(k => ({ label: k })),
    { placeHolder: "Select SAP system to analyze" }
  )
  log.debug(`${LOG_PREFIX} pickConnection: user picked '${picked?.label || "(cancelled)"}'`)
  return picked?.label
}

async function loadDashboard(connectionId?: string) {
  log.debug(`${LOG_PREFIX} loadDashboard called, connectionId=${connectionId || "(none)"}`)
  if (!connectionId) {
    connectionId = await pickConnection()
    if (!connectionId) {
      log.debug(`${LOG_PREFIX} loadDashboard: no connection selected, aborting`)
      return
    }
  }

  await window.withProgress(
    { location: ProgressLocation.Notification, title: "S/4HANA Readiness", cancellable: false },
    async (progress) => {
      try {
        log.debug(`${LOG_PREFIX} loadDashboard: getting client for '${connectionId}'`)
        progress.report({ message: `Connecting to ${connectionId}...` })
        const client = getClient(connectionId!)
        log.debug(`${LOG_PREFIX} loadDashboard: calling loadReadinessData`)
        const onProgress = (msg: string) => progress.report({ message: msg })
        const data = await loadReadinessData(client, onProgress)
        log.debug(`${LOG_PREFIX} loadDashboard: totalRefs=${data.totalRefs}, groups=${data.groups.length}, ungrouped=${data.ungrouped.length}`)
        if (data.totalRefs === 0) {
          window.showInformationMessage(
            `No S/4HANA compatibility findings for ${connectionId}. ` +
            `Run transaction SYCM on the system to analyze custom code.`
          )
          return
        }
        s4hProvider.setData(connectionId!, data)
        log.debug(`${LOG_PREFIX} loadDashboard: data set on provider, focusing view`)
        commands.executeCommand("abapfs.s4hReadiness.focus")
      } catch (e: any) {
        log.error(`${LOG_PREFIX} loadDashboard ERROR: ${e.message || e}`)
        showErrorMessage(`S/4HANA Readiness load failed: ${e.message || e}`)
      }
    }
  )
}

async function openObject(node?: S4HRefNode) {
  if (!node) return
  log.debug(`${LOG_PREFIX} openObject: ${node.ref.objName} (${node.ref.objType}) on ${node.connectionId}`)
  try {
    await window.withProgress(
      { location: ProgressLocation.Notification, title: `Opening ${node.ref.objName}...` },
      async () => {
        const client = getClient(node.connectionId)
        const results = await client.searchObject(node.ref.objName, node.ref.objType, 1)
        log.debug(`${LOG_PREFIX} openObject: search returned ${results.length} results`)
        if (!results.length) {
          window.showWarningMessage(`Object ${node.ref.objName} not found on ${node.connectionId}`)
          return
        }
        const adtUri = results[0]["adtcore:uri"]
        log.debug(`${LOG_PREFIX} openObject: resolved URI = ${adtUri}`)
        await commands.executeCommand(AbapFsCommands.showObject, {
          connId: node.connectionId,
          uri: adtUri
        })
      }
    )
  } catch (e: any) {
    log.error(`${LOG_PREFIX} openObject ERROR: ${e.message || e}`)
    showErrorMessage(e)
  }
}

async function runAtcOnObject(node?: S4HRefNode) {
  if (!node) return
  log.debug(`${LOG_PREFIX} runAtcOnObject: ${node.ref.objName} (${node.ref.objType}) on ${node.connectionId}`)
  try {
    await window.withProgress(
      { location: ProgressLocation.Notification, title: `Running ATC on ${node.ref.objName}...` },
      async (progress) => {
        const client = getClient(node.connectionId)
        const results = await client.searchObject(node.ref.objName, node.ref.objType, 1)
        log.debug(`${LOG_PREFIX} runAtcOnObject: search returned ${results.length} results`)
        if (!results.length) {
          window.showWarningMessage(`Object ${node.ref.objName} not found on ${node.connectionId}`)
          return
        }
        const adtUri = results[0]["adtcore:uri"]
        log.debug(`${LOG_PREFIX} runAtcOnObject: running ATC on ${adtUri}`)
        const variant = await atcProvider.runInspectorByAdtUrl(adtUri, node.connectionId)
        progress.report({ message: `Variant: ${variant}` })
      }
    )
  } catch (e: any) {
    log.error(`${LOG_PREFIX} runAtcOnObject ERROR: ${e.message || e}`)
    showErrorMessage(e)
  }
}

function askCopilotToFix(node?: S4HRefNode) {
  if (!node) return
  log.debug(`${LOG_PREFIX} askCopilotToFix: ${node.ref.objName} -> ${node.ref.refObjName}`)
  const ref = node.ref
  const item = node.parent.group.item
  const noteInfo = item.note ? `\n- SAP Note: ${item.note}` : ""
  const prompt = [
    `Fix S/4HANA compatibility issue in ${ref.objName} (${ref.objType}):`,
    `- References removed/changed object: ${ref.refObjName} (${ref.refObjType})`,
    item.title !== "UNLINKED REFERENCES" ? `- Simplification: ${item.title}` : "",
    noteInfo,
    `- Package: ${ref.devclass}`,
    `\nPlease open the object, find the usage of ${ref.refObjName}, and suggest the S/4HANA-compatible replacement.`
  ].filter(Boolean).join("\n")

  commands.executeCommand("workbench.action.chat.open", { query: prompt, isPartialQuery: true })
}

function openSapNote(node?: S4HItemNode | S4HRefNode) {
  let noteNumber: number | undefined
  if (node instanceof S4HItemNode) {
    noteNumber = node.group.item.note
  } else if (node instanceof S4HRefNode) {
    noteNumber = node.parent.group.item.note
  }
  log.debug(`${LOG_PREFIX} openSapNote: noteNumber=${noteNumber || "none"}`)
  if (!noteNumber) {
    window.showInformationMessage("No SAP Note linked to this item.")
    return
  }
  env.openExternal(Uri.parse(`https://me.sap.com/notes/${noteNumber}`))
}

async function refreshDashboard(node?: S4HRoot) {
  const connectionId = node?.connectionId
  log.debug(`${LOG_PREFIX} refreshDashboard: connectionId=${connectionId || "(pick)"}`)
  await loadDashboard(connectionId)
}

async function filterTree(node?: S4HRoot) {
  const connectionId = node?.connectionId
  const input = await window.showInputBox({
    prompt: `Filter references${connectionId ? ` for ${connectionId}` : ""} (supports * wildcard)`,
    value: "",
    placeHolder: "e.g. Y* or Z*PRICING*"
  })
  if (input === undefined) return // cancelled
  log.debug(`${LOG_PREFIX} filterTree: setting filter to '${input}' for ${connectionId || "all"}`)
  s4hProvider.setFilter(input, connectionId)
}

function clearFilter(node?: S4HRoot) {
  const connectionId = node?.connectionId
  log.debug(`${LOG_PREFIX} clearFilter for ${connectionId || "all"}`)
  s4hProvider.setFilter("", connectionId)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
class S4HCommands {
  @command(AbapFsCommands.s4hLoad)
  private async s4hLoad() { return loadDashboard() }

  @command(AbapFsCommands.s4hRefresh)
  private async s4hRefresh(node?: S4HRoot) { return refreshDashboard(node) }

  @command(AbapFsCommands.s4hOpenObject)
  private async s4hOpenObject(node?: S4HRefNode) { return openObject(node) }

  @command(AbapFsCommands.s4hRunAtc)
  private async s4hRunAtc(node?: S4HRefNode) { return runAtcOnObject(node) }

  @command(AbapFsCommands.s4hAskCopilot)
  private async s4hAskCopilot(node?: S4HRefNode) { return askCopilotToFix(node) }

  @command(AbapFsCommands.s4hOpenNote)
  private async s4hOpenNote(node?: S4HItemNode | S4HRefNode) { return openSapNote(node) }

  @command(AbapFsCommands.s4hFilter)
  private async s4hFilter(node?: S4HRoot) { return filterTree(node) }

  @command(AbapFsCommands.s4hClearFilter)
  private async s4hClearFilter(node?: S4HRoot) { return clearFilter(node) }
}
