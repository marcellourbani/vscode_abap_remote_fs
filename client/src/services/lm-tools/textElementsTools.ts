import * as vscode from "vscode"
import { funWindow as window } from "../funMessenger"
import { logCommands } from "../abapCopilotLogger"
import { session_types } from "abap-adt-api"
import { logTelemetry } from "../telemetry"
import { getClient, abapUri } from "../../adt/conections"
import {
  getTextElementsSafe,
  updateTextElementsWithTransport,
  type TextElement,
  type TextElementCategory
} from "../../adt/textElements"
import { assertToolInvocationAuthorized } from "./toolGuard"

// Text Elements Tool Interfaces
export interface IManageTextElementsParameters {
  objectName: string // Name of the ABAP object
  objectType: "PROGRAM" | "CLASS" | "FUNCTION_GROUP" // Type of object (mandatory for Language Model Tool - Copilot provides this)
  category?: TextElementCategory
  action: ToolAction
  textElements?: TextElementInput[]
  connectionId?: string
}

type ToolAction = "read" | "create" | "update" | "delete"
type ModifyAction = Exclude<ToolAction, "read">
type TextElementInput = { id: string; text?: string; maxLength?: number }

interface ChangePlan {
  finalTextElements: TextElement[]
  targetElements: TextElement[]
}

const ACTION_LABELS: Record<ToolAction, { title: string; invoking: string; past: string }> = {
  read: { title: "Read", invoking: "Reading", past: "Read" },
  create: { title: "Create", invoking: "Creating", past: "Created" },
  update: { title: "Update", invoking: "Updating", past: "Updated" },
  delete: { title: "Delete", invoking: "Deleting", past: "Deleted" }
}

function isModifyAction(action: string): action is ModifyAction {
  return action === "create" || action === "update" || action === "delete"
}

function isToolAction(action: string): action is ToolAction {
  return action === "read" || isModifyAction(action)
}

function invalidActionMessage(action: string): string {
  return `Invalid action: ${action}. Must be 'read', 'create', 'update', or 'delete'`
}

function isTextElementsApiUnsupported(error: unknown): boolean {
  const message = String(error)
  return message.includes("Resource") && message.includes("does not exist")
}

function unsupportedMessage(connectionId: string, objectName: string): string {
  return (
    `ADT text elements API is not available on system ${connectionId.toUpperCase()}. ` +
    `Nothing was changed and SE38 was not opened. ` +
    `Ask the user whether to open ${objectName} in SE38 in the browser. ` +
    `Only if they say yes, call abapfs_get_sap_webgui_url with connectionId "${connectionId}" and transaction "SE38". ` +
    `In SE38 use Goto > Text Elements.`
  )
}

// SAP stores text pool keys in uppercase; the ADT write uppercases them too
function normalizeId(id: string): string {
  return id.trim().toUpperCase()
}

function assertElementsForAction(
  action: ModifyAction,
  elements: TextElementInput[] | undefined
): void {
  if (!elements || elements.length === 0) {
    throw new Error(`Text elements array is required for ${action} operations`)
  }
  if (elements.some(el => typeof el.id !== "string" || el.id.trim() === "")) {
    throw new Error(`Each text element needs an id for ${action} operations`)
  }
  if (action === "delete") return

  const missing = elements.find(el => typeof el.text !== "string" || el.text.trim() === "")
  if (missing) {
    throw new Error(`Text is required for ${action} operations; element ${missing.id} has no text`)
  }

  const seen = new Set<string>()
  for (const el of elements) {
    const id = normalizeId(el.id)
    if (seen.has(id)) {
      throw new Error(`Duplicate text element ID: ${id}`)
    }
    seen.add(id)
  }
}

function planDelete(existing: TextElement[], inputs: TextElementInput[]): ChangePlan {
  const idsToDelete = new Set(inputs.map(el => el.id))
  return {
    finalTextElements: existing.filter(el => !idsToDelete.has(normalizeId(el.id))),
    targetElements: existing.filter(el => idsToDelete.has(normalizeId(el.id)))
  }
}

function planMerge(existing: TextElement[], writes: TextElement[]): ChangePlan {
  const writesById = new Map(writes.map(el => [el.id, el]))
  const existingIds = new Set(existing.map(el => normalizeId(el.id)))
  const merged = existing.map(el => writesById.get(normalizeId(el.id)) ?? el)
  const added = writes.filter(el => !existingIds.has(el.id))
  return { finalTextElements: [...merged, ...added], targetElements: writes }
}

