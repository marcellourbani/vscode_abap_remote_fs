/**
 * Keep/Undo review for ABAP edits made by the ABAP FS edit tool
 *
 * Edits are saved to SAP immediately; this only tracks them per file so the user can
 * acknowledge (Keep) or revert (Undo) them, similar to pending edits in Copilot Chat.
 * Undo writes the source from before the first pending edit back to SAP.
 */

import * as vscode from "vscode"
import { diffLines } from "diff"
import { objectWriteKey, serializeObjectWrite } from "./objectWriteQueue"

const ENABLED_SETTING = "abapfs.editReview.enabled"
const BASELINE_SCHEME = "abapfs-edit-baseline"
const PENDING_CONTEXT = "abapfs.editReview.pendingFiles"

interface PendingEdit {
  uri: vscode.Uri
  /** Source before the first pending edit, restored by Undo */
  baseline: string
  /** Source written by the most recent tool edit */
  latest: string
}

interface Decorations {
  added: vscode.TextEditorDecorationType
  removed: vscode.TextEditorDecorationType
}

const pending = new Map<string, PendingEdit>()
let lensChanged: vscode.EventEmitter<void> | undefined
let decorations: Decorations | undefined

function isEnabled(): boolean {
  return vscode.workspace.getConfiguration().get<boolean>(ENABLED_SETTING, false)
}

/** Report a saved tool edit. Must be called inside the object's write queue so edits arrive in save order */
export async function recordAbapEdit(uri: vscode.Uri, before: string, after: string): Promise<void> {
  if (!decorations || !isEnabled()) return
  try {
    await trackEdit(uri, before, after)
  } catch (error) {
    vscode.window.setStatusBarMessage(`Keep/Undo unavailable for ${fileName(uri)}: ${error}`, 10000)
  }
}

async function trackEdit(uri: vscode.Uri, before: string, after: string): Promise<void> {
  const key = objectWriteKey(uri)
  const existing = pending.get(key)
  if (existing && existing.baseline === after) {
    clearPending(key)
    return
  }
  const document = await vscode.workspace.openTextDocument(uri)
  pending.set(key, { uri: document.uri, baseline: existing?.baseline ?? before, latest: after })
  await vscode.window.showTextDocument(document, { preview: false, preserveFocus: true })
  refreshAll()
}

function clearPending(key: string): void {
  pending.delete(key)
  refreshAll()
}

function refreshAll(): void {
  void vscode.commands.executeCommand(
    "setContext",
    PENDING_CONTEXT,
    [...pending.values()].map(entry => entry.uri.toString())
  )
  for (const editor of vscode.window.visibleTextEditors) decorate(editor)
  lensChanged?.fire()
}

function decorate(editor: vscode.TextEditor): void {
  if (!decorations) return
  const entry = pending.get(objectWriteKey(editor.document.uri))
  const { added, removed } = entry
    ? changedRanges(entry.baseline, editor.document)
    : { added: [], removed: [] }
  editor.setDecorations(decorations.added, added)
  editor.setDecorations(decorations.removed, removed)
}

function changedRanges(baseline: string, document: vscode.TextDocument) {
  const added: vscode.Range[] = []
  const removed: vscode.Range[] = []
  const lastLine = Math.max(document.lineCount - 1, 0)
  let line = 0
  for (const part of diffLines(baseline, document.getText())) {
    const count = part.count ?? 0
    if (part.added) {
      added.push(new vscode.Range(line, 0, Math.min(line + count - 1, lastLine), 0))
      line += count
    } else if (part.removed) {
      removed.push(new vscode.Range(Math.min(line, lastLine), 0, Math.min(line, lastLine), 0))
    } else {
      line += count
    }
  }
  return { added, removed }
}

function firstChangedLine(entry: PendingEdit, document: vscode.TextDocument): number {
  const { added, removed } = changedRanges(entry.baseline, document)
  const lines = [...added, ...removed].map(range => range.start.line)
  return lines.length ? Math.min(...lines) : 0
}

function targetUri(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) return arg
  return vscode.window.activeTextEditor?.document.uri
}

function keep(arg: unknown): void {
  const uri = targetUri(arg)
  if (uri) clearPending(objectWriteKey(uri))
}

async function undo(arg: unknown): Promise<void> {
  const uri = targetUri(arg)
  if (!uri || !pending.has(objectWriteKey(uri))) return
  try {
    await serializeObjectWrite(uri, () => revert(uri))
  } catch (error) {
    vscode.window.showErrorMessage(`Undo failed: ${error instanceof Error ? error.message : error}`)
  }
}

