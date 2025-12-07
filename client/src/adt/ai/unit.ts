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
import { getClient, getRoot, uriRoot } from "../conections"
import { isAbapFile } from "abapfs"

interface UnitInput {
  url: string
}

export class UnitTool implements LanguageModelTool<UnitInput> {
  async invoke(
    options: LanguageModelToolInvocationOptions<UnitInput>,
    token: CancellationToken
  ): Promise<LanguageModelToolResult> {
    const { url } = options.input
    const uri = Uri.parse(url)
    const client = getClient(uri.authority)
    const root = getRoot(uri.authority)
    const results = await window.withProgress(
      { location: ProgressLocation.Window, title: "Running ABAP UNIT" },
      async () => {
        const [path] = await uriRoot(uri).getNodePathAsync(uri.path)
        const object = isAbapFile(path?.file) && path.file.object
        if (!object)
          throw new Error("Failed to retrieve object for unit test run")
        const results = await client.unitTestRun(object.path)
        return results
      }
    )
    const contentText = [JSON.stringify(results, null, 2)]
    const content = contentText.map(t => new LanguageModelTextPart(t))
    return new LanguageModelToolResult(content)
  }
  prepareInvocation?(
    options: LanguageModelToolInvocationPrepareOptions<UnitInput>,
    token: CancellationToken
  ): ProviderResult<PreparedToolInvocation> {
    const uri = Uri.parse(options.input.url)
    const client = getClient(uri.authority)
    if (client)
      return {
        invocationMessage: `Running abap unit on ${options.input.url.replace(
          /.*\//,
          ""
        )}`
      }
    throw new Error(`No ABAP filesystem registered for ${uri.authority}`)
  }
}
