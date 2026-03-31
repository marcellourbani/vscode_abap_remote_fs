import {
  Event,
  EventEmitter,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  TreeView,
  window,
  workspace,
  Disposable
} from "vscode"
import { TransportInfo } from "abap-adt-api"
import { isAbapStat } from "abapfs"
import { LockStatus } from "abapfs/out/lockObject"
import { MainInclude } from "abap-adt-api"
import { AbapObject } from "abapobject"
import { AbapFsCommands } from "../commands"
import { getClient, uriRoot, abapUri } from "../adt/conections"
import { caughtToString, log } from "../lib"
import { readTransports } from "./transports"

type PropertyNode = PropertyValueItem | TransportPropertyItem | TransportRequestChildItem

type TransportEntry = Record<string, any>

type CachedTransports = {
  expiresAt: number
  promise: Promise<any>
}

type CachedTransportChildren = {
  expiresAt: number
  children: PropertyNode[]
}

class PropertyValueItem extends TreeItem {
  constructor(
    public readonly key: string,
    public readonly value: string,
    public readonly copyValue: string = value,
    icon = "symbol-property"
  ) {
    super(key, TreeItemCollapsibleState.None)
    this.description = value || "-"
    this.tooltip = `${key}: ${value || "-"}`
    this.iconPath = new ThemeIcon(icon)
    this.contextValue = "objectPropertyValue"
  }
}

class TransportRequestChildItem extends TreeItem {
  public readonly connId: string
  public readonly task: Record<string, string>

  constructor(connId: string, transportNumber: string, description: string) {
    super(transportNumber, TreeItemCollapsibleState.None)
    this.connId = connId
    this.description = description || "-"
    this.tooltip = description ? `${transportNumber}: ${description}` : transportNumber
    this.iconPath = new ThemeIcon("package")
    this.contextValue = "objectPropertyValue"
    this.task = {
      "tm:number": transportNumber,
      "tm:uri": transportRequestUri(transportNumber)
    }
    this.command = {
      title: "Open transport in GUI",
      command: AbapFsCommands.transportOpenGui,
      arguments: [this]
    }
  }
}

class TransportPropertyItem extends PropertyValueItem {
  private static readonly transportCache = new Map<string, CachedTransports>()
  private static readonly childrenCache = new Map<string, CachedTransportChildren>()
  private static readonly cacheTtlMs = 30000

  public readonly connId: string
  public readonly user: string
  public readonly task: Record<string, string>
  private transportChildren?: PropertyNode[]

  public static clearTransportCache() {
    this.transportCache.clear()
    this.childrenCache.clear()
  }

  private cacheKey() {
    return `${this.connId}:${this.user.toUpperCase()}:${this.task["tm:number"]}`
  }

  private static readTransportsCached(connId: string, user: string) {
    const key = `${connId}:${user.toUpperCase()}`
    const now = Date.now()
    const cached = this.transportCache.get(key)
    if (cached && cached.expiresAt > now) return cached.promise

    const promise = readTransports(connId, user).catch(error => {
      this.transportCache.delete(key)
      throw error
    })

    this.transportCache.set(key, {
      expiresAt: now + this.cacheTtlMs,
      promise
    })

    return promise
  }

  constructor(
    label: string,
    connId: string,
    user: string,
    transportNumber: string,
    transportUri: string
  ) {
    super("Transport", label, transportNumber, "package")
    this.connId = connId
    this.user = user
    this.task = {
      "tm:number": transportNumber,
      "tm:uri": transportUri
    }
    this.contextValue = "objectPropertyTransport"
    this.collapsibleState = TreeItemCollapsibleState.Collapsed
    this.command = {
      title: "Open transport in GUI",
      command: AbapFsCommands.transportOpenGui,
      arguments: [this]
    }
  }

  public async getChildren(): Promise<PropertyNode[]> {
    if (this.transportChildren) return this.transportChildren

    const childCache = TransportPropertyItem.childrenCache.get(this.cacheKey())
    if (childCache && childCache.expiresAt > Date.now()) {
      this.transportChildren = childCache.children
      return childCache.children
    }

    try {
      const transports = await TransportPropertyItem.readTransportsCached(this.connId, this.user)
      const context = findTransportContext(transports, this.task["tm:number"])

      if (!context) {
        const fallbackChildren: PropertyNode[] = []
        this.transportChildren = fallbackChildren
        TransportPropertyItem.childrenCache.set(this.cacheKey(), {
          expiresAt: Date.now() + TransportPropertyItem.cacheTtlMs,
          children: fallbackChildren
        })
        return fallbackChildren
      }

      const children: PropertyNode[] = []

      if (context.tasks.length > 0) {
        context.tasks.forEach((task: TransportEntry) => {
          children.push(
            new TransportRequestChildItem(
              this.connId,
              task["tm:number"],
              task["tm:desc"] || ""
            )
          )
        })
      }

      this.transportChildren = children
      TransportPropertyItem.childrenCache.set(this.cacheKey(), {
        expiresAt: Date.now() + TransportPropertyItem.cacheTtlMs,
        children
      })
      return children
    } catch (error) {
      this.transportChildren = [
        new PropertyValueItem("Transport details", "Unable to load subtasks", "", "warning")
      ]
      return this.transportChildren
    }
  }
}

