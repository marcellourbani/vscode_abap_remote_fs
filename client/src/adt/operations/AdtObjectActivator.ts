import {
  ADTClient,
  isAdtError,
  inactiveObjectsInResults,
  InactiveObjectRecord,
  InactiveObjectElement
} from "abap-adt-api"
import { Uri, EventEmitter, QuickPickItemKind } from "vscode"
import { AbapObject } from "abapobject"
import { getClient } from "../conections"
import { IncludeProvider, IncludeService } from "../includes"
import { isDefined, channel } from "../../lib"
import { funWindow as window } from "../../services/funMessenger"

// Log activation errors to ABAP FS output channel
const logError = (message: string) => {
  channel.appendLine(message)
}

export interface ActivationEvent {
  object: AbapObject
  uri: Uri
  activated: AbapObject
  mainProg?: string
}

export class AdtObjectActivator {
  constructor(private client: ADTClient) {}
  private static instances = new Map<string, AdtObjectActivator>()
  private emitter = new EventEmitter<ActivationEvent>()
  public static get(connId: string) {
    const instance = this.instances.get(connId)
    if (instance) return instance
    const stateless_client = getClient(connId, false)
    // stateful_client.stateful = session_types.stateful
    const newinstance = new AdtObjectActivator(stateless_client)
    this.instances.set(connId, newinstance)
    return newinstance
  }

  public get onActivate() {
    return this.emitter.event
  }

  private async getMain(object: AbapObject, uri: Uri) {
    const service = IncludeService.get(uri.authority)
    if (!service.needMain(object)) return
    const provider = IncludeProvider.get()
    const main = service.current(uri.path) || (await provider.switchIncludeIfMissing(uri))
    return main?.["adtcore:uri"]
  }

  private async getAllInactiveEntries(): Promise<InactiveObjectRecord[]> {
    const rawInactive = await this.client.inactiveObjects()
    const tofilter = rawInactive.length
      ? rawInactive
      : await this.client.inactiveObjects("application/xml")
    return rawInactive.filter(r => r.object)
  }

  private async getAllInactiveObjects() {
    const entries = await this.getAllInactiveEntries()
    return entries.map(entry => entry.object).filter(obj => obj)
  }

  private async siblings(object: AbapObject, uri: Uri) {
    const rawInactive = await this.client.inactiveObjects()
    const inactive = rawInactive.map(r => r.object).filter(o => o)

    // For includes, get the main program and then find all related objects
    if (object.type === "PROG/I") {
      const mainProgramUri = await this.getMain(object, uri)
      if (!mainProgramUri) return

      const relatedObjects: any[] = []

      // Check if main program is inactive
      const mainProgramInactive = inactive.find(o => o?.["adtcore:uri"] === mainProgramUri)
      if (mainProgramInactive) {
        relatedObjects.push(mainProgramInactive)
      }

      // Add current include if inactive
      const currentIncludeInactive = inactive.find(o => o?.["adtcore:uri"] === object.path)
      if (currentIncludeInactive) {
        relatedObjects.push(currentIncludeInactive)
      }

      // Get other includes of the main program using nodeContents
      try {
        const programName = mainProgramUri.split("/").pop()?.toUpperCase()
        if (programName) {
          const nodeStructure = await this.client.statelessClone.nodeContents(
            "PROG/P",
            programName,
            undefined,
            undefined,
            true
          )

          const includeNodes = nodeStructure.nodes.filter(n => n.OBJECT_TYPE === "PROG/I")

          includeNodes.forEach(node => {
            const match = inactive.find(o => o?.["adtcore:uri"] === node.OBJECT_URI)
            if (match && !relatedObjects.find(r => r["adtcore:uri"] === match["adtcore:uri"])) {
              relatedObjects.push(match)
            }
          })
        }
      } catch (error) {
        // Silently continue - we'll still have main program and current include
      }

      return relatedObjects.length > 0 ? relatedObjects : undefined
    }

    // For non-includes, use parentUri matching (classes, etc.)
    const parentUri = inactive.find(o => o?.["adtcore:uri"] === object.path)?.["adtcore:parentUri"]

    if (!parentUri || inactive.length <= 1) {
      return
    }

    const siblings = inactive.filter(isDefined).filter(o => o?.["adtcore:parentUri"] === parentUri)

    return siblings
  }

