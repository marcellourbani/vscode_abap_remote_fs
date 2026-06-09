import * as vscode from "vscode"
import { client } from "../langClient"
import { Methods } from "vscode-abap-remote-fs-sharedapi"
import { log } from "../lib"

/**
 * Called after a method-call completion item is inserted.
 * Sends a request to the language server to get the full method signature
 * with parameters, then replaces the inserted method name with the full snippet.
 */
export async function insertMethodParams() {
  const editor = vscode.window.activeTextEditor
  if (!editor) return
  if (!client) return

  const uri = editor.document.uri.toString()
  const pos = editor.selection.active

  // Get the method name that was just inserted: scan left from cursor
  const line = editor.document.lineAt(pos.line).text
  const textBefore = line.substring(0, pos.character)
  const nameMatch = textBefore.match(/([\w\/]+)\s*$/)
  if (!nameMatch) return
  const identifier = nameMatch[1]

  try {
    const snippet: string | undefined = await client.sendRequest(
      Methods.codeCompletionFull,
      { uri, identifier }
    )
    if (!snippet) return

    // Replace the method name with the full snippet
    const nameStart = pos.character - identifier.length
    const range = new vscode.Range(pos.line, nameStart, pos.line, pos.character)
    await editor.insertSnippet(new vscode.SnippetString(snippet), range)

    // Fix comment lines: in ABAP, * must be in column 0 (absolute position)
    // VS Code auto-indents inserted lines, so * may not be in column 0
    const insertedLines = snippet.split("\n").length
    const edit = new vscode.WorkspaceEdit()
    for (let l = pos.line; l < pos.line + insertedLines && l < editor.document.lineCount; l++) {
      const lineText = editor.document.lineAt(l).text
      const match = lineText.match(/^(\s+)\*/)
      if (match) {
        edit.delete(editor.document.uri, new vscode.Range(l, 0, l, match[1].length))
      }
    }
    if (edit.size > 0) await vscode.workspace.applyEdit(edit)
  } catch (e) {
    log("insertMethodParams error:", String(e))
  }
}
