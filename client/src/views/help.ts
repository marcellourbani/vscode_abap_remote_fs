import { window, ViewColumn, Uri } from "vscode"
import { ADTSCHEME, getClient } from "../adt/conections"
import { AdtObjectFinder, findAbapObject } from "../adt/operations/AdtObjectFinder"
import { injectUrlHandler } from "./utilities"
const ABAPDOC = "ABAPDOC"

export async function showAbapDoc() {
  const editor = window.activeTextEditor
  if (!editor) return
  const uri = editor.document.uri
  const sel = editor.selection.active
  if (uri.scheme !== ADTSCHEME) return
  const client = getClient(uri.authority)
  const obj = await findAbapObject(uri)
  const doc = await client
    .abapDocumentation(
      obj.path,
      editor.document.getText(),
      sel.line + 1,
      sel.character + 1
    )
    .then(injectUrlHandler)
  const panel = window.createWebviewPanel(
    ABAPDOC,
    "ABAP documentation",
    ViewColumn.Beside,
    {
      enableScripts: true, enableFindWidget: true
    }
  )

  panel.webview.onDidReceiveMessage(async message => {
    switch (message.command) {
      case "click":
        const url = Uri.parse(message.uri)
        if (url.scheme.toLowerCase() === "adt") {
          new AdtObjectFinder(uri.authority).displayAdtUri(message.uri)
        }
        else {
          const text = await client.httpClient.request(`${url.path}?${url.query}`)
          panel.webview.html = injectUrlHandler(text.body)
        }
    }
  }, undefined)

  panel.webview.html = doc
}
