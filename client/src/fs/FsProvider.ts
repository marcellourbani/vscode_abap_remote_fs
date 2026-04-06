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
  window,
  TextDocumentSaveReason,
  commands,
  ExtensionContext,
  workspace
} from "vscode"
import { after, caughtToString, log } from "../lib"
import { AbapFile, isAbapFile, isAbapFolder, isFolder, Root } from "abapfs"
import { getSaveReason, clearSaveReason } from "../listeners"
import { selectTransportIfNeeded } from "../adt/AdtTransports"
import { LocalFsProvider } from "./LocalFsProvider"
import { isHttpError } from "abap-adt-api"
import { ReloginError } from "abapfs/out/lockManager"

const openInGui = (uri: Uri, contents: string) => {
  if (contents.includes("This object type is not supported in VS Code")) {
    const autoOpen = workspace
      .getConfiguration("abapfs")
      .get<boolean>("autoOpenUnsupportedInGui", true)

    if (autoOpen) {
      // Automatically trigger runInGui command
      // Use setTimeout to ensure the document is opened first so URI context is available
      setTimeout(() => {
        commands.executeCommand("abapfs.runInGui")
      }, 1000)
    } else {
      // Show message with action buttons
      setTimeout(async () => {
        const choice = await window.showInformationMessage(
          "This object type is not supported in VS Code.",
          "Open in SAP GUI",
          "Always Auto Open"
        )
        if (choice === "Open in SAP GUI") {
          commands.executeCommand("abapfs.runInGui")
        } else if (choice === "Always Auto Open") {
          await workspace.getConfiguration("abapfs").update("autoOpenUnsupportedInGui", true, true)
          commands.executeCommand("abapfs.runInGui")
        }
      }, 500)
    }
  }
}

