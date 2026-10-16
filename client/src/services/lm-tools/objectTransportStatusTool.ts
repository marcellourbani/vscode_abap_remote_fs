import * as vscode from "vscode"
import {
  getAbapObjectTransportStatus,
  type ObjectTransportStatusInput
} from "../objectTransportStatusService"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { registerToolWithRegistry } from "./toolRegistry"

class GetObjectTransportStatusTool implements vscode.LanguageModelTool<ObjectTransportStatusInput> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ObjectTransportStatusInput>
  ) {
    return {
      invocationMessage: `Checking target transport status for ${options.input.source} on ${options.input.connectionId}`
    }
  }

  async invoke(options: vscode.LanguageModelToolInvocationOptions<ObjectTransportStatusInput>) {
    assertToolInvocationAuthorized(options)
    const input = {
      ...options.input,
      connectionId: options.input.connectionId.trim().toLowerCase()
    }
    const status = await getAbapObjectTransportStatus(input)
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(JSON.stringify(status, null, 2))
    ])
  }
}

export function registerObjectTransportStatusTool(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    registerToolWithRegistry(
      "abapfs_get_object_transport_status",
      new GetObjectTransportStatusTool()
    )
  )
}
