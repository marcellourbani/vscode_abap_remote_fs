import * as vscode from "vscode"
import { fromUri } from "../adt/AdtServer"

export class AbapFsProvider implements vscode.FileSystemProvider {
  private _eventEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this
    ._eventEmitter.event
  watch(
    uri: vscode.Uri,
    options: { recursive: boolean; excludes: string[] }
  ): vscode.Disposable {
    throw new Error("Method not implemented.")
  }
  stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
    const server = fromUri(uri)
    return server.findNodePromise(uri)
  }
  readDirectory(
    uri: vscode.Uri
  ): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
    // const server = fromUri(uri)
    // const dir = server.findNode(uri)
    // if (isFolder(dir)) if (dir) dir.keys().map()
    // Array.from(dir.entries).forEach(([key, value]) =>
    //   result.push([key.replace(/\//g, "_"), value.type])
    // )
    // return result
    throw new Error("Method not implemented.")
  }
  createDirectory(uri: vscode.Uri): void | Thenable<void> {
    throw new Error("Method not implemented.")
  }
  readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
    throw new Error("Method not implemented.")
    // const file = this._pathManager.find(uri)
    // if (file && file.body) return file.body
    // return new Uint8Array([])
  }
  writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): void | Thenable<void> {
    throw new Error("Method not implemented.")
  }
  delete(
    uri: vscode.Uri,
    options: { recursive: boolean }
  ): void | Thenable<void> {
    throw new Error("Method not implemented.")
  }
  rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean }
  ): void | Thenable<void> {
    throw new Error("Method not implemented.")
  }
}
