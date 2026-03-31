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
import { getClient, uriRoot, abapUri } from "../adt/conections"
import { caughtToString, log } from "../lib"

type PropertyNode = PropertyValueItem

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

const combinedTransportLabel = (number: string, description: string) => {
  if (!number) return ""
  return description ? `${number} (${description})` : number
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

  public getChildren(element?: PropertyNode): PropertyNode[] {
    return element ? [] : this.items
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

    const items = this.buildItems(object, lockStatus, transportInfo, mainProgram)

    return {
      items,
      description: object.name
    }
  }

  private buildItems(
    object: AbapObject,
    lockStatus: LockStatus,
    transportInfo: TransportInfo | undefined,
    mainProgram: MainInclude | undefined
  ): PropertyNode[] {
    const transport = currentTransport(lockStatus, transportInfo)
    const items: PropertyValueItem[] = []

    pushIfValue(items, "Name", object.name, { icon: "symbol-object" })
    pushIfValue(items, "Description", objectDescription(object), { icon: "note" })
    pushIfValue(items, "Package", packageName(transportInfo), { icon: "package" })
    pushIfValue(items, "Type", combinedTypeLabel(object, mainProgram), { icon: "symbol-class" })
    pushIfValue(items, "Created At", object.createdAt, { icon: "history" })
    pushIfValue(items, "Created By", object.createdBy, { icon: "person" })
    pushIfValue(items, "Modified At", object.changedAt, { icon: "history" })
    pushIfValue(items, "Modified By", object.changedBy, { icon: "person" })
    pushIfValue(items, "Transport", combinedTransportLabel(transport.number, transport.description), {
      icon: "package"
    })

    return items
  }
}