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

interface ActivateInput {
  url: string
}

export class ActivateTool implements LanguageModelTool<ActivateInput> {
  async invoke(
    options: LanguageModelToolInvocationOptions<ActivateInput>,
    token: CancellationToken
  ): Promise<LanguageModelToolResult> {
    const { url } = options.input
    const uri = Uri.parse(url)
    await window.withProgress(
      { location: ProgressLocation.Window, title: "Activating..." },
      async () => {
        const [path] = await uriRoot(uri).getNodePathAsync(uri.path)
        const object = isAbapFile(path?.file) && path?.file?.object
        if (!object) throw new Error("Failed to retrieve object for activation")
        const activator = AdtObjectActivator.get(uri.authority)
        await activator.activate(object, uri)
      }
    )
    const contentText = [`Activation successful for ${url}`]
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
