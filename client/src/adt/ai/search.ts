import {
  CancellationToken,
  LanguageModelTextPart,
  LanguageModelTool,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationPrepareOptions,
  LanguageModelToolResult,
  PreparedToolInvocation,
  ProviderResult,
  Uri
} from "vscode"
import { getClient, getRoot } from "../conections"
import { createUri } from "../operations/AdtObjectFinder"

interface SearchInput {
  name: string
  type: string
  url: string
}

interface SearchFinding {
  name: string
  type: string
  uri: string
}

export class SearchTool implements LanguageModelTool<SearchInput> {
  async invoke(
    options: LanguageModelToolInvocationOptions<SearchInput>,
    token: CancellationToken
  ): Promise<LanguageModelToolResult> {
    const { url, name, type } = options.input
    const uri = Uri.parse(url)
    const client = getClient(uri.authority)
    const root = getRoot(uri.authority)
    const query = `${name.toUpperCase()}*`
    const raw = await client.searchObject(query, type)
    const findings: SearchFinding[] = []
    for (const finding of raw.slice(0, 10)) {
      const node = await root.findByAdtUri(finding["adtcore:uri"], true)
      if (node) {
        const u = createUri(uri.authority, node.path)
        findings.push({
          name: finding["adtcore:name"],
          type: finding["adtcore:type"],
          uri: u.toString()
        })
      }
      if (findings.length >= 10) break
    }
    const contentText = [JSON.stringify(findings, null, 2)]
    contentText.push(
      `**IMPORTANT** Give a succint response but ALWAYS include a proper, clickable link for the user, who might want to open it in the editor using the adt:// urls provided.`
    )
    const content = contentText.map(t => new LanguageModelTextPart(t))
    return new LanguageModelToolResult(content)
  }
  prepareInvocation?(
    options: LanguageModelToolInvocationPrepareOptions<SearchInput>,
    token: CancellationToken
  ): ProviderResult<PreparedToolInvocation> {
    const uri = Uri.parse(options.input.url)
    const client = getClient(uri.authority)
    if (client)
      return {
        invocationMessage: `Searching abap object ${options.input.type || ""} ${
          options.input.name
        } ${uri.authority}`
      }
    throw new Error(`No ABAP filesystem registered for ${uri.authority}`)
  }
}