type PropertySnapshot = {
  description?: string
  message?: string
  items: PropertyNode[]
}

const stringifyValue = (value: unknown) => {
  if (value === undefined || value === null || value === "") return "-"
  if (value instanceof Date) return value.toLocaleString()
  if (typeof value === "boolean") return value ? "Yes" : "No"
  return `${value}`
}

const pushIfValue = (
  target: PropertyValueItem[],
  key: string,
  value: unknown,
  options?: { copyValue?: string; icon?: string }
) => {
  const text = stringifyValue(value)
  if (text === "-") return
  target.push(new PropertyValueItem(key, text, options?.copyValue ?? text, options?.icon))
}

const currentMainProgram = async (object: AbapObject) => {
  if (object.type !== "PROG/I") return undefined
  const mainPrograms = await object.mainPrograms().catch(() => [] as MainInclude[])
  return mainPrograms[0]
}

const resolveTransportInfo = async (
  connId: string,
  object: AbapObject
): Promise<TransportInfo | undefined> => {
  try {
    return await getClient(connId).transportInfo(object.contentsPath(), "", "")
  } catch (error) {
    return undefined
  }
}

const friendlyTypeLabel = (object: AbapObject, mainProgram?: MainInclude) => {
  const typeMap: Record<string, string> = {
    "CLAS/OC": "Class",
    "CLAS/OM": "Class Method",
    "INTF/OI": "Interface",
    "PROG/P": "Program",
    "PROG/I": mainProgram ? "Include" : "Program Include",
    "FUGR/F": "Function Group",
    "FUGR/FF": "Function Module",
    "DEVC/K": "Package",
    "TABL/DT": "Database Table",
    "DDLS/DF": "CDS View",
    "MSAG/N": "Message Class",
    "TTYP/TT": "Table Type",
    "DOMA/DO": "Domain",
    "DTEL/DE": "Data Element",
    "VIEW/V": "Dictionary View",
    "TRAN/T": "Transaction"
  }

  return typeMap[object.type] || object.type
}

const combinedTypeLabel = (object: AbapObject, mainProgram?: MainInclude) => {
  const friendly = friendlyTypeLabel(object, mainProgram)
  return friendly === object.type ? friendly : `${friendly} (${object.type})`
}

const objectDescription = (object: AbapObject) => {
  const meta = (object.structure?.metaData || {}) as Record<string, unknown>
  return meta["adtcore:description"] || meta["adtcore:name"] || ""
}

const packageName = (transportInfo: TransportInfo | undefined) => transportInfo?.DEVCLASS || ""

const currentTransport = (lockStatus: LockStatus, transportInfo: TransportInfo | undefined) => {
  const number =
    lockStatus.status === "locked" ? lockStatus.CORRNR || "" : transportInfo?.LOCKS?.HEADER?.TRKORR || ""
  if (!number) return { number: "", description: "" }

  const description =
    (lockStatus.status === "locked" ? lockStatus.CORRTEXT || "" : "") ||
    transportInfo?.TRANSPORTS?.find(entry => entry.TRKORR === number)?.AS4TEXT ||
    transportInfo?.LOCKS?.HEADER?.AS4TEXT ||
    ""
  return { number, description }
}

const findTransportContext = (transports: any, number: string) => {
  for (const category of ["workbench", "customizing", "transportofcopies"]) {
    const targets = (transports as any)?.[category] || []
    for (const target of targets) {
      for (const status of ["modifiable", "released"]) {
        const requests = target?.[status] || []
        for (const request of requests) {
          if (request?.["tm:number"] === number) {
            return {
              request,
              tasks: request.tasks || [],
              isTask: false
            }
          }

          const tasks = request?.tasks || []
          if (tasks.some((task: TransportEntry) => task?.["tm:number"] === number)) {
            return {
              request,
              tasks,
              isTask: true
            }
          }
        }
      }
    }
  }
}

const combinedTransportLabel = (number: string, description: string) => {
  if (!number) return ""
  return description ? `${number} (${description})` : number
}

const transportRequestUri = (transportNumber: string) => {
  if (!transportNumber) return ""
  return `/sap/bc/adt/vit/wb/object_type/${encodeURIComponent("    rq")}/object_name/${encodeURIComponent(transportNumber)}`
}

export class ObjectPropertyProvider implements TreeDataProvider<PropertyNode>, Disposable {
  public static get() {
    if (!this.instance) this.instance = new ObjectPropertyProvider()
    return this.instance
  }

  private static instance?: ObjectPropertyProvider

  private readonly emitter = new EventEmitter<PropertyNode | undefined | null | void>()
  private readonly disposables: Disposable[] = []
  private items: PropertyNode[] = []
  private view?: TreeView<PropertyNode>
  private refreshHandle?: NodeJS.Timeout
  private refreshGeneration = 0
  private pendingForceRefresh = false

  public readonly onDidChangeTreeData: Event<PropertyNode | undefined | null | void> =
    this.emitter.event

