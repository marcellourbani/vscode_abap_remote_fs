/**
 * TreeDataProvider and TreeItem classes for S/4HANA Readiness Dashboard.
 */

import {
  commands,
  EventEmitter,
  ThemeColor,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState
} from "vscode"
import { CustomReference, GroupedData, ItemGroup } from "./types"

export type S4HNode = S4HRoot | S4HItemNode | S4HRefNode | S4HSummaryNode

export class S4HProvider implements TreeDataProvider<S4HNode> {
  private _emitter = new EventEmitter<S4HNode | undefined>()
  readonly onDidChangeTreeData = this._emitter.event

  private roots = new Map<string, S4HRoot>()
  private filters = new Map<string, string>() // per-connection filter

  getFilter(connectionId: string): string {
    return this.filters.get(connectionId) || ""
  }
  get filter(): string {
    return [...this.filters.values()].find(f => !!f) || ""
  }

  setFilter(filter: string, connectionId?: string) {
    if (connectionId) {
      this.filters.set(connectionId, filter)
      const root = this.roots.get(connectionId)
      if (root) this.roots.set(connectionId, new S4HRoot(connectionId, root.data, filter))
    } else {
      // Apply to all
      for (const [connId, root] of this.roots) {
        this.filters.set(connId, filter)
        this.roots.set(connId, new S4HRoot(connId, root.data, filter))
      }
    }
    this._emitter.fire(undefined)
  }

  getTreeItem(element: S4HNode): TreeItem {
    return element
  }

  async getChildren(element?: S4HNode): Promise<S4HNode[]> {
    if (!element) {
      return [...this.roots.values()]
    }
    if (element instanceof S4HRoot) return element.children
    if (element instanceof S4HItemNode) return element.children
    return []
  }

  setData(connectionId: string, data: GroupedData) {
    const filter = this.getFilter(connectionId)
    const root = new S4HRoot(connectionId, data, filter)
    this.roots.set(connectionId, root)
    this._emitter.fire(undefined)
  }

  clear(connectionId: string) {
    this.roots.delete(connectionId)
    this._emitter.fire(undefined)
  }

  refresh() {
    this._emitter.fire(undefined)
  }

  getRoot(connectionId: string): S4HRoot | undefined {
    return this.roots.get(connectionId)
  }
}

export class S4HRoot extends TreeItem {
  children: S4HNode[]

  constructor(
    public readonly connectionId: string,
    public readonly data: GroupedData,
    filter = ""
  ) {
    super(connectionId.toUpperCase(), TreeItemCollapsibleState.Expanded)
    this.contextValue = filter ? "s4hRootFiltered" : "s4hRoot"
    this.iconPath = new ThemeIcon("server")

    const filterLower = filter.toLowerCase()
    const children: S4HNode[] = []

    // Summary node
    children.push(new S4HSummaryNode(data, this))

    // Item groups
    for (const group of data.groups) {
      const node = new S4HItemNode(group, this, filterLower)
      if (!filterLower || node.children.length > 0) {
        children.push(node)
      }
    }

    // Ungrouped references
    if (data.ungrouped.length > 0) {
      const ungroupedItem: ItemGroup = {
        item: {
          id: "__ungrouped__",
          version: "",
          title: "UNLINKED REFERENCES",
          note: 0,
          replacementId: ""
        },
        refs: data.ungrouped
      }
      const node = new S4HItemNode(ungroupedItem, this, filterLower)
      if (!filterLower || node.children.length > 0) {
        children.push(node)
      }
    }

    this.children = children

    // Set description with filtered count
    const filteredRefCount = children
      .filter(c => c instanceof S4HItemNode)
      .reduce((sum, c) => sum + (c as S4HItemNode).children.length, 0)
    if (filterLower && filteredRefCount !== data.totalRefs) {
      this.description = `${filteredRefCount}/${data.totalRefs} references (filtered)`
    } else {
      this.description = `${data.totalRefs} references`
    }
  }
}

