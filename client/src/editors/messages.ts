import {
  CustomTextEditorProvider,
  TextDocument,
  WebviewPanel,
  CancellationToken,
  ExtensionContext,
  window,
  Webview,
  Uri,
  ViewColumn
} from "vscode"
import { XMLParser } from "fast-xml-parser"
import { decode } from "html-entities"
import path from "path"
import { getClient } from "../adt/conections"

const parser = new XMLParser({
  parseAttributeValue: true,
  ignoreAttributes: false
})
const xmlNode = (xml: any, ...xmlpath: string[]) => {
  xmlpath = xmlpath.flatMap(x => x.split("/")).filter(x => x)
  let cur = xml
  for (const p of xmlpath) cur = cur && cur[p]
  return cur
}

const xmlArray = (xml: any, ...xmlpath: string[]) => {
  const target = xmlNode(xml, ...xmlpath)
  if (!target) return []
  return Array.isArray(target) ? target : [target]
}

const parseMessages = (source: string) => {
  const raw = parser.parse(source)
  const rawMessages = xmlArray(raw, "mc:messageClass", "mc:messages")
  return rawMessages.map(m => {
    const link = xmlArray(m, "atom:link").find(
      l =>
        l["@_rel"] ===
        "http://www.sap.com/adt/relations/messageclasses/messages/longtext"
    )?.["@_href"]
    return {
      number: m["@_mc:msgno"],
      text: decode(m["@_mc:msgtext"]),
      selfexplainatory: m["@_mc:selfexplainatory"],
      link
    }
  })
}

export class MessagesProvider implements CustomTextEditorProvider {
  public static register(context: ExtensionContext) {
    const provider = new MessagesProvider(context)
    return window.registerCustomEditorProvider("abapfs.msagn", provider)
  }
  constructor(private context: ExtensionContext) { }
  resolveCustomTextEditor(
    document: TextDocument,
    panel: WebviewPanel,
    token: CancellationToken
  ) {
    panel.webview.options = { enableScripts: true, enableCommandUris: true }
    panel.webview.onDidReceiveMessage(async message => {
      if (message?.type === "doc" && message?.url) {
        const client = getClient(document.uri.authority)
        const contents = await client.httpClient.request(message.url)
        // const contents = await contentsP

        window.createWebviewPanel(
          "LONGTEXT",
          "ABAP message long text",
          ViewColumn.Beside
        ).webview.html = contents.body
      }
    })

    panel.webview.html = this.toHtml(panel.webview, document.getText())
  }
  private toHtml(webview: Webview, source: string) {
    const header = `<tr><th>number</th><th>text</th><th>self explainatory</th></tr>`
    const body = parseMessages(source)
      .map(m => {
        const mainline = m.link
          ? `<a href=${m.link} onclick="send(event,'${m.link}')">${m.text}</a>`
          : m.text
        return `<tr><td class="number">${m.number}</td>
          <td>${mainline}</td>
          <td class="flag">${m.selfexplainatory ? "\u2713" : ""}</td>
          </tr>`
      })
      .join("\n")

    const styleUri = webview.asWebviewUri(
      Uri.file(
        path.join(this.context.extensionPath, "client/media", "editor.css")
      )
    )

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
    <title>Message Class</title>
    <link href="${styleUri}" rel="stylesheet" />
    <script>
    const vscode = acquireVsCodeApi();
    function send(event,url){
        event.preventDefault();
        vscode.postMessage({type:"doc",url});
    }
    </script></head>
    <body>
    <table><thead>${header}</thead>
    <tbody>${body}</tbody>
    </table></body></html>`
  }
}
