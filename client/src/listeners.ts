import {
  TextDocument,
  TextDocumentChangeEvent,
  TextDocumentSaveReason,
  TextDocumentWillSaveEvent,
  TextEditor,
  Uri,
  Disposable,
  Event,
  window,
  workspace,
  TabInputTextDiff
} from "vscode"

import { caughtToString, debounce, log, viewableObjecttypes } from "./lib"
import { ADTSCHEME, uriRoot, abapUri, getRoot } from "./adt/conections"
import { AbapObject } from "abapobject"
import { isAbapStat } from "abapfs"
import { isCsrfError } from "abap-adt-api"
import { LockStatus } from "abapfs/out/lockObject"
import { uriAbapFile } from "./adt/operations/AdtObjectFinder"
import { versionRevisions } from "./scm/abaprevisions"
import { setContext } from "./context"
import { logTelemetry } from "./services/telemetry"
import { LocalFsProvider } from "./fs/LocalFsProvider"
import { triggerSyntaxCheck } from "./langClient"
import { updateEnhancementDecorations } from "./views/enhancementDecorations"
import { updateCleanerContext } from "./services/cleanerCommands"

// Global tracking of save reasons to coordinate between documentWillSave and writeFile
const pendingSaveReasons = new Map<string, TextDocumentSaveReason>()

export function setSaveReason(uri: string, reason: TextDocumentSaveReason) {
  pendingSaveReasons.set(uri, reason)
  // Auto-cleanup after 5 seconds to prevent memory leaks
  setTimeout(() => pendingSaveReasons.delete(uri), 5000)
}

export function getSaveReason(uri: string): TextDocumentSaveReason | undefined {
  return pendingSaveReasons.get(uri)
}

export function clearSaveReason(uri: string) {
  pendingSaveReasons.delete(uri)
}

export const listenersubscribers: ((...x: any[]) => Disposable)[] = []