  private constructor() {
    this.disposables.push(
      window.onDidChangeActiveTextEditor(() => this.scheduleRefresh(true)),
      workspace.onDidChangeTextDocument(event => {
        if (event.document === window.activeTextEditor?.document) this.scheduleRefresh()
      }),
      workspace.onDidSaveTextDocument(document => {
        if (document === window.activeTextEditor?.document) this.scheduleRefresh(true)
      }),
      workspace.onDidCloseTextDocument(document => {
        if (document.uri.toString() === window.activeTextEditor?.document.uri.toString()) {
          this.scheduleRefresh(true)
        }
      })
    )
  }

  public bindView(view: TreeView<PropertyNode>) {
    this.view = view
    this.disposables.push(
      view.onDidChangeVisibility(event => {
        if (event.visible) this.scheduleRefresh(true)
      })
    )
    this.scheduleRefresh(true)
  }

  public dispose() {
    if (this.refreshHandle) clearTimeout(this.refreshHandle)
    this.disposables.forEach(disposable => disposable.dispose())
  }

  public getTreeItem(element: PropertyNode): TreeItem {
    return element
  }

  public getChildren(element?: PropertyNode): PropertyNode[] | Promise<PropertyNode[]> {
    if (!element) return this.items
    if (element instanceof TransportPropertyItem) return element.getChildren()
    return []
  }

  public scheduleRefresh(force = false) {
    this.pendingForceRefresh = this.pendingForceRefresh || force
    if (this.refreshHandle) clearTimeout(this.refreshHandle)
    this.refreshHandle = setTimeout(() => {
      this.refreshHandle = undefined
      const shouldForce = this.pendingForceRefresh
      this.pendingForceRefresh = false
      void this.refresh(shouldForce)
    }, force ? 0 : 250)
  }

  public async refresh(force = false) {
    const generation = ++this.refreshGeneration
    if (this.view) this.view.message = "Loading object properties..."

    try {
      const snapshot = await this.buildSnapshot(force)
      if (generation !== this.refreshGeneration) return

      this.items = snapshot.items
      if (this.view) {
        this.view.description = snapshot.description
        this.view.message = snapshot.message
      }
    } catch (error) {
      if (generation !== this.refreshGeneration) return
      const message = caughtToString(error)
      log(`Object Property view refresh failed: ${message}`)
      this.items = [new PropertyValueItem("Message", message, message, "error")]
      if (this.view) {
        this.view.description = undefined
        this.view.message = "Failed to load object properties. Use refresh to retry."
      }
    }

    this.emitter.fire()
  }

  private async buildSnapshot(force = false): Promise<PropertySnapshot> {
    const editor = window.activeTextEditor
    const uri = editor?.document.uri
    if (!(uri && abapUri(uri))) {
      return {
        items: [],
        message: "Open an ABAP object from an ADT connection to inspect its properties.",
        description: undefined
      }
    }

    const root = uriRoot(uri)
    const node = await root.getNodeAsync(uri.path)
    if (!isAbapStat(node)) {
      return {
        items: [],
        message: "The active editor is not backed by an ABAP repository object.",
        description: undefined
      }
    }

    const object = node.object
    if (force || !object.structure) await object.loadStructure(force)

    const [lockStatus, transportInfo, mainProgram] = await Promise.all([
      root.lockManager.finalStatus(uri.path),
      resolveTransportInfo(uri.authority, object),
      currentMainProgram(object)
    ])

    const transport = currentTransport(lockStatus, transportInfo)

    const user = lockStatus.status === "locked" ? lockStatus.CORRUSER || getClient(uri.authority).username : getClient(uri.authority).username
    const items = this.buildItems(uri.authority, user, object, transport, transportInfo, mainProgram)

    return {
      items,
      description: object.name
    }
  }

  private buildItems(
    connId: string,
    user: string,
    object: AbapObject,
    transport: { number: string; description: string },
    transportInfo: TransportInfo | undefined,
    mainProgram: MainInclude | undefined
  ): PropertyNode[] {
    const items: PropertyValueItem[] = []

    pushIfValue(items, "Name", object.name, { icon: "symbol-object" })
    pushIfValue(items, "Description", objectDescription(object), { icon: "note" })
    pushIfValue(items, "Package", packageName(transportInfo), { icon: "package" })
    pushIfValue(items, "Type", combinedTypeLabel(object, mainProgram), { icon: "symbol-class" })
    pushIfValue(items, "Created At", object.createdAt, { icon: "history" })
    pushIfValue(items, "Created By", object.createdBy, { icon: "person" })
    pushIfValue(items, "Modified At", object.changedAt, { icon: "history" })
    pushIfValue(items, "Modified By", object.changedBy, { icon: "person" })

    const transportLabel = combinedTransportLabel(transport.number, transport.description)
    const transportUri = transportRequestUri(transport.number)
    if (transportLabel && transportUri) {
      items.push(
        new TransportPropertyItem(
            transportLabel,
          connId,
          user,
          transport.number,
          transportUri
        )
      )
    } else {
      pushIfValue(items, "Transport", transportLabel, {
        icon: "package"
      })
    }

    return items
  }
}