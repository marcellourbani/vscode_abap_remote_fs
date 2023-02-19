import {
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
  EventEmitter,
  workspace,
  FileStat
} from "vscode"
import { path, fileAsync, readAsync } from "fs-jetpack"
import { NSSLASH, isString } from "../lib"
import { uriRoot, getRoot, ADTSCHEME } from "../adt/conections"
import { isAbapFolder, AbapStat, isAbapStat, isFolder } from "abapfs"

interface FavouriteCache {
  uri: string
  objectUri: string
  children: Favourite[]
}

const cache: Map<string, FavouriteCache> = new Map()

export class FavItem extends TreeItem {
  public favourite: Favourite
  private children?: FavItem[]

  constructor(
    uri: string,
    label: string,
    collapsibleState?: TreeItemCollapsibleState
  )
  constructor(favourite: Favourite)
  constructor(
    favourite: Favourite | string,
    label: string = "",
    collapsibleState = TreeItemCollapsibleState.Expanded
  ) {
    if (isString(favourite)) {
      super(label)
      this.favourite = {
        uri: favourite,
        label,
        collapsibleState,
        children: [],
        openUri: "",
        isContainer: true,
        dynamic: true
      }
    } else {
      super(favourite.label, favourite.collapsibleState)
      this.favourite = favourite
      if (favourite.openUri)
        this.command = {
          title: "",
          command: "vscode.open",
          arguments: [Uri.parse(favourite.openUri)]
        }
    }
    this.contextValue = this.favourite.dynamic ? "" : "favourite"
  }
  get uri() {
    return this.favourite.uri
  }

  public async getChildren() {
    if (!this.children) {
      const favuri = this.favourite.uri
      const children = [...this.favourite.children]
      if (children.length === 0 && favuri) {
        const cached = cache.get(favuri)
        if (cached) children.push(...cached.children)
        else {
          const uri = Uri.parse(favuri)
          const root = uriRoot(uri)
          const node = await root.getNodeAsync(uri.path)
          if (children.length === 0 && isFolder(node)) {
            if (isAbapFolder(node)) if (node?.size === 0) await node.refresh()
            const childnodes = [...node]
            for (const c of childnodes)
              children.push(
                await favouriteFromUri(
                  uri.with({ path: uri.path + "/" + c.name }),
                  true
                )
              )
          }
        }
      }
      this.children = children.map(f => new FavItem(f))
    }
    return this.children
  }
}

interface FavouriteIf {
  label: string
  uri: string
  collapsibleState: TreeItemCollapsibleState
  children: FavouriteIf[]
  openUri: string
  isContainer: boolean
}

const fixold = (x: string) => x.replace(/\uFF0F/g, NSSLASH)
const fixoldu = (x: string) =>
  x.replace(/\%EF\%BC\%8F/g, encodeURIComponent(NSSLASH))

// tslint:disable: max-classes-per-file
class Favourite implements FavouriteIf {
  public readonly label: string
  public readonly uri: string

  constructor(favIf: FavouriteIf)
  constructor(
    label: string,
    uri?: string,
    collapsibleState?: TreeItemCollapsibleState,
    children?: Favourite[],
    openUri?: string
  )
  constructor(
    labelOrFav: string | FavouriteIf,
    uri: string = "",
    public readonly collapsibleState = TreeItemCollapsibleState.Expanded,
    public readonly children: Favourite[] = [],
    public readonly openUri = "",
    public readonly isContainer = false,
    public readonly dynamic = false
  ) {
    if (isString(labelOrFav)) {
      this.label = fixold(labelOrFav)
      this.uri = uri
    } else {
      this.label = fixold(labelOrFav.label)
      this.collapsibleState = labelOrFav.collapsibleState
      this.uri = fixoldu(labelOrFav.uri)
      this.children = labelOrFav.children.map(f => new Favourite(f))
      this.openUri = fixoldu(labelOrFav.openUri)
      this.isContainer = labelOrFav.isContainer
    }
  }
}

