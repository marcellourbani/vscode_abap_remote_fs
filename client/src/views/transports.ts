import { PACKAGE } from "../adt/operations/AdtObjectCreator"
import {
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  workspace,
  Uri,
  EventEmitter,
  window,
  ProgressLocation,
  commands,
  env
} from "vscode"
import {
  TransportTarget,
  TransportRequest,
  TransportTask,
  TransportObject,
  TransportReleaseReport,
  SAPRC,
  ADTClient,
  TransportConfigurationEntry
} from "abap-adt-api"
import { command, AbapFsCommands } from "../commands"
import { caughtToString, withp } from "../lib"
import {
  getClient,
  ADTSCHEME,
  getOrCreateClient,
  getRoot
} from "../adt/conections"
import { isFolder, isAbapStat, PathItem, isAbapFolder } from "abapfs"
import { createUri } from "../adt/operations/AdtObjectFinder"
import { AbapScm, displayRevDiff } from "../scm/abaprevisions"
import { AbapRevisionService } from "../scm/abaprevisions/abaprevisionservice"
import { runInSapGui, showInGuiCb } from "../adt/sapgui/sapgui"
import { atcProvider } from "./abaptestcockpit"
import { pickUser } from "./utilities"

const currentUsers = new Map<string, string>()

const getTransportConfig = async (client: ADTClient) => {
  const configs = await client.transportConfigurations()

  if (configs[0]) return configs[0]
  await client.createTransportsConfig()
  const newconfigs = await client.transportConfigurations()
  if (!newconfigs[0]) throw new Error("Transport configuration not found")
  return newconfigs[0]

}

const readTransports = async (connId: string, user: string) => {
  const client = getClient(connId)
  if (await client.hasTransportConfig()) {
    const User = user.toUpperCase()
    const { etag, link } = await getTransportConfig(client)
    const config = await client.getTransportConfiguration(link)
    if (config.User !== User) await client.setTransportsConfig(link, etag, { ...config, User })
    return client.transportsByConfig(link)
  }
  else return client.userTransports(user)
}

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
  private get user() {
    const client = getClient(this.uri.authority)
    return currentUsers.get(this.uri.authority) || client.username
  }

  // @ts-ignore
  public get label() {
    return `${this.uri.authority.toUpperCase()} Transport of ${this.user.toUpperCase()}`
  }

  public set label(l: string) {
    // will never change
  }

  constructor(public uri: Uri) {
    super(uri.authority.toUpperCase())
    this.contextValue = "tr_connection"
  }

  public async getChildren() {
    if (this.children.length === 0 && !!this.uri) {
      const transports = await readTransports(this.uri.authority, this.user)

      for (const cat of ["workbench", "customizing", "transportofcopies"]) {
        const targets = (transports as any)[cat] as TransportTarget[]
        if (!targets?.length) continue
        const coll = new CollectionItem(cat)
        for (const target of targets)
          coll.addChild(new TargetItem(target, this.uri.authority))
        this.children.push(coll)
      }
    }
    return this.children
  }
}

class TargetItem extends CollectionItem {
  constructor(target: TransportTarget, connId: string) {
    super(`${target["tm:name"]} ${target["tm:desc"]}`)

    for (const cat of ["modifiable", "released"]) {
      const transports = (target as any)[cat] as TransportRequest[]
      if (!transports.length) continue
      const coll = new CollectionItem(cat)
      for (const transport of transports)
        coll.addChild(new TransportItem(transport, connId))
      this.children.push(coll)
    }
  }
}

function isTransport(task: TransportTask): task is TransportRequest {
  return !!(task as any).tasks
}

const failuretext = (failure: TransportReleaseReport) =>
  failure.messages
    .filter(m => m["chkrun:type"] === SAPRC.Error)
    .map(m => m["chkrun:shortText"])
    .join(" ") || failure["chkrun:statusText"]

