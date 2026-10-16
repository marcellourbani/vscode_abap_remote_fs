import * as vscode from "vscode"
import { getAbapObjectTransportStatus } from "../objectTransportStatusService"
import { TransportIntentService, type ObjectSaveTransportChoice } from "../transportIntentService"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { registerToolWithRegistry } from "./toolRegistry"

export interface SetTransportForNextObjectSaveInput {
  objectUri: string
  transportChoice: Exclude<ObjectSaveTransportChoice, { type: "local" }>
}

export class SetTransportForNextObjectSaveTool implements vscode.LanguageModelTool<SetTransportForNextObjectSaveInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<SetTransportForNextObjectSaveInput>
  ) {
    const choice = options.input.transportChoice
    const label =
      choice.type === "existing"
        ? `existing request ${choice.number}`
        : `a new request with description "${choice.description}"`
    return {
      invocationMessage: `Setting transport for the next save of ${options.input.objectUri}`,
      confirmationMessages: {
        title: "Set Transport for Next ABAP Object Save",
        message: new vscode.MarkdownString(
          `Use ${label} for the next save of \`${options.input.objectUri}\`? ` +
            "The transport will be validated again when the file is written."
        )
      }
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<SetTransportForNextObjectSaveInput>
  ) {
    assertToolInvocationAuthorized(options)
    const uri = vscode.Uri.parse(options.input.objectUri)
    if (uri.scheme !== "adt") throw new Error("objectUri must use the adt:// scheme")
    const connectionId = uri.authority.trim().toLowerCase()
    if (!connectionId) throw new Error("objectUri must include the SAP connection")
    const status = await getAbapObjectTransportStatus({
      connectionId,
      source: uri.toString()
    })
    if (status.status === "local")
      return toolResult({
        armed: false,
        connectionId,
        objectUri: uri.toString(),
        status: "local",
        message: "The object is local; the supplied transport will be ignored."
      })
    const choice = options.input.transportChoice
    if (status.status === "locked") {
      if (choice.type === "new")
        throw new Error(
          `Cannot create a new transport because the object is already locked to ${status.transportRequest}`
        )
      if (choice.number.trim().toUpperCase() !== status.transportRequest)
        throw new Error(
          `Cannot use ${choice.number}: the object is already locked to ${status.transportRequest}`
        )
    }
    const intent = TransportIntentService.get().register({
      objectUri: uri,
      process: "normal-edit",
      transportChoice: choice
    })
    return toolResult({
      armed: true,
      connectionId,
      objectUri: uri.toString(),
      currentTransportStatus: status,
      intent
    })
  }
}

function toolResult(value: unknown) {
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(JSON.stringify(value, null, 2))
  ])
}

export function registerSetTransportForNextObjectSaveTool(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    registerToolWithRegistry(
      "abapfs_set_transport_for_next_object_save",
      new SetTransportForNextObjectSaveTool()
    )
  )
}
