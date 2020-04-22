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

export const isFolder = (x: any): x is Folder => !!x?.[tag]

export class Folder implements Iterable<FolderItem>, FileStat {
  *[Symbol.iterator](): Iterator<FolderItem> {
    const mi = this._children.entries()
    for (const [name, child] of mi) yield { name, file: child.file }
  }
  [tag] = true
  type = 2 // FileType.Directory
  get ctime() {
    return refTime
  }
  get mtime() {
    return refTime
  }

  private _children = new Map<string, Child>()

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

  /** Merges a folder structure
   *  We should never replace a node with a new one, only add/remove
   *
   * - entries missing are removed unless manually added
   * - new entries are added
   * - folders matching old ones are merged recursively
   * - leaves matching old ones are left alone
   */
  merge(items: FolderItem[]) {
    const toRemove = [...this._children.entries()]
      .filter(
        ([name, child]) => !child.manual && !items.find(i => i.name === name)
      )
      .map(([name]) => name)

    for (const name of toRemove) this._children.delete(name)
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

  get size() {
    return this._children.size
  }
}