class TransportItem extends CollectionItem {
  label: string | undefined
  public static isA(x: any): x is TransportItem {
    return x && (x as TransportItem).typeId === TransportItem.tranTypeId
  }
  private static tranTypeId = Symbol()
  @command(AbapFsCommands.releaseTransport)
  private static async releaseTransport(tran: TransportItem) {
    try {
      const transport = tran.task["tm:number"]
      await window.withProgress(
        { location: ProgressLocation.Window, title: `Releasing ${transport}` },
        async () => {
          // before releasing the main transports, release subtasks if
          //  - not released
          //  - not empty
          const tasks = tran.children.filter(
            c => TransportItem.isA(c) && c.children.length && !c.released
          )
          // append main transport as last
          tasks.push(tran)
          for (const task of tasks) {
            if (!TransportItem.isA(task)) continue // just to make ts happy
            const reports = await getClient(task.connId).transportRelease(
              task.task["tm:number"]
            )
            const failure = reports.find(r => r["chkrun:status"] !== "released")
            if (failure) {
              throw new Error(
                `${transport} not released: ${failuretext(failure)}`
              )
            }
          }
        }
      )
      commands.executeCommand(AbapFsCommands.refreshtransports)
    } catch (e) {
      window.showErrorMessage(caughtToString(e))
    }
  }
  public readonly typeId: symbol

  public get released() {
    return !this.task["tm:status"].match(/[DL]/)
  }

  // @ts-ignore
  public get contextValue() {
    return this.released ? "tr_released" : "tr_unreleased"
  }

  constructor(
    public task: TransportTask,
    public connId: string,
    public transport?: TransportItem
  ) {
    super(`${task["tm:number"]} ${task["tm:owner"]} ${task["tm:desc"]}`)
    this.typeId = TransportItem.tranTypeId
    this.collapsibleState = TreeItemCollapsibleState.Collapsed
    if (isTransport(task))
      for (const subTask of task.tasks) {
        this.addChild(new TransportItem(subTask, connId, this))
      }
    for (const obj of task.objects) {
      this.addChild(new ObjectItem(obj, connId, this))
    }
  }

  public get revisionFilter(): RegExp {
    if (this.transport) return this.transport.revisionFilter
    const trChildren = this.children.filter(TransportItem.isA)
    return RegExp(
      [this, ...trChildren].map(ti => ti.task["tm:number"]).join("|")
    )
  }
}

class ObjectItem extends CollectionItem {
  public static isA(x: any): x is ObjectItem {
    return x && (x as ObjectItem).typeId === ObjectItem.objTypeId
  }
  private static objTypeId = Symbol()
  public readonly typeId: symbol
  constructor(
    public readonly obj: TransportObject,
    public readonly connId: string,
    public readonly transport: TransportItem
  ) {
    super(`${obj["tm:pgmid"]} ${obj["tm:type"]} ${obj["tm:name"]}`)
    this.typeId = ObjectItem.objTypeId
    this.collapsibleState = TreeItemCollapsibleState.None
    this.contextValue = "tr_object"
    if (obj["tm:pgmid"].match(/(LIMU)|(R3TR)/))
      this.command = {
        title: "Open",
        command: AbapFsCommands.openTransportObject,
        arguments: [this.obj, this.connId]
      }
  }

  public sameObj(other: ObjectItem) {
    const oo = other.obj
    const to = this.obj
    return (
      oo["tm:pgmid"] === to["tm:pgmid"] &&
      oo["tm:type"] === to["tm:type"] &&
      oo["tm:name"] === to["tm:name"]
    )
  }
}

export class TransportsProvider implements TreeDataProvider<CollectionItem> {
  public static get() {
    if (!this.instance) {
      const instance = new TransportsProvider()
      this.instance = instance
      workspace.onDidChangeWorkspaceFolders(() => instance.refresh())
      instance.refresh()
    }
    return this.instance
  }

  private static instance?: TransportsProvider

  public get onDidChangeTreeData() {
    return this.emitter.event
  }

  private root = this.newRoot()
  private emitter = new EventEmitter<CollectionItem | null>()

