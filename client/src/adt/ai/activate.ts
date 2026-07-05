import {
  CancellationToken,
  LanguageModelTextPart,
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationPrepareOptions,
  LanguageModelToolResult,
  PreparedToolInvocation,
  ProgressLocation,
  ProviderResult,
  Uri,
  window
} from "vscode"
import { getClient, uriRoot } from "../conections"
import { isAbapFile } from "abapfs"
import { AdtObjectActivator } from "../operations/AdtObjectActivator"
import { logTelemetry } from "../../services/telemetry"
import { assertToolInvocationAuthorized } from "../../services/lm-tools/toolGuard"
import { showHideActivate } from "../../listeners"

interface ActivateInput {
  url: string
}

export class ActivateTool implements LanguageModelTool<ActivateInput> {
  async invoke(
    options: LanguageModelToolInvocationOptions<ActivateInput>,
    token: CancellationToken
  ): Promise<LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    logTelemetry("tool_abap_activate_called")
    const { url } = options.input
    const uri = Uri.parse(url)
    const result = await window.withProgress(
      { location: ProgressLocation.Window, title: "Activating..." },
      async () => {
        const [path] = await uriRoot(uri).getNodePathAsync(uri.path)
        const object = isAbapFile(path?.file) && path?.file?.object
        if (!object) throw new Error("Failed to retrieve object for activation")
        const activator = AdtObjectActivator.get(uri.authority)
        const result = await activator.activate(object, uri, false)
        showHideActivate(window.activeTextEditor, true)
        return result
      }
    )
    const contentText = result.ok
      ? [`Activation successful for ${url}`]
      : [`Activation FAILED for ${url}:\n${result.details || result.summary || "Unknown error"}`]
    const content = contentText.map(t => new LanguageModelTextPart(t))
    return new LanguageModelToolResult(content)
  }
  prepareInvocation?(
    options: LanguageModelToolInvocationPrepareOptions<ActivateInput>,
    token: CancellationToken
  ): ProviderResult<PreparedToolInvocation> {
    const uri = Uri.parse(options.input.url)
    const client = getClient(uri.authority)
    if (client)
      return {
        invocationMessage: `Activating ${options.input.url.replace(/.*\//, "")}`
      }
    throw new Error(`No ABAP filesystem registered for ${uri.authority}`)
  }
}
