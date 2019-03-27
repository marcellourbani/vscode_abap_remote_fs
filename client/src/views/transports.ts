import { AdtServer } from "./../adt/AdtServer"
import {
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  workspace,
  Uri,
  EventEmitter,
  window,
  ProgressLocation
} from "vscode"
import { ADTSCHEME, fromUri } from "../adt/AdtServer"
import {
  TransportTarget,
  TransportRequest,
  TransportTask,
  TransportObject,
  ADTClient
} from "abap-adt-api"
import { refreshTransports } from "../commands"

class CollectionItem extends TreeItem {
  protected children: CollectionItem[] = []
  constructor(label: string) {
    super(label, TreeItemCollapsibleState.Expanded)
  }
  public addChild(child: CollectionItem) {
    this.children.push(child)
  }

  public async getChildren() {
    return this.children
  }
}
// tslint:disable: max-classes-per-file
class ConnectionItem extends CollectionItem {
  constructor(private uri: Uri) {
    super(uri.authority.toUpperCase())
  }
  public async getChildren() {
    if (this.children.length === 0 && !!this.uri) {
      const server = fromUri(this.uri)
      const transports = await server.client.userTransports(
        server.client.username
      )

      for (const cat of ["workbench", "customizing"]) {
        const targets = (transports as any)[cat] as TransportTarget[]
        if (!targets.length) continue
        const coll = new CollectionItem(cat)
        for (const target of targets)
          coll.addChild(new TargetItem(target, server))
        this.children.push(coll)
      }
    }
    return this.children
  }
}
class TargetItem extends CollectionItem {
  constructor(target: TransportTarget, server: AdtServer) {
    super(`${target["tm:name"]} ${target["tm:desc"]}`)

    for (const cat of ["modifiable", "released"]) {
      const transports = (target as any)[cat] as TransportRequest[]
      if (!transports.length) continue
      const coll = new CollectionItem(cat)
      for (const transport of transports)
        coll.addChild(new TransportItem(transport, server))
      this.children.push(coll)
    }
  }
}

function isTransport(task: TransportTask): task is TransportRequest {
  return !!(task as any).tasks
}

class TransportItem extends CollectionItem {
  constructor(public task: TransportTask, public server: AdtServer) {
    super(`${task["tm:number"]} ${task["tm:owner"]} ${task["tm:desc"]}`)
    this.collapsibleState = TreeItemCollapsibleState.Collapsed
    this.contextValue = task["tm:status"].match(/[DL]/)
      ? "tr_unreleased"
      : "tr_released"
    if (isTransport(task))
      for (const subTask of task.tasks) {
        this.addChild(new TransportItem(subTask, server))
      }
    for (const obj of task.objects) {
      this.addChild(new ObjectItem(obj, server))
    }
  }
}

class ObjectItem extends CollectionItem {
  constructor(private obj: TransportObject, private server: AdtServer) {
    super(`${obj["tm:pgmid"]} ${obj["tm:type"]} ${obj["tm:name"]}`)
    this.collapsibleState = TreeItemCollapsibleState.None
    if (obj["tm:pgmid"].match(/(LIMU)|(R3TR)/))
      this.command = {
        title: "Open",
        command: "abapfs.openTransportObject",
        arguments: [this.obj, this.server]
      }
  }
}

export class TransportsProvider implements TreeDataProvider<CollectionItem> {
  public static get() {
    if (!this.instance) {
      const instance = new TransportsProvider()
      this.instance = instance
      workspace.onDidChangeWorkspaceFolders(() => instance.refresh())
    }
    return this.instance
  }

  private static instance?: TransportsProvider

  public get onDidChangeTreeData() {
    return this.emitter.event
  }

  private root = this.newRoot()
  private emitter = new EventEmitter<CollectionItem>()

  public getTreeItem(element: CollectionItem): TreeItem | Thenable<TreeItem> {
    return element || this.root
  }
  public getChildren(
    element?: CollectionItem | undefined
  ): import("vscode").ProviderResult<CollectionItem[]> {
    if (element) return element.getChildren()
    return this.root.getChildren()
  }

  public refresh() {
    this.root = this.newRoot()
    this.emitter.fire()
  }

  private newRoot() {
    const root = new CollectionItem("root")
    const folders = (workspace.workspaceFolders || []).filter(
      f => f.uri.scheme === ADTSCHEME
    )
    for (const f of folders) root.addChild(new ConnectionItem(f.uri))
    return root
  }
}

export async function deleteTransport(tran: TransportItem) {
  try {
    await tran.server.client.transportDelete(tran.task["tm:number"])
    refreshTransports()
  } catch (e) {
    window.showErrorMessage(e.toString())
  }
}

export async function releaseTransport(tran: TransportItem) {
  try {
    const transport = tran.task["tm:number"]
    await window.withProgress(
      { location: ProgressLocation.Window, title: `Releasing ${transport}` },
      async () => {
        const reports = await tran.server.client.transportRelease(transport)
        const failure = reports.find(r => r["chkrun:status"] !== "released")
        if (failure)
          throw new Error(
            `${transport} not released: ${failure["chkrun:statusText"]}`
          )
      }
    )
    refreshTransports()
  } catch (e) {
    window.showErrorMessage(e.toString())
  }
}
async function pickUser(client: ADTClient) {
  const users = (await client.systemUsers()).map(u => ({
    label: u.title,
    description: u.id,
    payload: u
  }))
  const selected = await window.showQuickPick(users)
  return selected && selected.payload
}
export async function transportOwner(tran: TransportItem) {
  try {
    const selected = await pickUser(tran.server.client)
    if (selected && selected.id !== tran.task["tm:owner"]) {
      await tran.server.client.transportSetOwner(
        tran.task["tm:number"],
        selected.id
      )
      refreshTransports()
    }
  } catch (e) {
    window.showErrorMessage(e.toString())
  }
}

export async function transportAddUser(tran: TransportItem) {
  try {
    const selected = await pickUser(tran.server.client)
    if (selected && selected.id !== tran.task["tm:owner"]) {
      await tran.server.client.transportAddUser(
        tran.task["tm:number"],
        selected.id
      )
      refreshTransports()
    }
  } catch (e) {
    window.showErrorMessage(e.toString())
  }
}
