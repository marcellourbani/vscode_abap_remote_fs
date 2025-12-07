import { getOrCreateRoot } from "../adt/conections"
import {
  FileSystemError,
  FileChangeType,
  FileSystemProvider,
  EventEmitter,
  FileChangeEvent,
  Uri,
  Disposable,
  FileStat,
  FileType,
  ExtensionContext
} from "vscode"
import { caughtToString, log } from "../lib"
import { isAbapFile, isAbapFolder, isFolder } from "abapfs"
import { selectTransportIfNeeded } from "../adt/AdtTransports"
import { LocalFsProvider } from "./LocalFsProvider"

export class FsProvider implements FileSystemProvider {
  private static instance: FsProvider
  private localProvider: LocalFsProvider
  private constructor(private context: ExtensionContext) {
    this.localProvider = new LocalFsProvider(context)
    // forward local provider file changes to this provider so that the extension
    // gets notified about changes from the local storage
    this.context.subscriptions.push(
      this.localProvider.onDidChangeFile(changes =>
        this.pEventEmitter.fire(changes)
      )
    )
  }
  public static get(context?: ExtensionContext) {
    if (!FsProvider.instance)
      if (context) FsProvider.instance = new FsProvider(context)
      else throw new Error("FsProvider not initialized, context is required")
    return FsProvider.instance
  }
  public get onDidChangeFile() {
    return this.pEventEmitter.event
  }
  private pEventEmitter = new EventEmitter<FileChangeEvent[]>()
  public watch(
    uri: Uri,
    options: {
      readonly recursive: boolean
      readonly excludes: readonly string[]
    }
  ): Disposable {
    if (LocalFsProvider.useLocalStorage(uri))
      return this.localProvider.watch(uri, options)
    return new Disposable(() => undefined)
  }

  public notifyChanges(changes: FileChangeEvent[]) {
    this.pEventEmitter.fire(changes)
  }

  public async stat(uri: Uri): Promise<FileStat> {
    if (LocalFsProvider.useLocalStorage(uri))
      return this.localProvider.stat(uri)
    try {
      const root = await getOrCreateRoot(uri.authority)
      const node = await root.getNodeAsync(uri.path)
      if (!node) throw FileSystemError.FileNotFound(uri)
      if (isAbapFile(node)) await node.stat()
      if (isAbapFolder(node)) await node.refresh()
      return node
    } catch (e) {
      log(`Error in stat of ${uri?.toString()}\n${caughtToString(e)}`)
      throw e
    }
  }

  public async readFile(uri: Uri): Promise<Uint8Array> {
    if (LocalFsProvider.useLocalStorage(uri))
      return this.localProvider.readFile(uri)
    try {
      const root = await getOrCreateRoot(uri.authority)
      const node = await root.getNodeAsync(uri.path)
      if (isAbapFile(node)) {
        const contents = await node.read()
        const buf = Buffer.from(contents)
        return buf
      }
    } catch (error) {
      log(`Error reading file ${uri?.toString()}\n${caughtToString(error)}`)
    }
    throw FileSystemError.Unavailable(uri)
  }

  public async readDirectory(uri: Uri): Promise<[string, FileType][]> {
    if (LocalFsProvider.useLocalStorage(uri))
      return this.localProvider.readDirectory(uri)
    try {
      const root = await getOrCreateRoot(uri.authority)
      const node = await root.getNodeAsync(uri.path)
      if (!isFolder(node)) throw FileSystemError.FileNotFound(uri)
      if (isAbapFolder(node) && node.size === 0) await node.refresh()
      const files: [string, FileType][] = [...node].map(i => [
        i.name,
        i.file.type
      ])
      if (uri.path === "/") {
        const localfiles = await this.localProvider.readDirectory(uri)
        return [...files, ...localfiles]
      }
      return files
    } catch (e) {
      log(`Error reading directory ${uri?.toString()}\n${caughtToString(e)}`)
      throw e
    }
  }

  public createDirectory(uri: Uri): void | Thenable<void> {
    if (LocalFsProvider.useLocalStorage(uri))
      return this.localProvider.createDirectory(uri)
    throw FileSystemError.NoPermissions(
      "Not a real filesystem, directory creation is not supported"
    )
  }

  public async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
    if (LocalFsProvider.useLocalStorage(uri))
      return this.localProvider.writeFile(uri, content, undefined)
    try {
      const root = await getOrCreateRoot(uri.authority)
      const node = await root.getNodeAsync(uri.path)
      if (isAbapFile(node)) {
        const trsel = await selectTransportIfNeeded(uri)
        if (trsel.cancelled) return
        const lock = root.lockManager.lockStatus(uri.path)
        if (lock.status === "locked") {
          await node.write(
            content.toString(),
            lock.LOCK_HANDLE,
            trsel.transport
          )
          await root.lockManager.requestUnlock(uri.path, true)
          this.pEventEmitter.fire([{ type: FileChangeType.Changed, uri }])
        } else throw new Error(`File ${uri.path} was not locked`)
      } else throw FileSystemError.FileNotFound(uri)
    } catch (e) {
      log(`Error writing file ${uri.toString()}\n${caughtToString(e)}`)
      throw e
    }
  }

  public async delete(uri: Uri, options: { recursive: boolean }) {
    if (LocalFsProvider.useLocalStorage(uri))
      return this.localProvider.delete(uri, options)
    try {
      const root = await getOrCreateRoot(uri.authority)
      const node = await root.getNodeAsync(uri.path)
      const lock = await root.lockManager.requestLock(uri.path)
      if (lock.status === "locked") {
        const trsel = await selectTransportIfNeeded(uri)
        if (trsel.cancelled) return
        if (isAbapFolder(node) || isAbapFile(node))
          return await node.delete(lock.LOCK_HANDLE, trsel.transport)
        else
          throw FileSystemError.Unavailable(
            "Deletion not supported for this object"
          )
      } else throw FileSystemError.NoPermissions(`Unable to acquire lock`)
    } catch (e) {
      const msg = `Error deleting file ${uri.toString()}\n${caughtToString(e)}`
      log(msg)
      throw new Error(msg)
    }
  }

  public rename(
    oldUri: Uri,
    newUri: Uri,
    options: { overwrite: boolean }
  ): void | Thenable<void> {
    if (LocalFsProvider.useLocalStorage(oldUri))
      return this.localProvider.rename(oldUri, newUri, options)
    throw new Error("Method not implemented.")
  }
}