/** Runs in the write queue, so edits still in flight for this object finish first */
async function revert(uri: vscode.Uri): Promise<void> {
  const key = objectWriteKey(uri)
  const entry = pending.get(key)
  if (!entry) return
  const document = vscode.workspace.textDocuments.find(doc => objectWriteKey(doc.uri) === key)
  const current = document?.getText() ?? entry.latest
  if (current !== entry.latest && !(await confirmDiscardLaterChanges(entry.uri))) return

  if (document?.isDirty) {
    await replaceDocumentText(document, entry.baseline)
  } else {
    // The ABAP FS provider decodes with Buffer.toString, so a plain Uint8Array would break UTF-8
    await vscode.workspace.fs.writeFile(entry.uri, Buffer.from(entry.baseline, "utf8"))
  }
  clearPending(key)
  vscode.window.setStatusBarMessage(`Reverted ${fileName(entry.uri)} in SAP`, 5000)
}

async function confirmDiscardLaterChanges(uri: vscode.Uri): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    `${fileName(uri)} changed after the last tool edit. Undo restores the source from before the tool edits and discards those changes too.`,
    { modal: true },
    "Undo"
  )
  return choice === "Undo"
}

async function replaceDocumentText(document: vscode.TextDocument, content: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit()
  const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length))
  edit.replace(document.uri, fullRange, content)
  if (!(await vscode.workspace.applyEdit(edit))) throw new Error(`unable to edit ${fileName(document.uri)}`)
  if (!(await document.save())) throw new Error(`unable to save ${fileName(document.uri)}`)
}

async function showDiff(arg: unknown): Promise<void> {
  const uri = targetUri(arg)
  const entry = uri && pending.get(objectWriteKey(uri))
  if (!entry) return
  const baselineUri = vscode.Uri.from({
    scheme: BASELINE_SCHEME,
    path: entry.uri.path,
    query: objectWriteKey(entry.uri)
  })
  await vscode.commands.executeCommand(
    "vscode.diff",
    baselineUri,
    entry.uri,
    `${fileName(entry.uri)} (before edits) ↔ Current`
  )
}

function fileName(uri: vscode.Uri): string {
  return uri.path.split("/").pop() || uri.path
}

class EditReviewCodeLensProvider implements vscode.CodeLensProvider {
  constructor(readonly onDidChangeCodeLenses: vscode.Event<void>) {}

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const entry = pending.get(objectWriteKey(document.uri))
    if (!entry) return []
    const line = firstChangedLine(entry, document)
    const range = new vscode.Range(line, 0, line, 0)
    return [
      new vscode.CodeLens(range, { title: "$(check) Keep", command: "abapfs.editReview.keep", arguments: [entry.uri] }),
      new vscode.CodeLens(range, { title: "$(discard) Undo", command: "abapfs.editReview.undo", arguments: [entry.uri] }),
      new vscode.CodeLens(range, { title: "$(diff) Show Changes", command: "abapfs.editReview.showDiff", arguments: [entry.uri] })
    ]
  }
}

function onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
  const key = objectWriteKey(event.document.uri)
  const entry = pending.get(key)
  if (!entry) return
  if (event.document.getText() === entry.baseline) {
    clearPending(key)
    return
  }
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document === event.document) decorate(editor)
  }
  lensChanged?.fire()
}

function onConfigurationChanged(event: vscode.ConfigurationChangeEvent): void {
  if (!event.affectsConfiguration(ENABLED_SETTING) || isEnabled()) return
  pending.clear()
  refreshAll()
}

function createDecorations(): Decorations {
  return {
    added: vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor("diffEditor.insertedLineBackground"),
      overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.addedForeground"),
      overviewRulerLane: vscode.OverviewRulerLane.Left
    }),
    removed: vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      borderStyle: "solid",
      borderWidth: "1px 0 0 0",
      borderColor: new vscode.ThemeColor("editorGutter.deletedBackground"),
      overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.deletedForeground"),
      overviewRulerLane: vscode.OverviewRulerLane.Left
    })
  }
}

export function registerEditReview(context: vscode.ExtensionContext): void {
  decorations = createDecorations()
  lensChanged = new vscode.EventEmitter<void>()
  context.subscriptions.push(
    decorations.added,
    decorations.removed,
    lensChanged,
    vscode.workspace.registerTextDocumentContentProvider(BASELINE_SCHEME, {
      provideTextDocumentContent: uri => [...pending.values()].find(e => objectWriteKey(e.uri) === uri.query)?.baseline ?? ""
    }),
    vscode.languages.registerCodeLensProvider({ scheme: "adt" }, new EditReviewCodeLensProvider(lensChanged.event)),
    vscode.commands.registerCommand("abapfs.editReview.keep", keep),
    vscode.commands.registerCommand("abapfs.editReview.undo", undo),
    vscode.commands.registerCommand("abapfs.editReview.showDiff", showDiff),
    vscode.window.onDidChangeVisibleTextEditors(editors => editors.forEach(decorate)),
    vscode.workspace.onDidChangeTextDocument(onDocumentChanged),
    vscode.workspace.onDidChangeConfiguration(onConfigurationChanged)
  )
}
