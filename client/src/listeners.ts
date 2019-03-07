import {
  TextEditor,
  commands,
  TextDocumentChangeEvent,
  TextDocument,
  window
} from "vscode"

import { fromUri, ADTSCHEME } from "./adt/AdtServer"
import { setDocumentLock } from "./adt/operations/LockManager"
import { manageIncludes } from "./langClient"
import { AbapObject } from "./adt/abap/AbapObject"

export async function documentClosedListener(doc: TextDocument) {
  const uri = doc.uri
  if (uri.scheme === ADTSCHEME) {
    const server = fromUri(uri)
    const obj = await server.findAbapObject(uri)
    if (server.lockManager.isLocked(obj)) await server.lockManager.unlock(obj)
  }
}

export async function documentChangedListener(event: TextDocumentChangeEvent) {
  const uri = event.document.uri
  if (uri.scheme === ADTSCHEME) {
    const server = fromUri(uri)
    const obj = await server.findAbapObject(uri)
    return setDocumentLock(event.document).then(locked =>
      commands.executeCommand(
        "setContext",
        "abapfs:showActivate",
        isInactive(obj) || (event.document.isDirty && locked)
      )
    )
  }
}

export function documentOpenListener(document: TextDocument) {
  const uri = document.uri
  if (uri.scheme === ADTSCHEME) manageIncludes(uri, true)
}

function isInactive(obj?: AbapObject): boolean {
  return !!(
    obj &&
    obj.structure &&
    obj.structure.metaData["adtcore:version"] === "inactive"
  )
}
export async function showHideActivate(editor?: TextEditor, obj?: AbapObject) {
  if (editor && obj)
    try {
      // race condition, active editor might have changed while async operation was pending
      if (editor !== window.activeTextEditor) return
      if (editor && editor.document.uri.scheme === ADTSCHEME) {
        if (editor.document.isDirty || isInactive(obj)) {
          await commands.executeCommand(
            "setContext",
            "abapfs:showActivate",
            true
          )
          return
        }
      }
    } catch (e) {
      // ignore
    }
  await commands.executeCommand("setContext", "abapfs:showActivate", false)
}
export async function activeTextEditorChangedListener(
  editor: TextEditor | undefined
) {
  try {
    if (editor && editor.document.uri.scheme === ADTSCHEME) {
      const server = fromUri(editor.document.uri)
      const obj = await server.findAbapObject(editor.document.uri)
      await showHideActivate(editor, obj)
    }
  } catch (e) {
    await showHideActivate() // reset
  }
}