export const listener =
  <T>(event: Event<T>) =>
  (target: any, propertyKey: string) => {
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
const isRecord = (o: unknown): o is Record<any, any> => typeof o === "object" && o !== null
export const isExpired = (error: any) =>
  isCsrfError(error) || (error.err === 400 && `${error.message}`.match(/Session.*timed.*out/i))

export async function setDocumentLock(
  document: TextDocument,
  interactive = false,
  retry = true
): Promise<LockStatus | undefined> {
  const uri = document.uri
  if (!abapUri(uri)) return

  const lockManager = getRoot(uri.authority).lockManager

  const cb = interactive ? validateLock : undefined
  if (document.isDirty)
    try {
      const lock = await lockManager.requestLock(uri.path)
      if (!validateLock(lock)) {
        await lockManager.requestUnlock(uri.path)
        const error = new Error("Lock validation failed")
        if (interactive) {
          window.showErrorMessage(`Lock validation failed\nWon't be able to save changes`)
        }
        throw error
      }
    } catch (e) {
      // Enhanced error logging for debugging
      // if (isRecord(e)) {
      //   const errorDetails = {
      //     message: e.message,
      //     status: e.status || e.response?.status,
      //     statusText: e.statusText || e.response?.statusText,
      //     code: e.code,
      //     errno: e.errno
      //   }
      // }

      if (isExpired(e)) {
        if (retry && (await reconnectExpired(document.uri)))
          return setDocumentLock(document, interactive, false)
      }

      // Handle error notifications based on interactive flag
      if (interactive) {
        window.showErrorMessage(`${caughtToString(e)}\nWon't be able to save changes`)
      }

      // Always throw the error so caller can handle it
      throw e
    }
  else await lockManager.requestUnlock(uri.path)
  // else if (!interactive) {
  //   // Only unlock if this is NOT an interactive save operation
  //   await lockManager.requestUnlock(uri.path)
  // } else {
  //   // For interactive saves (like "Keep"), we need to lock even if document isn't dirty
  //   try {
  //     const lock = await lockManager.requestLock(uri.path)
  //     if (!validateLock(lock)) {
  //       await lockManager.requestUnlock(uri.path)
  //       const error = new Error("Lock validation failed for interactive save")
  //       window.showErrorMessage(`Lock validation failed\nWon't be able to save changes`)
  //       throw error
  //     }
  //   } catch (e) {
  //     window.showErrorMessage(`${caughtToString(e)}\nWon't be able to save changes`)
  //     throw e
  //   }
  // }

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
// NOTE: This is now only used for explicit save operations, not automatic document changes
// PERFORMANCE: Reduced debounce time for more responsive saves
const doclock = debounce(200, async (document: TextDocument) => {
  try {
    await setDocumentLock(document, true) // Always interactive for explicit saves
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
  if (event.contentChanges.length === 0 || event.document.isDirty) doclock(event.document)
  // restored original locking without copilot detection

  // // 🤖 COPILOT DETECTION: Check if content changed without isDirty being set
  const document = event.document
  const hasContentChanges = event.contentChanges.length > 0
  const isDocumentDirty = document.isDirty

  if (hasContentChanges && !isDocumentDirty) {
    // Content changed but isDirty is false = Likely Copilot!

    // Check if this looks like an Undo action (entire document replacement)
    const isLikelyUndo = event.contentChanges.some(
      change => change.range.start.line === 0 && change.range.end.line >= document.lineCount - 1
    )

    if (isLikelyUndo) {
      // Skip counting this as a change since it's an undo
      return
    }

    const totalLinesChanged = event.contentChanges.reduce((sum, change) => {
      const insertedLines = (change.text.match(/\n/g) || []).length
      const deletedLines = change.range.end.line - change.range.start.line
      // Use total modifications: inserted + deleted lines
      return sum + insertedLines + deletedLines
    }, 0)

    // Only log if significant change (filter out minor edits)
    if (totalLinesChanged > 0) {
      const action = `Number of code lines changed: ${totalLinesChanged}`
      // Extract connectionId from document URI
      const connectionId = uri.authority
      logTelemetry(action, { connectionId })
    }
  }
}

export async function documentWillSave(e: TextDocumentWillSaveEvent) {
  const uri = e.document.uri

  if (uri.scheme !== ADTSCHEME || LocalFsProvider.useLocalStorage(uri)) return
  if (!e.document.isDirty) await setDocumentLock({ ...e.document, isDirty: true }, true)

  // Store the save reason so writeFile can access it
  setSaveReason(uri.toString(), e.reason)

  // // New logic: only proceed with lock/save if the trigger was manual (Ctrl+S, Keep, etc.)
  // // // For non-manual saves, we do nothing. This prevents lock attempts on auto-saves.
  // // if (e.reason !== TextDocumentSaveReason.Manual) return

  // // This is the logic that ensures the object is locked before saving.
  // // It will show an error to the user only if this explicit save fails.
  // const lockPromise = setDocumentLock(e.document, true).catch(error => {
  //   // This error is now expected behavior, as it tells the user their
  //   // explicit save action failed.
  //   throw new Error(`Failed to lock SAP object. Save cancelled.`)
  // })
  // // Defer the save operation until the lock is acquired.
  // e.waitUntil(lockPromise)
}

function isInactive(obj: AbapObject): boolean {
  const inactive = !!(obj.structure?.metaData["adtcore:version"] === "inactive")
  return inactive
}

function showHidedbIcon(editor?: TextEditor) {
  try {
    const type = uriAbapFile(editor?.document.uri)?.object.type
    setContext("abapfs:showTableContentIcon", viewableObjecttypes.has(type))
  } catch (error) {}
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
      // Show for any object that has activation status (inactive objects definitely need activation)
      if (refresh) await obj.loadStructure()
      // shouldShow = obj && (isInactive(obj) || Boolean(obj.structure?.metaData?.hasOwnProperty("adtcore:version")))
      shouldShow = obj && isInactive(obj)
    }
  } catch (e) {
    shouldShow = false
  }
  // race condition, active editor might have changed while async operation was pending
  if (editor !== window.activeTextEditor) return
  await setContext("abapfs:showActivate", shouldShow)
}
export async function activationStateListener(uri: Uri) {
  const editor = window.activeTextEditor
  if (editor && editor.document.uri.scheme === ADTSCHEME) {
    const euri = editor.document.uri
    if (uri.path !== euri.path) return
    await showHideActivate(editor)
  }
}
const setRevisionContext = (
  leftprev: boolean,
  leftnext: boolean,
  rightprev: boolean,
  rightnext: boolean
) => {
  setContext("abapfs:enableLeftNextRev", leftnext)
  setContext("abapfs:enableLeftPrevRev", leftprev)
  setContext("abapfs:enableRightNextRev", rightnext)
  setContext("abapfs:enableRightPrevRev", rightprev)
}
const enableRevNavigation = async (editor: TextEditor | undefined) => {
  if (editor) {
    const firstlast = async (u: Uri): Promise<[boolean, boolean]> => {
      const v = await versionRevisions(u)
      if (!v) return [false, false]
      const { revision, revisions } = v
      const idx = revisions.findIndex(r => r.uri === revision.uri)
      const hasNext = idx > 0
      const hasprev = idx >= 0 && idx < revisions.length - 1
      return [hasprev, hasNext]
    }
    try {
      const tab = window.tabGroups.activeTabGroup.activeTab
      if (tab?.input instanceof TabInputTextDiff) {
        const { original, modified } = tab.input
        const lefts = await firstlast(original)
        const rights = await firstlast(modified)
        if (rights && lefts) return setRevisionContext(...lefts, ...rights)
      }
    } catch (error) {
      // on error just disable all
    }
  }
  return setRevisionContext(false, false, false, false)
}
export async function activeTextEditorChangedListener(editor: TextEditor | undefined) {
  showHidedbIcon(editor)
  enableRevNavigation(editor)

  // Update feature availability contexts (consolidated for performance)
  if (editor) updateCleanerContext()
  // Note: updateFillContext requires context parameter, handled separately in its own listener

  try {
    if (editor && editor.document.uri.scheme === ADTSCHEME) {
      // If the document has unsaved changes, do not refresh its state from the server.
      // This prevents overwriting local changes (especially programmatic ones from tools).
      //if (editor.document.isDirty) {
      //  return;
      //}

      await showHideActivate(editor)

      // Trigger syntax check when switching to ADT file
      try {
        await triggerSyntaxCheck(editor.document.uri.toString())
      } catch (syntaxError) {
        // Syntax check is optional - don't break if it fails
      }

      // 🎯 NEW: Update enhancement decorations for ABAP files
      try {
        await updateEnhancementDecorations(editor)
      } catch (enhError) {
        //   // Enhancement decorations are optional - don't break if they fail
        log(`⚠️ Enhancement decorations failed: ${enhError}`)
      }
    }
  } catch (e) {
    await showHideActivate() // reset
  }
}