/**
 * � MANAGE TEXT ELEMENTS TOOL - Unified tool for read/create/update text elements
 */
export class ManageTextElementsTool implements vscode.LanguageModelTool<IManageTextElementsParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IManageTextElementsParameters>,
    _token: vscode.CancellationToken
  ) {
    const {
      objectName,
      objectType,
      category = "symbols",
      action,
      textElements,
      connectionId
    } = options.input

    if (!isToolAction(action)) {
      throw new Error(invalidActionMessage(action))
    }
    if (isModifyAction(action)) {
      assertElementsForAction(action, textElements)
    }
    const labels = ACTION_LABELS[action]

    let message = `**Action:** ${action.toUpperCase()}\n**Object:** ${objectName}`
    if (objectType) {
      message += `\n**Type:** ${objectType}`
    }
    message += `\n**Category:** ${category}`
    message += `\n**Connection:** ${connectionId || "auto-detect"}`
    if (action === "create" && category !== "symbols") {
      message += `\n**Note:** ${category} can only be updated; new entries cannot be created.`
    }

    if (isModifyAction(action)) {
      message += `\n**Text Elements:** ${textElements?.length || 0}`
      message +=
        "\n\n **Best Practice:** Always read existing text elements first to avoid duplicates and to know which text IDs are already in use."
      if (action === "update") {
        message += "\n\n **This will modify existing text elements in the SAP system.**"
      }
      if (action === "delete") {
        message += "\n\n **This will delete existing text elements in the SAP system.**"
      }
    }

    const confirmationMessages = {
      title: `${labels.title} Text Elements`,
      message: new vscode.MarkdownString(message)
    }

    return {
      invocationMessage: `${labels.invoking} text elements for ${objectType ? objectType + " " : ""}${objectName}...`,
      confirmationMessages
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IManageTextElementsParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    let {
      objectName,
      objectType,
      category = "symbols",
      action,
      textElements,
      connectionId
    } = options.input
    logTelemetry("tool_manage_text_elements_called", { connectionId })

    if (action === "create" && category !== "symbols") {
      throw new Error(
        `Cannot create ${category} text elements. ${category} supports update only; use action "update" for existing entries.`
      )
    }
    if (isModifyAction(action)) {
      assertElementsForAction(action, textElements)
    }

    // 🚫 FORCE READ ACTION ONLY - Create/Update disabled due to lock handle issues
    // if (action === 'create' || action === 'update') {
    //  // logCommands.info(`⚠️ Text Elements Tool: ${action} action disabled, forcing READ action instead`);
    //   action = 'read'; // Force to read action
    // }

    // Ensure connectionId is lowercase for consistency
    if (connectionId) {
      connectionId = connectionId.toLowerCase()
    }
    // logCommands.info(`📖 Manage Text Elements Tool: ${action} for ${objectName}`);

    try {
      // Connection and text elements API imported statically at module top

      // Resolve connectionId - same pattern as other language model tools
      let actualConnectionId = connectionId

      // If no connectionId provided, try to get from active editor
      if (!actualConnectionId) {
        const activeEditor = window.activeTextEditor
        if (!activeEditor || !abapUri(activeEditor.document.uri)) {
          throw new Error(
            "No active ABAP document and no connectionId provided. Please open an ABAP file or provide connectionId parameter."
          )
        }
        actualConnectionId = activeEditor.document.uri.authority
      }

      const stateless_clone = action === "read" ? true : false
      // Get connection - stateless clone for read and stateful client for create/update
      const client = getClient(actualConnectionId, stateless_clone)
      if (!client) {
        throw new Error("No ADT connection available. Please connect to an SAP system first.")
      }

      if (action === "read") {
        return await this.handleRead(client, objectName, objectType, category, actualConnectionId)
      }
      if (!isModifyAction(action)) {
        throw new Error(invalidActionMessage(action))
      }

      const plan = await this.planChanges(
        client,
        objectName,
        objectType,
        category,
        action,
        (textElements ?? []).map(el => ({ ...el, id: normalizeId(el.id) })),
        actualConnectionId
      )
      if (plan.targetElements.length === 0) {
        return this.handleNoMatch(objectName, action)
      }

      client.stateful = session_types.stateful
      return await this.handleModify(client, objectName, objectType, category, plan, action)
    } catch (error) {
      logCommands.error(` Manage Text Elements Tool error: ${error}`)
      throw new Error(`Failed to ${action} text elements: ${String(error)}`)
    }
  }

  private async handleRead(
    client: any,
    objectName: string,
    objectType: string | undefined,
    category: TextElementCategory,
    connectionId: string
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      // Use explicit object type when provided, fallback to detection when not
      const result = await getTextElementsSafe(client, objectName, objectType, category)

      let resultText = `Text Elements for ${result.programName}\n`
      resultText += `Object: ${result.programName} | Total: ${result.textElements.length}\n\n`

      if (result.textElements.length > 0) {
        resultText += `Elements:\n`
        result.textElements.forEach(element => {
          const maxLengthInfo = element.maxLength ? ` (max: ${element.maxLength})` : ""
          resultText += `• ${element.id}: "${element.text}"${maxLengthInfo}\n`
        })
      } else {
        resultText += `No text elements found — this program has none defined.`
      }

      // logCommands.info(`✅ Read Text Elements: Found ${result.textElements.length} text elements`);

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(resultText)])
    } catch (error) {
      if (isTextElementsApiUnsupported(error)) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(unsupportedMessage(connectionId, objectName))
        ])
      }
      throw error
    }
  }

  private async planChanges(
    client: any,
    objectName: string,
    objectType: string | undefined,
    category: TextElementCategory,
    action: ModifyAction,
    inputs: TextElementInput[],
    connectionId: string
  ): Promise<ChangePlan> {
    // SAP replaces the whole text pool on write, so an unknown current state must not be written
    let existing: TextElement[]
    try {
      existing = (await getTextElementsSafe(client, objectName, objectType, category)).textElements
    } catch (error) {
      if (isTextElementsApiUnsupported(error)) {
        throw new Error(unsupportedMessage(connectionId, objectName))
      }
      throw new Error(
        `Could not read existing text elements for ${action} operation; SAP was not changed: ${error}`
      )
    }

    if (action === "delete") return planDelete(existing, inputs)

    const existingIds = new Set(existing.map(el => normalizeId(el.id)))
    const duplicate = inputs.find(el => existingIds.has(el.id))
    if (action === "create" && duplicate) {
      throw new Error(
        `Text element ${duplicate.id} already exists; use action "update" to change it`
      )
    }
    const unknown = inputs.find(el => !existingIds.has(el.id))
    if (action === "update" && unknown) {
      throw new Error(`Text element ${unknown.id} does not exist; use action "create" to add it`)
    }
    return planMerge(existing, inputs as TextElement[])
  }

  private handleNoMatch(objectName: string, action: ModifyAction): vscode.LanguageModelToolResult {
    const resultText = `No matching text elements to ${action} in ${objectName}. SAP was not changed.`
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(resultText)])
  }

  private async handleModify(
    client: any,
    objectName: string,
    objectType: string | undefined,
    category: TextElementCategory,
    plan: ChangePlan,
    action: ModifyAction
  ): Promise<vscode.LanguageModelToolResult> {
    // Transport-aware function imported statically at module top
    await updateTextElementsWithTransport(
      client,
      objectName,
      plan.finalTextElements,
      objectType,
      category
    )

    const { targetElements } = plan
    // Headings and selection texts keep their SAP entry on delete; only the text is cleared
    const past =
      action === "delete" && category !== "symbols" ? "Cleared" : ACTION_LABELS[action].past

    let resultText = `Text Elements ${past} for ${objectName}\n`
    resultText += `Object: ${objectName} | ${past}: ${targetElements.length}\n\n`

    resultText += `${past} elements:\n`
    targetElements.forEach(element => {
      const maxLengthInfo = element.maxLength ? ` (max: ${element.maxLength})` : ""
      resultText += `• ${element.id}: "${element.text}"${maxLengthInfo}\n`
    })

    if (action !== "delete" && category === "symbols") {
      resultText += `\nSuccess. Next: update ABAP code to use these elements:`
      targetElements.forEach(element => {
        resultText += `\n• Replace hardcoded text with: TEXT-${element.id}`
      })
    }

    logCommands.info(
      ` ${action} Text Elements: Successfully processed ${targetElements.length} text elements`
    )

    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(resultText)])
  }
}