  public getTreeItem(element: CollectionItem): TreeItem | Thenable<TreeItem> {
    return element || this.root
  }
  public getChildren(
    element?: CollectionItem | undefined
  ): import("vscode").ProviderResult<CollectionItem[]> {
    if (element) return element.getChildren()
    return this.root.getChildren()
  }

  public async refresh() {
    const root = this.newRoot()

    const folders = (workspace.workspaceFolders || []).filter(
      f => f.uri.scheme === ADTSCHEME
    )
    for (const f of folders) {
      const client = await getOrCreateClient(f.uri.authority)
      const hasTR = await client.featureDetails("Change and Transport System")
      if (
        hasTR &&
        hasTR.collection.find(
          c => c.href === "/sap/bc/adt/cts/transportrequests"
        )
      )
        root.addChild(new ConnectionItem(f.uri))
    }
    this.root = root
    this.emitter.fire(null)
  }

  private newRoot() {
    return new CollectionItem("root")
  }

  // tslint:disable: member-ordering
  private static async decodeTransportObject(
    obj: TransportObject,
    connId: string,
    main = true
  ) {
    if (!obj) return
    let url: string
    try {
      url = await getClient(connId).transportReference(
        obj["tm:pgmid"],
        obj["tm:type"],
        obj["tm:name"]
      )
    } catch (e) {
      return
    }
    try {
      const root = getRoot(connId)
      const path = await root.findByAdtUri(url, main)
      return path
    } catch (e) {
      throw new Error(
        `Error locating object ${obj["tm:pgmid"]} ${obj["tm:type"]} ${obj["tm:name"]
        }: ${caughtToString(e)}`
      )
    }
  }

  @command(AbapFsCommands.transportObjectDiff)
  private static async openTransportObjectDiff(item: ObjectItem) {
    let displayed = false
    try {
      await withp("Opening diff...", async () => {
        const path = await this.decodeTransportObject(item.obj, item.connId)
        if (!path || !path.path || !isAbapStat(path.file)) return
        const uri = createUri(item.connId, path.path)
        const obj = path.file.object
        const client = getClient(item.connId)

        const revisions = await AbapRevisionService.get(
          item.connId
        ).objRevisions(obj)
        const beforeTr = revisions?.find(
          r => !r.version.match(item.transport.revisionFilter)
        )
        if (!beforeTr) return
        displayed = true
        return displayRevDiff(undefined, beforeTr, uri)
      })
      if (!displayed)
        window.showInformationMessage(
          `No previous version found for object ${item.label}`
        )
    } catch (e) {
      window.showErrorMessage(
        `Error displaying transport object: ${caughtToString(e)}`
      )
    }
  }

  @command(AbapFsCommands.openTransportObject)
  private static async openTransportObject(
    obj: TransportObject,
    connId: string
  ) {
    let displayed = false
    try {
      await withp("Opening object...", async () => {
        const path = await this.decodeTransportObject(obj, connId)
        if (!path || !path.path) return
        const uri = Uri.parse("adt://foo/").with({
          authority: connId,
          path: path.path
        })

        const document = await workspace.openTextDocument(uri)
        displayed = true
        return window.showTextDocument(document, {
          preserveFocus: false
        })
      })
      if (!displayed)
        window.showInformationMessage(
          `Object ${obj["tm:type"]} ${obj["tm:name"]} not found`
        )
    } catch (e) {
      window.showErrorMessage(
        `Error displaying transport object: ${caughtToString(e)}`
      )
    }
  }

  @command(AbapFsCommands.deleteTransport)
  private static async deleteTransport(tran: TransportItem) {
    try {
      await getClient(tran.connId).transportDelete(tran.task["tm:number"])
      this.refreshTransports()
    } catch (e) {
      window.showErrorMessage(caughtToString(e))
    }
  }

  @command(AbapFsCommands.refreshtransports)
  private static async refreshTransports() {
    TransportsProvider.get().refresh()
  }

