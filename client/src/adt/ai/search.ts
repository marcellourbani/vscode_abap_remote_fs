import {
  CancellationToken,
  LanguageModelPromptTsxPart,
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

// {"input":{"name":"ZCL_NOVAAG_OBJECT_SHMA","type":"CLAS/OC","url":"adt://s4h/%24TMP/%24NOVA/Source%20Code%20Library/Classes/ZCL_NOVA_DEPENDENCIES/ZCL_NOVA_DEPENDENCIES.clas.abap"},"chatRequestId":"fd7968b0-1fc3-4f80-8858-f18e4a4451a8","chatSessionId":"47849af1-821e-4f5a-8b1b-9bcf5726b26a"}

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
          name: `${finding["adtcore:type"]} ${finding["adtcore:name"]}`,
          type: "link",
          // name: finding["adtcore:name"],
          // type: finding["adtcore:type"],
          uri: u.toString()
        })
      }
      if (findings.length >= 10) break
    }
    // const contentText = findings.map(f => `[${f.type} ${f.name}](${f.uri})`)
    const contentText = [JSON.stringify(findings, null, 2)]
    contentText.push(
      `The user might want to open one of the found objects in the editor using the adt:// link. show them as links in your final reply`
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
