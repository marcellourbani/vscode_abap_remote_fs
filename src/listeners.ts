import { TextEditor, commands } from "vscode"

import { fromUri } from "./adt/AdtServer"

export async function activeTextEditorChangedListener(
  editor: TextEditor | undefined
) {
  try {
    if (editor && editor.document.uri.scheme === "adt") {
      const server = fromUri(editor.document.uri)
      const obj = await server.findAbapObject(editor.document.uri)
      if (obj.metaData && obj.metaData.version === "inactive") {
        commands.executeCommand("setContext", "abapfs:objectInactive", true)
        return
      }
    }
  } catch (e) {}
  commands.executeCommand("setContext", "abapfs:objectInactive", false)
}
