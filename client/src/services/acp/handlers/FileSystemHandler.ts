import * as vscode from "vscode"
import { log, logError } from "../utils/Logger"
import { toVscodeUri } from "../fs/AbapPathMapper"
import { toLf, withLineEndingsOf } from "../fs/lineEndings"
import { ADTSCHEME } from "../../../adt/conections"
import { recordAbapEdit } from "../../editReview"
import { serializeObjectWrite } from "../../objectWriteQueue"

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
    try {
      const uri = toVscodeUri(params.path)

      // Check if the file is open in an editor with unsaved changes
      const openDoc = findOpenDocument(uri)

      let content = toLf(openDoc ? openDoc.getText() : await readFileText(uri))

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

      const write = () => writeWithLineEndings(uri, params.content)
      // SAP objects are also written by the ABAP FS edit tool and by Undo, and edit review needs save order
      if (uri.scheme === ADTSCHEME) {
        await serializeObjectWrite(uri, write)
      } else {
        await write()
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
async function writeWithLineEndings(uri: vscode.Uri, agentContent: string): Promise<void> {
  const openDoc = findOpenDocument(uri)
  const existing = openDoc ? openDoc.getText() : await readFileText(uri).catch(() => undefined)
  const content = withLineEndingsOf(agentContent, existing)
  if (uri.scheme === ADTSCHEME && openDoc?.isDirty) {
    await replaceDocumentText(openDoc, content)
  } else {
    // The ABAP FS provider decodes with Buffer.toString, so a plain Uint8Array would break UTF-8
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"))
  }
  if (uri.scheme === ADTSCHEME && existing !== undefined) {
    await recordAbapEdit(uri, existing, content)
  }
}

async function readFileText(uri: vscode.Uri): Promise<string> {
  return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf-8")
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
