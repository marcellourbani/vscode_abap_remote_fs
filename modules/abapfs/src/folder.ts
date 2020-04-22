import { FileStat } from "vscode"
const tag = Symbol("Folder")

interface Child {
  file: FileStat
  manual: boolean
}

export interface FolderItem {
  name: string
  file: FileStat
}

export const isFolder = (x: any): x is Folder => !!x?.[tag]

export class Folder implements Iterable<FolderItem> {
  *[Symbol.iterator](): Iterator<FolderItem> {
    const mi = this._children.entries()
    for (const [name, child] of mi) yield { name, file: child.file }
  }
  [tag] = true

  private _children = new Map<string, Child>()

  set(name: string, file: FileStat, manual = true) {
    this._children.set(name, { file, manual })
  }

  get(name: string) {
    return this._children.get(name)?.file
  }

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
      if (isFolder(old?.file) && isFolder(file)) old?.file.merge([...file])
      else this.set(name, file, false)
    }
  }

  get size() {
    return this._children.size
  }
}