  private async getRelatedInactiveObjects(object: AbapObject) {
    try {
      const allInactive = await this.getAllInactiveObjects()

      // Find the main object if it's inactive
      const mainObjectInactive = allInactive.find(obj => obj && obj["adtcore:uri"] === object.path)
      const relatedObjects: any[] = []

      if (mainObjectInactive) {
        relatedObjects.push(mainObjectInactive)
      }

      // For programs, get includes directly from SAP nodeContents API
      // This bypasses the 'expandable' check which is for filesystem display, not activation
      if (object.lockObject.type === "PROG/P") {
        try {
          const nodeStructure = await this.client.statelessClone.nodeContents(
            "PROG/P",
            object.lockObject.name,
            undefined,
            undefined,
            true
          )

          // Find which includes are inactive
          const includeNodes = nodeStructure.nodes.filter(
            n => n.OBJECT_TYPE === "PROG/I" && n.OBJECT_NAME
          )

          // Helper to extract base URI without /source/main?context=... suffix
          const getBaseUri = (uri: string) => {
            const match = uri.match(/^(\/sap\/bc\/adt\/programs\/includes\/[^\/]+)/)
            return match ? match[1] : uri
          }

          const inactiveIncludes = includeNodes
            .map(node => {
              const nodeBaseUri = getBaseUri(node.OBJECT_URI)
              const match = allInactive.find(inactiveObj => {
                if (!inactiveObj) return false
                const inactiveBaseUri = getBaseUri(inactiveObj["adtcore:uri"])
                return inactiveBaseUri === nodeBaseUri
              })
              return match
            })
            .filter(obj => obj !== undefined)

          relatedObjects.push(...inactiveIncludes)
        } catch (error) {
          // Silently continue
        }
      } else {
        // For non-programs, use the existing childComponents approach
        try {
          if (!object.lockObject.structure) {
            await object.lockObject.loadStructure()
          }

          const childComponents = await object.lockObject.childComponents(true)

          const inactiveChildren = childComponents.nodes
            .map(node => {
              const match = allInactive.find(
                inactiveObj => inactiveObj && inactiveObj["adtcore:uri"] === node.OBJECT_URI
              )
              return match
            })
            .filter(obj => obj !== undefined)

          relatedObjects.push(...inactiveChildren)
        } catch (error) {
          // Silently continue
        }
      }

      // Remove duplicates based on URI
      const uniqueObjects = relatedObjects.filter(
        (obj, index, self) => index === self.findIndex(o => o["adtcore:uri"] === obj["adtcore:uri"])
      )

      return uniqueObjects
    } catch (error) {
      return []
    }
  }

  private transportId(uri?: string) {
    return uri?.split("/").filter(Boolean).pop() || ""
  }

  private transportGrouping(entry: InactiveObjectRecord) {
    const transport = entry.transport
    const task =
      transport?.["adtcore:name"] ||
      this.transportId(transport?.["adtcore:uri"]) ||
      "Without transport"
    const order = this.transportId(transport?.["adtcore:parentUri"]) || task
    const description = `${transport?.["adtcore:description"] || ""}`.trim()
    return {
      key: `${order}::${task}`,
      order,
      task,
      description
    }
  }

  private formatGroupLabel(group: { order: string; task: string; description: string }) {
    const transportLabel =
      group.order === group.task ? group.task : `${group.order} / ${group.task}`
    return group.description ? `${transportLabel}  ${group.description}` : transportLabel
  }

  private formatObjectDescription(
    entry: InactiveObjectRecord,
    group: { order: string; task: string; description: string }
  ) {
    const parts = [`${entry.object?.["adtcore:type"] || ""}`]
    const transportLabel =
      group.order === group.task ? group.task : `${group.order} / ${group.task}`
    if (transportLabel) parts.push(transportLabel)
    if (entry.object?.deleted) parts.push("deleted")
    if (entry.object?.user) parts.push(entry.object.user)
    return parts.filter(Boolean).join(" • ")
  }

  private formatObjectDetail(
    entry: InactiveObjectRecord,
    group: { order: string; task: string; description: string }
  ) {
    const parts = [group.description, entry.object?.["adtcore:uri"]]
    return parts.filter(Boolean).join(" • ")
  }

  private async showActivationSelectionDialog(entries: InactiveObjectRecord[]) {
    const groupedEntries = new Map<
      string,
      { order: string; task: string; description: string; entries: InactiveObjectRecord[] }
    >()

    for (const entry of entries) {
      const group = this.transportGrouping(entry)
      const existing = groupedEntries.get(group.key)
      if (existing) {
        existing.entries.push(entry)
      } else {
        groupedEntries.set(group.key, { ...group, entries: [entry] })
      }
    }

    const items = [...groupedEntries.values()]
      .sort((left, right) => {
        const orderCompare = left.order.localeCompare(right.order)
        if (orderCompare !== 0) return orderCompare
        return left.task.localeCompare(right.task)
      })
      .flatMap(group => {
        const objectItems = [...group.entries]
          .sort((left, right) => {
            const typeCompare = `${left?.object?.["adtcore:type"] || ""}`.localeCompare(
              `${right?.object?.["adtcore:type"] || ""}`
            )
            if (typeCompare !== 0) return typeCompare
            return `${left?.object?.["adtcore:name"] || ""}`.localeCompare(
              `${right?.object?.["adtcore:name"] || ""}`
            )
          })
          .map(entry => ({
            label: `  ${entry.object?.["adtcore:name"]}`,
            description: this.formatObjectDescription(entry, group),
            detail: this.formatObjectDetail(entry, group),
            picked: false,
            entry
          }))

        return [
          {
            kind: QuickPickItemKind.Separator,
            label: this.formatGroupLabel(group)
          },
          ...objectItems
        ]
      })

    const selected = await window.showQuickPick(items, {
      canPickMany: true,
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: "Select unactivated objects grouped by transport order",
      title: `Select unactivated objects (${entries.length} found)`
    })

    return selected ? selected.map((item: any) => item.entry.object) : null
  }