function nodeLabel(connId: string, node: FileStat, uri: Uri) {
  const objName = (n: AbapStat) => `${n.object.fsName}`
  if (isAbapStat(node)) return objName(node)
  const curpath = uri.path.split("/")
  let label = curpath.pop() || ""
  const root = getRoot(connId)
  while (curpath.length) {
    label = `${curpath.pop()}/${label}`
    const n = root.getNode(curpath.join("/"))
    if (isAbapStat(n)) return `${objName(n)}/${label}`
  }
  return label
}

async function favouriteFromUri(
  uri: Uri,
  dynamic: boolean
): Promise<Favourite> {
  const root = getRoot(uri.authority)
  const node = await root.getNodeAsync(uri.path)
  if (!node) throw new Error(`Favourite not found:${uri.toString()}`)
  const collapsibleState = isFolder(node)
    ? TreeItemCollapsibleState.Collapsed
    : TreeItemCollapsibleState.None
  const label = nodeLabel(uri.authority, node, uri)
  let openUri = ""
  if (isFolder(node)) {
    if (isAbapFolder(node) && node.object.type.match(/(CLAS)|(PROG)/)) {
      const main = node.mainInclude(uri.path)
      openUri = main ? uri.with({ path: main.path }).toString() : ""
    }
  } else {
    openUri = uri.toString()
  }

  return {
    label,
    uri: uri.toString(),
    children: [],
    collapsibleState,
    openUri,
    isContainer: false,
    dynamic
  }
}

export class FavouritesProvider implements TreeDataProvider<FavItem> {
  public static get() {
    if (!FavouritesProvider.instance)
      FavouritesProvider.instance = new FavouritesProvider()
    return FavouritesProvider.instance
  }
  private static instance?: FavouritesProvider

  public set storagePath(storagePath: string | undefined) {
    this.storage = storagePath
      ? path(storagePath, "favourites.json")
      : undefined
  }

  private rootI?: Map<string, Favourite[]>
  private get root() {
    const readRoot = async () => {
      if (!this.rootI) {
        this.rootI = await this.readFavourite()
      }
      return this.rootI
    }
    return readRoot()
  }

  public get onDidChangeTreeData() {
    return this.emitter.event
  }

  private emitter = new EventEmitter<FavItem | null | undefined>()
  private storage?: string

  public refresh(): void {
    this.emitter.fire(undefined)
  }

  public async getTreeItem(element: FavItem): Promise<TreeItem> {
    return element
  }

  public async getChildren(element?: FavItem | undefined) {
    if (!element) {
      const favRoot = new Favourite("", "")
      const root = await this.root
      const folders = (workspace.workspaceFolders || []).filter(
        f => f.uri.scheme === ADTSCHEME
      )
      if (folders.length === 1) {
        const fav = root.get(folders[0]!.uri.authority)
        if (fav) favRoot.children.push(...fav)
      } else
        for (const f of folders) {
          const cur = new Favourite(f.uri.authority, "")
          favRoot.children.push(cur)
          const fav = root.get(f.uri.authority)
          if (fav) cur.children.push(...fav)
        }

      return new FavItem(favRoot).getChildren()
    }
    return await element.getChildren()
  }

  public async addFavourite(uri: Uri) {
    const root = await this.root
    let favRoot = root.get(uri.authority)
    if (!favRoot) {
      favRoot = []
      root.set(uri.authority, favRoot)
    }
    favRoot.push(await favouriteFromUri(uri, false))
    this.refresh()
    this.save()
  }

  public async deleteFavourite(item: FavItem) {
    const root = await this.root
    const favRoot = root.get(Uri.parse(item.uri).authority)
    if (!favRoot) return
    const idx = favRoot.findIndex(f => f === item.favourite)
    if (idx >= 0) {
      favRoot.splice(idx, 1)
      this.refresh()
      this.save()
    }
  }

  private async readFavourite() {
    const root: Map<string, Favourite[]> = new Map()
    if (this.storage) {
      const saved: [string, FavouriteIf[]][] = await readAsync(
        this.storage,
        "json"
      )
      if (Array.isArray(saved))
        for (const s of saved)
          root.set(
            s[0],
            s[1].map(f => new Favourite(f))
          )
    }
    return root
  }

  private async save() {
    const root = await this.root
    if (this.storage) fileAsync(this.storage, { content: [...root] })
  }
}
