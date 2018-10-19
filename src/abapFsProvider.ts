import * as vscode from "vscode"
import { AdtPathManager } from "./adt/AdtPathManager"
import { AdtNode } from "./adt/AdtNode"

export class AbapFsProvider implements vscode.FileSystemProvider {
  private _pathManager = new AdtPathManager()
  private _eventEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this
    ._eventEmitter.event
  rooturl: string = ""
  root: AdtNode = new AdtNode("")
  watch(
    uri: vscode.Uri,
    options: { recursive: boolean; excludes: string[] }
  ): vscode.Disposable {
    throw new Error("Method not implemented.")
  }
  stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
    const uristring = uri.toString()
    if (this.rooturl === "") this.rooturl = uristring
    if (this.rooturl === uristring) {
      const newroot = this._pathManager
        .fetchDirectory(uristring)
        .then(newroot => (this.root = newroot))
      return newroot
    }
    throw new Error("not found")
  }
  readDirectory(
    uri: vscode.Uri
  ): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
    if (uri.toString() !== this.rooturl || !this.root) {
      throw new Error("Only root directory for now...")
    }
    const result: [string, vscode.FileType][] = []
    Array.from(this.root.entries).forEach(([key, value]) =>
      result.push([key, value.type])
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