  private summarizeFailure(result: any, defaultObjectName: string) {
    const normText = (v: any): string => {
      if (Array.isArray(v)) return v.map(x => normText(x)).join(" ")
      if (v === undefined || v === null) return ""
      return `${v}`
    }

    type Msg = { text: string; href?: string; target: string }
    const msgs: Msg[] = (result?.messages || [])
      .map((m: any) => {
        const textRaw = m.shortText || m.longText || m.message || m.msg || ""
        const text = normText(textRaw).trim()
        if (!text) return undefined
        const href: string | undefined = m.href
        let target = ""

        if (href) {
          const parts = href.split("/").filter(Boolean)
          const sourceIdx = parts.indexOf("source")
          if (sourceIdx > 0) {
            target = parts[sourceIdx - 1] || ""
          } else {
            const hrefMatch = href.match(
              /includes\/([^\/\?#]+)|programs\/([^\/\?#]+)|classes\/([^\/\?#]+)/i
            )
            if (hrefMatch) target = hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || ""
          }
        }

        if (!target && typeof m.objDescr === "string") {
          const incMatch = m.objDescr.match(/Include\s+([^\s]+)/i)
          if (incMatch) target = incMatch[1]
        }

        if (!target) target = defaultObjectName

        return { text, href, target }
      })
      .filter(Boolean)

    const grouped = new Map<string, Msg[]>()
    for (const m of msgs) {
      const arr = grouped.get(m.target) || []
      arr.push(m)
      grouped.set(m.target, arr)
    }

    const inactiveList = (result?.inactive || [])
      .map((o: any) =>
        `${normText(o["adtcore:type"]) || ""} ${normText(o["adtcore:name"]) || ""}`.trim()
      )
      .filter(Boolean)

    const errorCount = msgs.length
    const firstError = msgs[0]?.text || "Unknown error"
    const firstObject = msgs[0]?.target || defaultObjectName
    const summary = `Activation failed: ${errorCount} error${errorCount !== 1 ? "s" : ""} in ${firstObject}${errorCount > 1 ? ` (${firstError}...)` : ` (${firstError})`}`

    logError(`❌ Activation failed for ${defaultObjectName}:`)
    for (const [key, vals] of grouped.entries()) {
      logError(`  📍 ${key}:`)
      vals.forEach(v => {
        logError(`      ${v.text}`)
      })
    }
    if (inactiveList.length) logError(`  ⚠️ Inactive objects: ${inactiveList.join(", ")}`)

    return { ok: false, summary }
  }

  public async activateMultiple(interactive = true): Promise<{
    ok: boolean
    summary?: string
    availableCount?: number
    selectedCount?: number
    cancelled?: boolean
  }> {
    try {
      const inactiveEntries = await this.getAllInactiveEntries()
      const inactiveObjects = inactiveEntries.map(entry => entry.object).filter(obj => obj)

      if (inactiveObjects.length === 0) {
        return { ok: true, availableCount: 0, selectedCount: 0 }
      }

      const selectedObjects = interactive
        ? await this.showActivationSelectionDialog(inactiveEntries)
        : inactiveObjects

      if (!selectedObjects) {
        return {
          ok: false,
          cancelled: true,
          summary: "Activation cancelled by user",
          availableCount: inactiveObjects.length,
          selectedCount: 0
        }
      }

      if (selectedObjects.length === 0) {
        return {
          ok: false,
          cancelled: true,
          summary: "No objects selected for activation",
          availableCount: inactiveObjects.length,
          selectedCount: 0
        }
      }

      const result = await this.client.activate(selectedObjects)
      if (result?.success) {
        return {
          ok: true,
          availableCount: inactiveObjects.length,
          selectedCount: selectedObjects.length
        }
      }

      return {
        ...this.summarizeFailure(result, selectedObjects[0]?.["adtcore:name"] || "selection"),
        availableCount: inactiveObjects.length,
        selectedCount: selectedObjects.length
      }
    } catch (error) {
      if (isAdtError(error)) {
        const status = error.response?.status || error.type || "ADT error"
        const body = error.response?.body || error.message || ""
        const bodyText = typeof body === "string" ? body : JSON.stringify(body)
        const trimmed = bodyText.length > 800 ? `${bodyText.slice(0, 800)}…` : bodyText
        logError(`❌ Multiple activation ADT error status=${status} body=${trimmed}`)
        return { ok: false, summary: `Activation failed (${status}): ${trimmed}` }
      }

      const errorMessage = (error as Error).message || String(error)
      logError(`❌ Multiple activation error: ${errorMessage}`)
      return { ok: false, summary: errorMessage }
    }
  }

  private async tryActivate(object: AbapObject, uri: Uri, interactive: boolean) {
    const { name, path } = object.lockObject
    let result
    const mainProg = await this.getMain(object, uri)

    // Check for inactive related objects BEFORE attempting activation
    let relatedObjects: any[] = []

    if (object.lockObject.type === "PROG/P") {
      // Main programs: Use childComponents to find includes
      relatedObjects = await this.getRelatedInactiveObjects(object)
    } else if (object.lockObject.type === "PROG/I") {
      // Includes: Use siblings to find parent and other includes
      relatedObjects = (await this.siblings(object, uri)) || []
    } else {
      // Classes and other objects: Use original siblings logic
      relatedObjects = (await this.siblings(object, uri)) || []
    }

    // If we have inactive related objects, show selection dialog BEFORE main activation
    if (relatedObjects.length > 1) {
      // Show user selection dialog for which objects to activate
      const selectedObjects = interactive
        ? await this.showActivationSelectionDialog(relatedObjects)
        : relatedObjects

      if (selectedObjects && selectedObjects.length > 0) {
        // Activate all selected objects (including main object)
        result = await this.client.activate(selectedObjects)
      } else {
        // User cancelled - don't activate anything, return a cancelled result
        return {
          success: false,
          messages: [{ shortText: "Activation cancelled by user" }],
          inactive: relatedObjects
        }
      }
    } else {
      // No inactive related objects found, or only one object, just activate the main object
      result = await this.client.activate(name, path, mainProg, true)

      // If main activation failed, try the fallback logic for any objects returned in the error
      if (!result.success) {
        let fallbackObjects: any[] = []

        if (object.lockObject.type === "PROG/P") {
          // For main programs, we already checked getRelatedInactiveObjects above
          fallbackObjects = relatedObjects
        } else {
          // Classes, includes, and other objects: Use inactive objects from the failed result
          if (result.inactive.length > 0) {
            fallbackObjects = inactiveObjectsInResults(result)
          } else {
            fallbackObjects = relatedObjects
          }
        }

        if (fallbackObjects.length > 1) {
          // Show user selection dialog for which objects to activate
          const selectedObjects = await this.showActivationSelectionDialog(fallbackObjects)

          if (selectedObjects && selectedObjects.length > 0) {
            result = await this.client.activate(selectedObjects)
          }
        } else if (fallbackObjects.length === 1) {
          // Only one object (probably just the main object), activate it directly
          result = await this.client.activate(fallbackObjects)
        }
      }
    }

    return result
  }

  public async activate(
    object: AbapObject,
    uri: Uri,
    interactive = true
  ): Promise<{ ok: boolean; summary?: string }> {
    const inactive = object.lockObject

    try {
      const result = await this.tryActivate(object, uri, interactive)
      const mainProg = await this.getMain(object, uri)

      if (result && result.success) {
        //log(`✅ ACTIVATE SUCCESS: firing event and loading structure`)
        this.emitter.fire({ object, uri, activated: inactive, mainProg })
        await inactive.loadStructure(true)
        return { ok: true }
      } else {
        return this.summarizeFailure(result, object.name)
      }
    } catch (error) {
      // Enhanced error handling: surface ADT response body/status when present
      if (isAdtError(error)) {
        const status = error.response?.status || error.type || "ADT error"
        const body = error.response?.body || error.message || ""
        const bodyText = typeof body === "string" ? body : JSON.stringify(body)
        const trimmed = bodyText.length > 800 ? `${bodyText.slice(0, 800)}…` : bodyText
        logError(`❌ Activation ADT error status=${status} body=${trimmed}`)
        return { ok: false, summary: `Activation failed (${status}): ${trimmed}` }
      }

      const errorMessage = (error as Error).message || String(error)
      logError(`❌ Activation error: ${errorMessage}`)
      if (errorMessage.includes("ECONNRESET") || errorMessage.includes("timeout")) {
        return {
          ok: false,
          summary: `Connection lost during activation. Please reconnect to SAP and try again.`
        }
      } else if (errorMessage.includes("401") || errorMessage.includes("403")) {
        return {
          ok: false,
          summary: `Authentication failed. Please reconnect to SAP and try again.`
        }
      } else {
        return { ok: false, summary: errorMessage }
      }
    }
  }
}