const handleTelemetry = (uri: Uri) => {
  try {
    const uriString = uri.toString()

    // Check if this save was triggered by a non-manual operation
    const saveReason = getSaveReason(uriString)
    if (saveReason === undefined || saveReason !== TextDocumentSaveReason.Manual) {
      clearSaveReason(uriString)
      return // Block any save that isn't explicitly manual
    }

    clearSaveReason(uriString)
  } catch (e) {}
}
export class FsProvider implements FileSystemProvider {
  private overwriteRejected = new Set<string>()
  private static instance: FsProvider
  // private editorContentCache = new Map<string, string>() // Track editor content to prevent server overwrites
  private localProvider: LocalFsProvider
  private constructor(private context: ExtensionContext) {
    this.localProvider = new LocalFsProvider(context)
    // forward local provider file changes to this provider so that the extension
    // gets notified about changes from the local storage
    this.context.subscriptions.push(
      this.localProvider.onDidChangeFile(changes => this.pEventEmitter.fire(changes))
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
    if (LocalFsProvider.useLocalStorage(uri)) return this.localProvider.watch(uri, options)
    return new Disposable(() => undefined)
  }

  public notifyChanges(changes: FileChangeEvent[]) {
    this.pEventEmitter.fire(changes)
  }

  private isOpenDirtyDocument(uri: Uri) {
    return workspace.textDocuments.some(
      document => document.uri.toString() === uri.toString() && document.isDirty
    )
  }

  public async stat(uri: Uri): Promise<FileStat> {
    // Local storage for .* files and template files
    if (LocalFsProvider.useLocalStorage(uri)) return this.localProvider.stat(uri)
    try {
      const root = await getOrCreateRoot(uri.authority)
      const node = await root.getNodeAsync(uri.path)
      if (!node) throw FileSystemError.FileNotFound(uri)
      if (isAbapFile(node) && !this.isOpenDirtyDocument(uri)) await node.stat()
      if (isAbapFolder(node)) await node.refresh()
      return node
    } catch (e) {
      // Don't log FileNotFound errors for method names/debug artifacts to reduce noise
      if (!(e instanceof FileSystemError && e.name === "FileNotFound (FileSystemError)"))
        log.debug(`Error in stat of ${uri?.toString()}\n${caughtToString(e)}`)
      throw e
    }
  }

  public async readFile(uri: Uri): Promise<Uint8Array> {
    if (LocalFsProvider.useLocalStorage(uri)) return this.localProvider.readFile(uri)
    try {
      const root = await getOrCreateRoot(uri.authority)
      const node = await root.getNodeAsync(uri.path)
      if (isAbapFile(node)) {
        const contents = await node.read()
        openInGui(uri, contents)

        const buf = Buffer.from(contents)
        return buf
      }
    } catch (error) {
      log.debug(`Error reading file ${uri?.toString()}\n${caughtToString(error)}`)
    }
    throw FileSystemError.Unavailable(uri)
  }

  public async readDirectory(uri: Uri): Promise<[string, FileType][]> {
    if (LocalFsProvider.useLocalStorage(uri)) return this.localProvider.readDirectory(uri)

    try {
      const root = await getOrCreateRoot(uri.authority)
      const node = await root.getNodeAsync(uri.path)
      if (!isFolder(node)) throw FileSystemError.FileNotFound(uri)
      if (isAbapFolder(node) && node.size === 0) await node.refresh()
      const files: [string, FileType][] = [...node].map(i => [i.name, i.file.type])
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
    if (LocalFsProvider.useLocalStorage(uri)) return this.localProvider.createDirectory(uri)
    throw FileSystemError.NoPermissions(
      "Not a real filesystem, directory creation is not supported"
    )
  }

  private async askOverwrite(uri: Uri) {
    const choice = await window.showWarningMessage(
      "The SAP object was changed while not locked. Overwrite changes made by others?",
      "Overwrite",
      "Cancel"
    )
    if (choice === "Overwrite") this.overwriteRejected.delete(uri.toString())
    else {
      this.overwriteRejected.add(uri.toString())
      throw new Error(
        `Save cancelled because the file changed during relogin. Change time before relogin`
      )
    }
  }

  private async writewithRelogin(
    root: Root,
    uri: Uri,
    node: AbapFile,
    content: string,
    transportId?: string
  ) {
    const previousChangeTime = node.mtime
    const lock = root.lockManager.lockStatus(uri.path)
    if (lock.status !== "locked") throw new Error("File is not locked")
    try {
      if (this.overwriteRejected.has(uri.toString())) await this.askOverwrite(uri)
      await node.write(content.toString(), lock.LOCK_HANDLE, transportId)
    } catch (error) {
      if (isHttpError(error) && error.status >= 400 && error.status < 500) {
        log(`Error writing file ${uri.toString()}\n${caughtToString(error)}\nAttempting relogin`)
        await root.lockManager.relogin().catch(e => {
          if (!ReloginError.isReloginError(e)) throw e
        })
        await node.stat()
        if (node.mtime !== previousChangeTime) await this.askOverwrite(uri)
        const newlock = await root.lockManager.requestLock(uri.path)
        if (newlock.status !== "locked") throw new Error("File is not locked after relogin")
        await node.write(content.toString(), newlock.LOCK_HANDLE, transportId)
      } else throw error
      this.overwriteRejected.delete(uri.toString())
    }
    await root.lockManager.requestUnlock(uri.path, true)
  }

  public async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
    if (LocalFsProvider.useLocalStorage(uri))
      return this.localProvider.writeFile(uri, content, undefined)
    let needUnlocking = false
    try {
      const root = await getOrCreateRoot(uri.authority)
      const node = await root.getNodeAsync(uri.path)
      if (isAbapFile(node)) {
        handleTelemetry(uri)
        // Always request lock to add claim - prevents deferred unlock race condition
        const oldlock = (await root.lockManager.finalStatus(uri.path)).status
        await root.lockManager.requestLock(uri.path)
        needUnlocking = oldlock === "unlocked"
        const trsel = await selectTransportIfNeeded(uri)
        if (trsel.cancelled) return
        await this.writewithRelogin(root, uri, node, content.toString(), trsel.transport)
        this.pEventEmitter.fire([{ type: FileChangeType.Changed, uri }])
      } else throw FileSystemError.FileNotFound(uri)
    } catch (e) {
      log(`Error writing file ${uri.toString()}\n${caughtToString(e)}`)
      // Clean up lock if we acquired it and write failed
      if (needUnlocking)
        await getOrCreateRoot(uri.authority)
          .then(r => r.lockManager.requestUnlock(uri.path, true))
          .catch(() => undefined)
      throw e
    }
  }

  public async delete(uri: Uri, options: { recursive: boolean }) {
    if (LocalFsProvider.useLocalStorage(uri)) return this.localProvider.delete(uri, options)
    try {
      const root = await getOrCreateRoot(uri.authority)
      const node = await root.getNodeAsync(uri.path)
      const lock = await root.lockManager.requestLock(uri.path)
      if (lock.status === "locked") {
        const trsel = await selectTransportIfNeeded(uri)
        if (trsel.cancelled) return
        if (isAbapFolder(node) || isAbapFile(node))
          return await node.delete(lock.LOCK_HANDLE, trsel.transport)
        else throw FileSystemError.Unavailable("Deletion not supported for this object")
      } else throw FileSystemError.NoPermissions(`Unable to acquire lock`)
    } catch (e) {
      log(`[DELETE ERROR] URI: ${uri.toString()}, Error: ${caughtToString(e)}`)
      const msg = `Error deleting file ${uri.toString()}\n${caughtToString(e)}`
      throw new Error(msg)
    }
  }

  public rename(oldUri: Uri, newUri: Uri, options: { overwrite: boolean }): void | Thenable<void> {
    if (LocalFsProvider.useLocalStorage(oldUri))
      return this.localProvider.rename(oldUri, newUri, options)
    throw new Error("Method not implemented.")
  }
}
