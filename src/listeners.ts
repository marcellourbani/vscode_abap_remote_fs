import {
  TextEditor,
  commands,
  window,
  StatusBarAlignment,
  TextDocumentChangeEvent,
  TextDocument
} from "vscode"

import { fromUri } from "./adt/AdtServer"

const status = window.createStatusBarItem(StatusBarAlignment.Right, 100)

export async function documentClosedListener(doc: TextDocument) {
  const uri = doc.uri
  if (uri.scheme === "adt") {
    const server = fromUri(uri)
    const obj = await server.findAbapObject(uri)
    if (server.lockManager.isLocked(obj)) await server.lockManager.unlock(obj)
  }
}

export async function documentChangedListener(event: TextDocumentChangeEvent) {
  const uri = event.document.uri
  if (uri.scheme === "adt") {
    const server = fromUri(uri)
    const obj = await server.findAbapObject(uri)
    const shouldLock = event.document.isDirty
    //no need to lock objects already locked
    if (shouldLock !== server.lockManager.isLocked(obj)) {
      if (shouldLock) {
        try {
          await server.lockManager.lock(obj)
        } catch (e) {
          window.showErrorMessage(
            `Object not locked ${obj.type} ${
              obj.name
            }.Won't be able to save changes`
          )
        }
      } else await server.lockManager.unlock(obj)
    }

    status.text = `${uri.authority}:${
      server.lockManager.lockedObjects.length
    } objects locked`
    status.show()
  }
}
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
