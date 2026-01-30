import { FileStat, FileType } from "vscode"
const tag = Symbol("Folder")
const refTime = new Date().getMilliseconds()

interface Child {
  file: FileStat
  manual: boolean
}

export interface FolderItem {
  name: string
  file: FileStat
}
export interface PathItem {
  path: string
  file: FileStat
}

export const isFolder = (x: any): x is Folder => !!x?.[tag]
export const isRefreshable = (f: any): f is Refreshable =>
  isFolder(f) && typeof (f as any).refresh === "function"

export class Folder implements Iterable<FolderItem>, FileStat {
  [tag] = true
  type = FileType.Directory
  private _children = new Map<string, Child>();

  *[Symbol.iterator](): Iterator<FolderItem> {
    const mi = this._children.entries()
    for (const [name, child] of mi) yield { name, file: child.file }
  }
  *expandPath(startPath = ""): Generator<PathItem> {
    for (const child of this) {
      const path = `${startPath}/${child.name}`
      yield { path, file: child.file }
      if (isFolder(child.file)) yield* child.file.expandPath(path)
    }
  }
  get ctime() {
    return refTime
  }
  get mtime() {
    return refTime
  }
  /** adds/replaces a child
   *  returns this to allow chaining
   *
   *  manual is used for things not actually found in the fs which beong there
   */
  set(name: string, file: FileStat, manual = true) {
    this._children.set(name, { file, manual })
    return this
  }

  get(name: string) {
    return this._children.get(name)?.file
  }

  protected hasManual() {
    for (const [_, child] of this._children) if (child.manual) return true
    for (const [_, child] of this._children)
      if (isFolder(child) && child.hasManual()) return true
  }

  /** finds a file/folder given a path
   *   Only works with nodes already seen
   */
  getNode(path: string): FileStat | undefined {
    const parts = path.split("/").filter(x => x)
    const nodePath = this.getNodePathInt(parts, "")
    return nodePath[0]?.file
  }

  /** finds a file/folder given a path
   *   expanding nodes as needed
   */
  async getNodeAsync(path: string) {
    const parts = path.split("/").filter(x => x)
    const item = await this.getPathAsyncInt(parts, "")
    return item[0]?.file
  }

  /** finds a file/folder and all predecessos given a path
   *   Only works with nodes already seen
   */
  getNodePath(path: string) {
    const parts = path.split("/").filter(x => x)
    return this.getNodePathInt(parts, "")
  }

  /** finds a file/folder and all predecessos given a path
   *   expanding nodes as needed
   */
  getNodePathAsync(path: string) {
    const parts = path.split("/").filter(x => x)
    return this.getPathAsyncInt(parts, "")
  }

  get size() {
    return this._children.size
  }

  /** Merges a folder structure
   *  We should never replace a node with a new one, only add/remove
   *
   * - entries missing are removed unless manually added
   * - new entries are added
   * - folders matching old ones are merged recursively
   * - leaves matching old ones are left alone
   */
  public merge(items: FolderItem[]) {
    // clean missing
    for (const [name, child] of this._children.entries()) {
      if (child.manual || items.find(i => i.name === name)) continue
      if (isFolder(child.file) && child.file.hasManual()) child.file.merge([])
      else this._children.delete(name)
    }

    for (const item of items) {
      const { name, file } = item
      const old = this._children.get(name)
      // new file
      if (!old) this.set(name, file, false)
      // merge children
      else if (isFolder(old?.file) && isFolder(file)) old?.file.merge([...file])
      // do something when I get a new leaf? or a leaf is replaced by a folder> Probably best to ignore
    }
  }

  private getNodePathInt(parts: string[], start: string): PathItem[] {
    let current: PathItem = { file: this, path: `${start || "/"}` }
    const nodePath = [current]
    for (const p of parts) {
      const file = isFolder(current.file) && current.file.get(p)
      if (!file) return []
      const path = current.path === "/" ? `/${p}` : `${current.path}/${p}`
      current = { file, path }
      nodePath.unshift(current)
    }
    return nodePath
  }

  private async getPathAsyncInt(
    parts: string[],
    start: string
  ): Promise<PathItem[]> {
    let nodePath = this.getNodePathInt(parts, start)
    if (nodePath.length) return nodePath
    let current: PathItem = { file: this, path: `${start || "/"}` }
    nodePath = [current]
    let refresh: (() => any) | undefined

    for (const p of parts) {
      if (isRefreshable(current.file)) {
        const f = current.file
        refresh = async () => {
          await f.refresh()
          refresh = undefined
        }
      }
      if (isFolder(current.file)) {
        let file = current.file.get(p)
        if (!file && refresh) {
          await refresh()
          file = current.file.get(p)
        }
        if (!file) return []
        const path = current.path === "/" ? `/${p}` : `${current.path}/${p}`
        current = { file, path }
        nodePath.unshift(current)
      } else return []
    }
    return nodePath
  }
}

interface Refreshable extends Folder {
  refresh: () => Promise<void>
}
