import {
  TextEditor,
  commands,
  TextDocumentChangeEvent,
  TextDocument,
  window,
  Uri,
  Disposable,
  Event,
  TextDocumentWillSaveEvent
} from "vscode"

import { fromUri, ADTSCHEME, AdtServer } from "./adt/AdtServer"
import { setDocumentLock, LockManager } from "./adt/operations/LockManager"
import { AbapObject } from "./adt/abap/AbapObject"
import { clearUTResultsIfLastRun } from "./adt/operations/UnitTestRunner"
import { IncludeLensP } from "./adt/operations/IncludeLens"
import { debounce } from "./helpers/functions"

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

// debouncing is important for an edge case:
// if the object is modified but not locked, undoing the changes and restoring the editor
// would result in an attempt to lock (perhaps with an error or a request to select a transport)
// followed by an unlock request after a few milliseconds
// after debouncing it will only process the last status
const doclock = debounce(200, async (document: TextDocument) => {
  try {
    await setDocumentLock(document, true)
  } finally {
    const editor = window.activeTextEditor
    if (editor && editor.document === document) showHideActivate(editor)
  }
})

export async function documentChangedListener(event: TextDocumentChangeEvent) {
  const uri = event.document.uri
  if (uri.scheme !== ADTSCHEME) return
  // only need to (un)lock if the isDirty flag changed, which implies a status change without edits
  // will call anyway if dirty as locking is mandatory for saving
  if (event.contentChanges.length === 0 || event.document.isDirty)
    doclock(event.document)
}
// if the document is dirty it's probably locked already. If not, lock it
export async function documentWillSave(e: TextDocumentWillSaveEvent) {
  const uri = e.document.uri
  if (uri.scheme !== ADTSCHEME) return
  if (!e.document.isDirty)
    await setDocumentLock({ ...e.document, isDirty: true }, true)
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

export async function showHideActivate(editor?: TextEditor, refresh = false) {
  let shouldShow = false
  const uri = editor && editor.document.uri
  if (editor && uri && uri.scheme === ADTSCHEME)
    try {
      shouldShow =
        editor.document.isDirty &&
        (await LockManager.get().isLockedAsync(editor.document.uri))
      if (!shouldShow) {
        const server = fromUri(uri)
        const obj = await server.findAbapObject(uri)
        if (refresh) await obj.loadMetadata(server.client)
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
