import { AbapNode, isAbapNode, AbapObjectNode } from "../fs/AbapNode"
import {
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  Uri,
  EventEmitter,
  workspace
} from "vscode"
import { isString, isArray } from "util"
import { path, fileAsync, readAsync } from "fs-jetpack"
import { fromUri, AdtServer, ADTSCHEME } from "../adt/AdtServer"
import { findMainIncludeAsync } from "../adt/abap/AbapObjectUtilities"

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
  }
  get uri() {
    return this.favourite.uri
  }
  get contextValue() {
    return this.favourite.dynamic ? "" : "favourite"
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
          const server = fromUri(uri)
          const node = await server.findNodePromise(uri)
          if (children.length === 0) {
            if (node.numChildren === 0 && node.canRefresh())
              await node.refresh(server.client)

            const childnodes = [...node]
            for (const c of childnodes)
              children.push(
                await favouriteFromUri(
                  uri.with({ path: uri.path + "/" + c[0] }),
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
      this.label = labelOrFav
      this.uri = uri
    } else {
      this.label = labelOrFav.label
      this.collapsibleState = labelOrFav.collapsibleState
      this.uri = labelOrFav.uri
      this.children = labelOrFav.children.map(f => new Favourite(f))
      this.openUri = labelOrFav.openUri
      this.isContainer = labelOrFav.isContainer
    }
  }
}

function nodeLabel(server: AdtServer, node: AbapNode, uri: Uri) {
  const objName = (n: AbapObjectNode) => `${n.abapObject.vsName}`
  if (isAbapNode(node)) return objName(node)
  const curpath = uri.path.split("/")
  let label = curpath.pop() || ""
  while (curpath.length) {
    label = `${curpath.pop()}/${label}`
    const n = server.findNode(uri.with({ path: curpath.join("/") }))
    if (isAbapNode(n)) return `${objName(n)}/${label}`
  }
  return label
}

async function favouriteFromUri(
  uri: Uri,
  dynamic: boolean
): Promise<Favourite> {
  const server = fromUri(uri)
  const node = await server.findNodePromise(uri)
  const collapsibleState = node.isFolder
    ? TreeItemCollapsibleState.Collapsed
    : TreeItemCollapsibleState.None
  const label = nodeLabel(server, node, uri)
  let openUri = ""
  if (node.isFolder) {
    if (isAbapNode(node) && node.abapObject.type.match(/(CLAS)|(PROG)/)) {
      const main = await findMainIncludeAsync(
        { path: uri.path, node },
        server.client
      )
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
    this.emitter.fire()
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
      for (const f of folders) {
        const fav = root.get(f.uri.authority)
        if (fav) favRoot.children.push(...fav)
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
      const saved: Array<[string, FavouriteIf[]]> = await readAsync(
        this.storage,
        "json"
      )
      if (isArray(saved))
        for (const s of saved) root.set(s[0], s[1].map(f => new Favourite(f)))
    }
    return root
  }

  private async save() {
    const root = await this.root
    if (this.storage) fileAsync(this.storage, { content: [...root] })
  }
}
