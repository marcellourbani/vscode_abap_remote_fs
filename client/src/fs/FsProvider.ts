import { fromUri } from "../adt/AdtServer"
import {
  FileSystemError,
  FileChangeType,
  FileSystemProvider,
  EventEmitter,
  FileChangeEvent,
  Event,
  Uri,
  Disposable,
  FileStat,
  FileType
} from "vscode"

export class FsProvider implements FileSystemProvider {
  private pEventEmitter = new EventEmitter<FileChangeEvent[]>()
  // tslint:disable-next-line:member-ordering
  public readonly onDidChangeFile: Event<FileChangeEvent[]> = this.pEventEmitter
    .event

  public watch(
    uri: Uri,
    options: { recursive: boolean; excludes: string[] }
  ): Disposable {
    return new Disposable(() => undefined)
  }

  public async stat(uri: Uri): Promise<FileStat> {
    if (uri.path === "/.vscode") throw FileSystemError.FileNotFound(uri)
    const server = fromUri(uri)
    if (uri.path === "/") return server.findNode(uri)
    try {
      return await server.stat(uri)
    } catch (e) {
      throw e
    }
  }

  public async readDirectory(uri: Uri): Promise<Array<[string, FileType]>> {
    const server = fromUri(uri)
    const dir = server.findNode(uri)
    await server.refreshDirIfNeeded(dir)
    const contents = [...dir].map(
      ([name, node]) => [name, node.type] as [string, FileType]
    )
    return contents
  }
  public createDirectory(uri: Uri): void | Thenable<void> {
    throw FileSystemError.NoPermissions(
      "Not a real filesystem, directory creation is not supported"
    )
  }
  public async readFile(uri: Uri): Promise<Uint8Array> {
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
    uri: Uri,
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

  public async delete(uri: Uri, options: { recursive: boolean }) {
    const server = fromUri(uri)
    await server.delete(uri)
  }

  public rename(
    oldUri: Uri,
    newUri: Uri,
    options: { overwrite: boolean }
  ): void | Thenable<void> {
    throw new Error("Method not implemented.")
  }
}