  @command(AbapFsCommands.transportOwner)
  private static async transportOwner(tran: TransportItem) {
    try {
      const selected = await pickUser(tran.connId)
      if (selected && selected.id !== tran.task["tm:owner"]) {
        await getClient(tran.connId).transportSetOwner(
          tran.task["tm:number"],
          selected.id
        )
        this.refreshTransports()
      }
    } catch (e) {
      window.showErrorMessage(caughtToString(e))
    }
  }

  @command(AbapFsCommands.transportOpenGui)
  private static openTransportInGui(tran: TransportItem) {
    return runInSapGui(tran.connId, showInGuiCb(tran.task["tm:uri"]))
  }

  @command(AbapFsCommands.transportCopyNumber)
  private static copyTransportNumber(tran: TransportItem) {
    env.clipboard.writeText(tran.task["tm:number"])
  }

  @command(AbapFsCommands.transportRunAtc)
  private static async runAtdOnTransport(tran: TransportItem) {
    try {
      await window.withProgress(
        { location: ProgressLocation.Window, title: `Running ABAP Test cockpit on ${tran.task["tm:number"]}` },
        () => atcProvider.runInspectorByAdtUrl(tran.task["tm:uri"], tran.connId)
      )
    } catch (e) {
      return window.showErrorMessage(caughtToString(e))
    }
  }

  @command(AbapFsCommands.transportAddUser)
  private static async transportAddUser(tran: TransportItem) {
    try {
      const selected = await pickUser(tran.connId)
      if (selected && selected.id !== tran.task["tm:owner"]) {
        await getClient(tran.connId).transportAddUser(
          tran.task["tm:number"],
          selected.id
        )
        this.refreshTransports()
      }
    } catch (e) {
      window.showErrorMessage(caughtToString(e))
    }
  }

  @command(AbapFsCommands.transportRevision)
  private static async transportRevision(tran: TransportItem) {
    const transport = tran.task["tm:number"]
    const children = await tran.getChildren()
    // find the objects in transports and subtasks
    const trobjects = children.filter(ObjectItem.isA)
    for (const child of children.filter(TransportItem.isA)) {
      const gc = await child.getChildren()
      for (const obj of gc.filter(ObjectItem.isA))
        if (!trobjects.find(o => o.sameObj(obj))) trobjects.push(obj)
    }

    if (!trobjects.length) return

    const paths: PathItem[] = []
    const addNode = async (node: PathItem) => {
      if (isAbapStat(node.file) && node.file.object.canBeWritten) {
        if (paths.find(p => p.path === node.path)) return
        paths.push(node)
        await AbapScm.get(tran.connId).addTransport(
          tran.label || transport,
          [node],
          tran.revisionFilter
        )
      }
    }

    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        cancellable: true,
        title: `Creating scm group for transport ${transport}`
      },
      async (progress, token) => {
        for (const tro of trobjects) {
          if (token.isCancellationRequested) return
          progress.report({ increment: (1 * 100) / trobjects.length })
          try {
            const path = await this.decodeTransportObject(
              tro.obj,
              tro.connId,
              false
            )
            if (!path) continue
            if (isAbapFolder(path.file)) {
              // expand folders to children
              if (!isAbapStat(path.file)) continue
              const obj = path.file.object
              // for packages we don't really care about contents
              if (obj.type === PACKAGE) continue
              const allChildren = (item: PathItem) =>
                isFolder(item.file) ? [...item.file.expandPath(item.path)] : []
              let components = allChildren(path)
              if (components.length === 0) {
                await path.file.refresh()
                components = allChildren(path)
              }
              for (const child of allChildren(path)) await addNode(child)
            } else await addNode(path)
          } catch (e) {
            window.showErrorMessage(caughtToString(e))
          }
        }
      }
    )
  }

  @command(AbapFsCommands.transportUser)
  private static async transportSelectUser(conn: ConnectionItem) {
    const connId = conn.uri.authority
    const selected = await pickUser(connId)

    if (!selected) return

    if (currentUsers.get(connId) === selected.id) return

    currentUsers.set(connId, selected.id)
    this.refreshTransports()
  }
}
