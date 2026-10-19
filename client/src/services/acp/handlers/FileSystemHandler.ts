import * as vscode from "vscode"
import { log, logError } from "../utils/Logger"
import { toVscodeUri } from "../fs/AbapPathMapper"
import { ADTSCHEME } from "../../../adt/conections"

import type {
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse
} from "@agentclientprotocol/sdk"

/**
 * Handles ACP file system requests using VS Code's workspace filesystem API.
 * Paths under the ADT mount are served by the ABAP FS file system provider,
 * so agents read and write SAP sources (with locking and transports) transparently.
 */
export class FileSystemHandler {
  /**
   * Read a text file. Uses VS Code API to include unsaved editor content.
   */
  async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    log(`readTextFile: ${params.path}`)

    try {
      const uri = toVscodeUri(params.path)
      if (uri.scheme !== "file") {
        log(`readTextFile: mapped to ${uri.toString()}`)
      }

      // Check if the file is open in an editor with unsaved changes
      const openDoc = findOpenDocument(uri)

      let content: string
      if (openDoc) {
        content = openDoc.getText()
      } else {
        const raw = await vscode.workspace.fs.readFile(uri)
        content = Buffer.from(raw).toString("utf-8")
      }

      // Handle line/limit parameters
      if (
        (params.line !== undefined && params.line !== null) ||
        (params.limit !== undefined && params.limit !== null)
      ) {
        const lines = content.split("\n")
        const startLine = (params.line ?? 1) - 1 // 1-based → 0-based
        const endLine = params.limit ? startLine + params.limit : lines.length
        content = lines.slice(startLine, endLine).join("\n")
      }

      return { content }
    } catch (e) {
      logError(`readTextFile failed: ${params.path}`, e)
      throw e
    }
  }

  /**
   * Write a text file. Creates parent directories if needed.
   * Opens the file in the editor so the user can see changes.
   */
  async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    log(`writeTextFile: ${params.path}`)

    try {
      const uri = toVscodeUri(params.path)
      if (uri.scheme !== "file") {
        log(`writeTextFile: mapped to ${uri.toString()}`)
      }

      const openDoc = findOpenDocument(uri)
      if (uri.scheme === ADTSCHEME && openDoc?.isDirty) {
        await replaceDocumentText(openDoc, params.content)
      } else {
        // The ABAP FS provider decodes with Buffer.toString, so a plain Uint8Array would break UTF-8
        await vscode.workspace.fs.writeFile(uri, Buffer.from(params.content, "utf-8"))
      }

      // Open the file in the editor so the user sees the change
      const doc = await vscode.workspace.openTextDocument(uri)
      await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true })

      return {}
    } catch (e) {
      logError(`writeTextFile failed: ${params.path}`, e)
      throw e
    }
  }
}
function findOpenDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
  const key = uri.toString()
  return vscode.workspace.textDocuments.find(doc => doc.uri.toString() === key)
}

/** A dirty editor would conflict with a raw provider write, so edit the buffer and save it instead */
async function replaceDocumentText(doc: vscode.TextDocument, content: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit()
  const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length))
  edit.replace(doc.uri, fullRange, content)
  if (!(await vscode.workspace.applyEdit(edit))) {
    throw new Error(`Unable to edit ${doc.uri.toString()}`)
  }
  if (!(await doc.save())) {
    throw new Error(`Unable to save ${doc.uri.toString()}`)
  }
}
