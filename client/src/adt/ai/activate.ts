import {
  type CancellationToken,
  LanguageModelTextPart,
  type LanguageModelTool,
  type LanguageModelToolInvocationOptions,
  type LanguageModelToolInvocationPrepareOptions,
  LanguageModelToolResult,
  type PreparedToolInvocation,
  type ProviderResult,
  Uri,
  window
} from "vscode"
import { getClient, getOrCreateRoot } from "../conections"
import { AdtObjectActivator, type MultipleActivationResult } from "../operations/AdtObjectActivator"
import { logTelemetry } from "../../services/telemetry"
import { assertToolInvocationAuthorized } from "../../services/lm-tools/toolGuard"
import { showHideActivate } from "../../listeners"

interface ActivateInput {
  action: "get_inactive_objects" | "activate"
  connectionId: string
  regex?: string
  urls?: string[]
}

export class ActivateTool implements LanguageModelTool<ActivateInput> {
  private result(value: unknown) {
    return new LanguageModelToolResult([
      new LanguageModelTextPart(JSON.stringify(value, undefined, 2))
    ])
  }

  private async formatObject(
    object: {
      "adtcore:uri": string
      "adtcore:type": string
      "adtcore:name": string
      "adtcore:parentUri": string
      user: string
      deleted: boolean
    },
    connectionId: string
  ) {
    let workspaceUri: string | undefined
    try {
      const node = await (
        await getOrCreateRoot(connectionId)
      ).findByAdtUri(object["adtcore:uri"], false)
      if (node?.path)
        workspaceUri = Uri.from({
          scheme: "adt",
          authority: connectionId,
          path: node.path
        }).toString()
    } catch {
      // An unmapped inactive object remains visible, but cannot be correlated for guarded apply.
    }
    return {
      name: object["adtcore:name"],
      type: object["adtcore:type"],
      uri: object["adtcore:uri"],
      url: Uri.from({
        scheme: "adt",
        authority: connectionId,
        path: object["adtcore:uri"]
      }).toString(),
      workspaceUri,
      parentUri: object["adtcore:parentUri"],
      user: object.user,
      deleted: object.deleted
    }
  }

  private async getInactiveObjects(input: ActivateInput) {
    const objects = await AdtObjectActivator.get(input.connectionId).getInactiveObjects()
    let filtered = objects

    if (input.regex) {
      let regex: RegExp
      try {
        regex = new RegExp(input.regex, "i")
      } catch (error) {
        throw new Error(`Invalid regex: ${(error as Error).message}`)
      }
      filtered = objects.filter(object => regex.test(object["adtcore:name"]))
    }

    return this.result({
      action: "get_inactive_objects",
      connectionId: input.connectionId,
      count: filtered.length,
      objects: await Promise.all(
        filtered.map(object => this.formatObject(object, input.connectionId))
      )
    })
  }

  private pathsForActivation(input: ActivateInput) {
    if (!input.urls?.length) {
      throw new Error("urls must contain at least one ADT URL for the activate action")
    }

    return input.urls.map(url => {
      const uri = Uri.parse(url)
      if (uri.scheme !== "adt") {
        throw new Error(`Activation URL must use the adt scheme: ${url}`)
      }
      if (uri.authority.toLowerCase() !== input.connectionId.toLowerCase()) {
        throw new Error(
          `Activation URL belongs to connection ${uri.authority}, not ${input.connectionId}: ${url}`
        )
      }
      return uri.path
    })
  }

  private async activationResult(result: MultipleActivationResult, connectionId: string) {
    const remainingUris = new Set(result.stillInactiveObjects.map(object => object["adtcore:uri"]))
    const activatedObjects = result.selectedObjects.filter(
      object => !remainingUris.has(object["adtcore:uri"])
    )

    return this.result({
      action: "activate",
      status: result.ok ? "success" : "failed",
      summary: result.summary,
      activatedObjects: await Promise.all(
        activatedObjects.map(object => this.formatObject(object, connectionId))
      ),
      ...(result.stillInactiveObjects.length
        ? {
            stillInactiveObjects: await Promise.all(
              result.stillInactiveObjects.map(object => this.formatObject(object, connectionId))
            )
          }
        : {}),
      ...(result.relatedStillInactive.length
        ? {
            relatedStillInactive: await Promise.all(
              result.relatedStillInactive.map(object => this.formatObject(object, connectionId))
            )
          }
        : {}),
      notInactiveUris: result.notInactiveUris,
      details: result.details
    })
  }

  async invoke(
    options: LanguageModelToolInvocationOptions<ActivateInput>,
    token: CancellationToken
  ): Promise<LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    logTelemetry("tool_abap_activate_called")
    const input = options.input
    if (!getClient(input.connectionId)) {
      throw new Error(`No ABAP filesystem registered for ${input.connectionId}`)
    }

    if (input.action === "get_inactive_objects") {
      return this.getInactiveObjects(input)
    }

    if (input.action !== "activate") {
      throw new Error(`Unsupported activation action: ${input.action}`)
    }

    const paths = this.pathsForActivation(input)
    const result = await AdtObjectActivator.get(input.connectionId).activateMultiple(false, paths)
    showHideActivate(window.activeTextEditor, true)
    return await this.activationResult(result, input.connectionId)
  }

  prepareInvocation?(
    options: LanguageModelToolInvocationPrepareOptions<ActivateInput>,
    token: CancellationToken
  ): ProviderResult<PreparedToolInvocation> {
    const { action, connectionId, urls } = options.input
    const client = getClient(connectionId)
    if (client)
      return {
        invocationMessage:
          action === "get_inactive_objects"
            ? `Loading inactive objects from ${connectionId}`
            : `Activating ${urls?.length || 0} object(s) in ${connectionId}`
      }
    throw new Error(`No ABAP filesystem registered for ${connectionId}`)
  }
}