export class S4HSummaryNode extends TreeItem {
  constructor(
    data: GroupedData,
    public readonly parent: S4HRoot
  ) {
    const objTypes = new Map<string, number>()
    const allRefs = [...data.groups.flatMap(g => g.refs), ...data.ungrouped]
    for (const r of allRefs) {
      objTypes.set(r.refObjType, (objTypes.get(r.refObjType) || 0) + 1)
    }
    const breakdown = [...objTypes.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${count} ${type}`)
      .join(" │ ")

    super(
      `${data.totalRefs} references │ ${data.groups.length} simplification items`,
      TreeItemCollapsibleState.None
    )
    this.description = breakdown
    this.contextValue = "s4hSummary"
    this.iconPath = new ThemeIcon("graph", new ThemeColor("charts.blue"))
  }
}

export class S4HItemNode extends TreeItem {
  children: S4HRefNode[]

  constructor(
    public readonly group: ItemGroup,
    public readonly parent: S4HRoot,
    filter = ""
  ) {
    const isUngrouped = group.item.id === "__ungrouped__"
    const label = isUngrouped ? "Unlinked References" : group.item.title
    super(label, TreeItemCollapsibleState.Collapsed)

    this.description = isUngrouped
      ? `${group.refs.length} refs`
      : `Note ${group.item.note} │ ${group.refs.length} refs`
    this.contextValue = isUngrouped ? "s4hUngrouped" : "s4hItem"
    this.iconPath = isUngrouped
      ? new ThemeIcon("question", new ThemeColor("charts.yellow"))
      : new ThemeIcon("bookmark", new ThemeColor("charts.orange"))
    this.tooltip = isUngrouped
      ? "References to objects that couldn't be mapped to a simplification item"
      : `${group.item.title}\nSAP Note: ${group.item.note}\nReferences: ${group.refs.length}`

    // Deduplicate refs by OBJ_NAME to avoid showing same object multiple times
    const seen = new Map<string, CustomReference>()
    for (const ref of group.refs) {
      const key = `${ref.objType}:${ref.objName}:${ref.refObjName}`
      if (!seen.has(key)) {
        seen.set(key, ref)
      }
    }

    // Apply filter (supports * wildcard)
    let filteredRefs = [...seen.values()]
    if (filter) {
      const regex = new RegExp("^" + filter.replace(/\*/g, ".*") + "$", "i")
      filteredRefs = filteredRefs.filter(
        r =>
          regex.test(r.objName) ||
          regex.test(r.refObjName) ||
          r.objName.toLowerCase().includes(filter) ||
          r.refObjName.toLowerCase().includes(filter)
      )
    }

    this.children = filteredRefs.map(r => new S4HRefNode(r, this))

    // Update description with filtered count if different
    const totalDeduped = seen.size
    if (filter && this.children.length !== totalDeduped) {
      this.description = isUngrouped
        ? `${this.children.length}/${totalDeduped} refs (filtered)`
        : `Note ${group.item.note} │ ${this.children.length}/${totalDeduped} refs (filtered)`
    }
  }
}

export class S4HRefNode extends TreeItem {
  constructor(
    public readonly ref: CustomReference,
    public readonly parent: S4HItemNode
  ) {
    const label = ref.objName || ref.refObjName
    super(label, TreeItemCollapsibleState.None)

    this.description = ref.objName
      ? `${ref.objType} → ${ref.refObjName} (${ref.refObjType})`
      : `→ ${ref.refObjName} (${ref.refObjType})`
    this.contextValue = "s4hRef"
    this.iconPath = new ThemeIcon("circle-filled", new ThemeColor("charts.red"))
    this.tooltip = [
      `Custom Object: ${ref.objName} (${ref.objType})`,
      `References: ${ref.refObjName} (${ref.refObjType})`,
      `Package: ${ref.devclass}`,
      ref.includeName ? `Include: ${ref.includeName}` : "",
      ref.refApplComponent ? `Component: ${ref.refApplComponent}` : ""
    ]
      .filter(Boolean)
      .join("\n")
  }

  get connectionId(): string {
    return this.parent.parent.connectionId
  }
}

export const s4hProvider = new S4HProvider()
