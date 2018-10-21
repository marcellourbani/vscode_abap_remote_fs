import * as vscode from "vscode"
import { AdtPathManager } from "./adt/AdtPathManager"

export class AbapFsProvider implements vscode.FileSystemProvider {
  private _pathManager = new AdtPathManager()
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
    console.log(uri.toString())
    return this._pathManager.fetchFileOrDir(uri).then(n => {
      console.log(n)
      return n
    })
  }
  readDirectory(
    uri: vscode.Uri
  ): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
    const result: [string, vscode.FileType][] = []
    Array.from(this._pathManager.getDirectory(uri).entries).forEach(
      ([key, value]) => result.push([key, value.type])
    )
    return result
  }
  createDirectory(uri: vscode.Uri): void | Thenable<void> {
    throw new Error("Method not implemented.")
  }
  readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
    // if (uri.path === "/dummy.abap" && this.root) {
    //   return this.root.then(x => {
    //     const child = x.entries.get("dummy.abap")
    //     if (child && child instanceof AdtFile && child.data) {
    //       return child.data
    //     }
    //   })
    // }
    throw new Error("Method not implemented.")
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
