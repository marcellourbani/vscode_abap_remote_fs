import { FileStat } from "vscode"

interface Child {
  file: FileStat
  manual: boolean
}

export interface FolderItem {
  name: string
  file: FileStat
}

export class Folder implements Iterable<FolderItem> {
  *[Symbol.iterator](): Iterator<FolderItem> {
    const mi = this._children.entries()
    for (const [name, child] of mi) yield { name, file: child.file }
  }

  private _children = new Map<string, Child>()

  set(name: string, file: FileStat, manual = true) {
    this._children.set(name, { file, manual })
  }

  get(name: string) {
    return this._children.get(name)?.file
  }

  get size() {
    return this._children.size
  }
}
