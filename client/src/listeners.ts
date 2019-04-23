import {
  TextEditor,
  commands,
  TextDocumentChangeEvent,
  TextDocument,
  window,
  Uri,
  Disposable,
  Event
} from "vscode"

import { fromUri, ADTSCHEME, AdtServer } from "./adt/AdtServer"
import { setDocumentLock, LockManager } from "./adt/operations/LockManager"
import { AbapObject } from "./adt/abap/AbapObject"
import { clearUTResultsIfLastRun } from "./adt/operations/UnitTestRunner"
import { IncludeLensP } from "./adt/operations/IncludeLens"

export const listenersubscribers: Array<(...x: any[]) => Disposable> = []

export const listener = <T>(event: Event<T>) => (
  target: any,
  propertyKey: string
) => {
  const func = () => event(target[propertyKey].bind(target))
  listenersubscribers.push(func)
}
export async function documentClosedListener(doc: TextDocument) {
  const uri = doc.uri
  if (uri.scheme === ADTSCHEME) {
    clearUTResultsIfLastRun(doc.uri)
    const server = fromUri(uri)
    if (await LockManager.get().isLockedAsync(uri))
      await LockManager.get().unlock(uri)
  }
}

export async function documentChangedListener(event: TextDocumentChangeEvent) {
  const uri = event.document.uri
  const editor = window.activeTextEditor
  if (uri.scheme !== ADTSCHEME) return
  // only need to (un)lock if the isDirty flag changed, which implies a status change without edits
  // will call anyway if dirty as locking is mandatory for saving
  if (event.contentChanges.length === 0 || event.document.isDirty) {
    try {
      await setDocumentLock(event.document, true)
    } finally {
      if (editor && editor.document === event.document) showHideActivate(editor)
    }
    return
  }
}

export function documentOpenListener(document: TextDocument) {
  const uri = document.uri
  if (uri.scheme !== ADTSCHEME) return
  return IncludeLensP.get().selectIncludeIfNeeded(uri)
}

function isInactive(obj: AbapObject): boolean {
  const inactive = !!(
    obj &&
    obj.structure &&
    obj.structure.metaData["adtcore:version"] === "inactive"
  )
  return inactive
}

export async function showHideActivate(editor?: TextEditor) {
  let shouldShow = false
  const uri = editor && editor.document.uri
  if (editor && uri && uri.scheme === ADTSCHEME)
    try {
      shouldShow =
        editor.document.isDirty &&
        (await LockManager.get().isLockedAsync(editor.document.uri))
      if (!shouldShow) {
        const obj = await fromUri(uri).findAbapObject(uri)
        shouldShow = obj && isInactive(obj)
      }
    } catch (e) {
      shouldShow = false
    }
  // race condition, active editor might have changed while async operation was pending
  if (editor !== window.activeTextEditor) return
  await commands.executeCommand("setContext", "abapfs:showActivate", shouldShow)
}
export async function activationStateListener(uri: Uri) {
  const editor = window.activeTextEditor
  if (editor && editor.document.uri.scheme === ADTSCHEME) {
    const euri = editor.document.uri
    if (uri.path !== euri.path) return
    await showHideActivate(editor)
  }
}

export async function activeTextEditorChangedListener(
  editor: TextEditor | undefined
) {
  try {
    if (editor && editor.document.uri.scheme === ADTSCHEME) {
      const server = fromUri(editor.document.uri)
      const obj = await server.findAbapObject(editor.document.uri)
      await showHideActivate(editor)
    }
  } catch (e) {
    await showHideActivate() // reset
  }
}
