import {
  TextEditor,
  commands,
  TextDocumentChangeEvent,
  TextDocument
} from "vscode"

import { fromUri, ADTSCHEME } from "./adt/AdtServer"
import { setDocumentLock } from "./adt/operations/LockManager"
import { manageIncludes } from "./langClient"

export async function documentClosedListener(doc: TextDocument) {
  const uri = doc.uri
  if (uri.scheme === ADTSCHEME) {
    const server = fromUri(uri)
    const obj = await server.findAbapObject(uri)
    if (server.lockManager.isLocked(obj)) await server.lockManager.unlock(obj)
  }
}

export async function documentChangedListener(event: TextDocumentChangeEvent) {
  return setDocumentLock(event.document)
}

export function documentOpenListener(document: TextDocument) {
  const uri = document.uri
  if (uri.scheme === ADTSCHEME) manageIncludes(uri, true)
}

export async function activeTextEditorChangedListener(
  editor: TextEditor | undefined
) {
  try {
    if (editor && editor.document.uri.scheme === ADTSCHEME) {
      const server = fromUri(editor.document.uri)
      const obj = await server.findAbapObject(editor.document.uri)
      if (
        obj.structure &&
        obj.structure.metaData["adtcore:version"] === "inactive"
      ) {
        commands.executeCommand("setContext", "abapfs:objectInactive", true)
        return
      }
    }
  } catch (e) {
    // ignore
  }
  commands.executeCommand("setContext", "abapfs:objectInactive", false)
}
