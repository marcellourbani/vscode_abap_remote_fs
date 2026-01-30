import {
  EventEmitter,
  FileChangeEvent,
  FileStat,
  FileSystemProvider,
  FileType,
  Disposable,
  Uri,
  ExtensionContext,
  workspace,
  FileChangeType,
  RelativePattern,
  FileSystemWatcher
} from "vscode"
import { LocalStorage } from "./localStorage"
import { ADTSCHEME } from "../adt/conections"
import { templates } from "./initialtemplates"

export class LocalFsProvider implements FileSystemProvider {
  private localStorage: LocalStorage
  
  constructor(private readonly context: ExtensionContext) {
    // Use globalStorageUri - always available, shared across workspaces
    this.localStorage = new LocalStorage(context.globalStorageUri)
  }
  
  public static useLocalStorage(uri: Uri): boolean {
    if (uri.scheme !== ADTSCHEME) return false
    const templatenames = templates.map(t => `/${t.name}`)
    if (templatenames.includes(uri.path)) return true
    return uri.path.match(/(^\.)|(\/\.)/) !== null
  }

  watch(
    uri: Uri,
    options: {
      readonly recursive: boolean
      readonly excludes: readonly string[]
    }
  ): Disposable {
    let disposed = false
    let watcher: FileSystemWatcher | undefined
    // resolve the root that we'll watch
    this.localStorage
      .resolveUri(uri)
      .then(resolved => {
        if (disposed) return
        const pattern = options?.recursive ? "**/*" : "*"
        watcher = workspace.createFileSystemWatcher(new RelativePattern(resolved, pattern))
        const mapAndFire = (type: FileChangeType, u: Uri) => {
          // compute path relative to resolved root
          let rel = u.path
          if (rel.startsWith(resolved.path)) rel = rel.substring(resolved.path.length)
          if (!rel.startsWith("/")) rel = `/${rel}`
          const remote = Uri.parse(`${uri.scheme}://${uri.authority}${rel}`)
          this.pEventEmitter.fire([{ type, uri: remote }])
        }
        watcher.onDidCreate(u => mapAndFire(FileChangeType.Created, u))
        watcher.onDidChange(u => mapAndFire(FileChangeType.Changed, u))
        watcher.onDidDelete(u => mapAndFire(FileChangeType.Deleted, u))
      })
      .catch(e => undefined)
    return new Disposable(() => {
      disposed = true
      watcher?.dispose()
    })
  }
  
  public get onDidChangeFile() {
    return this.pEventEmitter.event
  }
  private pEventEmitter = new EventEmitter<FileChangeEvent[]>()

  async stat(uri: Uri): Promise<FileStat> {
    const resolved = await this.localStorage.resolveUri(uri)
    return workspace.fs.stat(resolved)
  }
  
  async readDirectory(uri: Uri): Promise<[string, FileType][]> {
    try {
      const resolved = await this.localStorage.resolveUri(uri)
      const files = await workspace.fs.readDirectory(resolved)
      return files
    } catch (e) {
      return []
    }
  }
  
  async createDirectory(uri: Uri): Promise<void> {
    const resolved = await this.localStorage.resolveUri(uri)
    await workspace.fs.createDirectory(resolved)
  }
  
  async readFile(uri: Uri): Promise<Uint8Array> {
    return this.localStorage.resolveUri(uri).then(r => workspace.fs.readFile(r))
  }
  
  async writeFile(
    uri: Uri,
    content: unknown,
    options: { create?: boolean; overwrite?: boolean } | unknown
  ): Promise<void> {
    const resolved = await this.localStorage.resolveUri(uri)
    await workspace.fs.writeFile(resolved, content as Uint8Array)
  }
  
  async delete(uri: Uri, options?: { recursive?: boolean } | unknown): Promise<void> {
    const resolved = await this.localStorage.resolveUri(uri)
    await workspace.fs.delete(resolved, options as any)
  }
  
  async rename(
    olduri: Uri,
    newuri: Uri,
    options?: { overwrite?: boolean } | unknown
  ): Promise<void> {
    const rOld = await this.localStorage.resolveUri(olduri)
    const rNew = await this.localStorage.resolveUri(newuri)
    await workspace.fs.rename(rOld, rNew, options as any)
  }
  
  async copy?(source: Uri, destination: Uri, options?: { overwrite?: boolean }): Promise<void> {
    const rSrc = await this.localStorage.resolveUri(source)
    const rDst = await this.localStorage.resolveUri(destination)
    await workspace.fs.copy(rSrc, rDst, options as any)
  }
}
