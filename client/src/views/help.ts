import { window, ViewColumn, Uri } from "vscode"
import { ADTSCHEME, fromUri } from "../adt/AdtServer"
const ABAPDOC = "ABAPDOC"
const jsHeader = `<script type="text/javascript">
const vscode = acquireVsCodeApi();
function abapClick(uri) {
    vscode.postMessage({
        command: 'click',
        uri: uri
    });
};
</script>`

const inject = (x: string) =>
  x
    .replace(/<head>/i, `<head>${jsHeader}`)
    .replace(/href\s*=\s*("[^"]*")/gi, "onClick='abapClick($1)'")

export async function showAbapDoc() {
  const editor = window.activeTextEditor
  if (!editor) return
  const uri = editor.document.uri
  const sel = editor.selection.active
  if (uri.scheme !== ADTSCHEME) return
  const server = fromUri(uri)
  const obj = await server.findAbapObject(uri)
  const doc = await server.client
    .abapDocumentation(
      obj.path,
      editor.document.getText(),
      sel.line + 1,
      sel.character + 1
    )
    .then(inject)
  const panel = window.createWebviewPanel(
    ABAPDOC,
    "ABAP documentation",
    ViewColumn.Beside,
    {
      enableScripts: true
    }
  )

  panel.webview.onDidReceiveMessage(async message => {
    switch (message.command) {
      case "click":
        const url = Uri.parse(message.uri)
        const text = await server.client.httpClient.request(
          `${url.path}?${url.query}`
        )
        panel.webview.html = inject(text.body)
    }
  }, undefined)

  panel.webview.html = doc
}
