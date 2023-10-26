import {
  TextEditor,
  commands,
  TextDocumentChangeEvent,
  TextDocument,
  window,
  Uri,
  Disposable,
  Event,
  TextDocumentWillSaveEvent,
  workspace
} from "vscode"

import { caughtToString, debounce, log, viewableObjecttypes } from "./lib"
import { ADTSCHEME, uriRoot, abapUri, getRoot } from "./adt/conections"
import { AbapObject } from "abapobject"
import { isAbapStat } from "abapfs"
import { isCsrfError } from "abap-adt-api"
import { LockStatus } from "abapfs/out/lockObject"
import { IncludeProvider } from "./adt/includes"
import { uriAbapFile } from "./adt/operations/AdtObjectFinder"

export const listenersubscribers: ((...x: any[]) => Disposable)[] = []

export const listener = <T>(event: Event<T>) => (
  target: any,
  propertyKey: string
) => {
  const func = () => event(target[propertyKey].bind(target))
  listenersubscribers.push(func)
}
export async function documentClosedListener(doc: TextDocument) {
  if (!abapUri(doc.uri)) return
  try {
    const uri = doc.uri
    const root = uriRoot(uri)
    if (uri.scheme === ADTSCHEME) {
      if ((await root.lockManager.finalStatus(uri.path)).status === "locked")
        await root.lockManager.requestUnlock(uri.path)
    }
  } catch (error) {
    log(caughtToString(error))
  }
}

export async function reconnectExpired(uri: Uri) {
  const ok = "Ok"
  const lm = uriRoot(uri).lockManager

  const resp = lm.lockedPaths().next().value
    ? await window.showErrorMessage(
      "Session expired, files can't be locked might be stale. Try to refresh locks?",
      "Ok",
      "Cancel"
    )
    : ok
  if (resp === ok) {
    await lm.restore()
    return true
  }
  return false
}

type LockValidator = (l: LockStatus) => Promise<boolean>
async function validateLock(lock: LockStatus) {
  const ok = "Ok"
  if (lock.status === "locked" && lock.IS_LINK_UP) {
    const resp = await window.showWarningMessage(
      `Object is locked, a new task will be created in ${lock.CORRUSER}'s ${lock.CORRNR} ${lock.CORRTEXT}`,
      ok,
      "Cancel"
    )
    return resp === ok
  }
  return true
}

export const isExpired = (error: any) =>
  isCsrfError(error) ||
  (error.message === "Session timed out" && error.err === 400)

export async function setDocumentLock(
  document: TextDocument,
  interactive = false,
  retry = true
) {
  const uri = document.uri
  if (!abapUri(uri)) return

  const lockManager = getRoot(uri.authority).lockManager

  const cb = interactive ? validateLock : undefined
  if (document.isDirty)
    try {
      const lock = await lockManager.requestLock(uri.path)
      if (!validateLock(lock)) await lockManager.requestUnlock(uri.path)
    } catch (e) {
      if (isExpired(e)) {
        if (retry && (await reconnectExpired(document.uri)))
          setDocumentLock(document, interactive, false)
      } else
        window.showErrorMessage(
          `${caughtToString(e)}\nWon't be able to save changes`
        )
    }
  else await lockManager.requestUnlock(uri.path)

  return await lockManager.finalStatus(uri.path)
}
// when the extension is deactivated, all locks are dropped
// try to restore them as needed
export async function restoreLocks() {
  return Promise.all(workspace.textDocuments.map(doc => setDocumentLock(doc)))
}

// debouncing is important for an edge case:
// if the object is modified but not locked, undoing the changes and restoring the editor
// would result in an attempt to lock (perhaps with an error or a request to select a transport)
// followed by an unlock request after a few milliseconds
// after debouncing it will only process the last status
const doclock = debounce(200, async (document: TextDocument) => {
  try {
    await setDocumentLock(document)
  } finally {
    const editor = window.activeTextEditor
    if (editor && editor.document === document) showHideActivate(editor)
  }
})

export async function documentChangedListener(event: TextDocumentChangeEvent) {
  const uri = event.document.uri
  if (!abapUri(uri)) return
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

function isInactive(obj: AbapObject): boolean {
  const inactive = !!(obj.structure?.metaData["adtcore:version"] === "inactive")
  return inactive
}

function showHidedbIcon(editor?: TextEditor) {
  try {
    const type = uriAbapFile(editor?.document.uri)?.object.type
    commands.executeCommand("setContext", "abapfs:showTableContentIcon", viewableObjecttypes.has(type))
  } catch (error) { }
}

export async function showHideActivate(editor?: TextEditor, refresh = false) {
  let shouldShow = false
  const uri = editor?.document.uri
  if (!(uri && abapUri(uri))) return
  try {
    const root = uriRoot(uri)
    const lockStatus = await root.lockManager.finalStatus(uri.path)
    shouldShow = editor.document.isDirty && lockStatus.status === "locked"
    if (!shouldShow) {
      const file = root.getNode(uri.path)
      const obj = isAbapStat(file) && file.object
      if (!obj) return
      if (refresh) await obj.loadStructure()
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
  showHidedbIcon(editor)
  try {
    if (editor && editor.document.uri.scheme === ADTSCHEME) {
      await showHideActivate(editor)
    }
  } catch (e) {
    await showHideActivate() // reset
  }
}
