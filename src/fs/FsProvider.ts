import * as vscode from "vscode"
import { fromUri } from "../adt/AdtServer"
import { FileSystemError, FileChangeType } from "vscode"

export class FsProvider implements vscode.FileSystemProvider {
  private pEventEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
  // tslint:disable-next-line:member-ordering
  public readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this
    .pEventEmitter.event

  public watch(
    uri: vscode.Uri,
    options: { recursive: boolean; excludes: string[] }
  ): vscode.Disposable {
    return new vscode.Disposable(() => undefined)
  }

  public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    if (uri.path === "/.vscode") throw FileSystemError.FileNotFound(uri)
    const server = fromUri(uri)
    if (uri.path === "/") return server.findNode(uri)
    try {
      return await server.stat(uri)
    } catch (e) {
      throw e
    }
  }

  public async readDirectory(
    uri: vscode.Uri
  ): Promise<Array<[string, vscode.FileType]>> {
    const server = fromUri(uri)
    const dir = server.findNode(uri)
    await server.refreshDirIfNeeded(dir)
    const contents = [...dir].map(
      ([name, node]) => [name, node.type] as [string, vscode.FileType]
    )
    return contents
  }
  public createDirectory(uri: vscode.Uri): void | Thenable<void> {
    throw FileSystemError.NoPermissions(
      "Not a real filesystem, directory creation is not supported"
    )
  }
  public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const server = fromUri(uri)
    const file = server.findNode(uri)

    try {
      if (file && !file.isFolder) return file.fetchContents(server.client)
    } catch (error) {
      // ignore
    }
    throw FileSystemError.Unavailable(uri)
  }
  public async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    const server = fromUri(uri)
    const file = server.findNode(uri)
    if (!file && options.create)
      throw FileSystemError.NoPermissions(
        "Not a real filesystem, file creation is not supported"
      )
    if (!file) throw FileSystemError.FileNotFound(uri)
    await server.saveFile(file, content)
    this.pEventEmitter.fire([{ type: FileChangeType.Changed, uri }])
  }
  public delete(
    uri: vscode.Uri,
    options: { recursive: boolean }
  ): void | Thenable<void> {
    throw new Error("Method not implemented.")
  }
  public rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean }
  ): void | Thenable<void> {
    throw new Error("Method not implemented.")
  }
}
