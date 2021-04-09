import { Dump, Feed } from "abap-adt-api";
import { TreeDataProvider, TreeItem, TreeItemCollapsibleState } from "vscode";
import { getClient } from "../../adt/conections";
import { connectedRoots } from "../../config";
// tslint:disable:max-classes-per-file


class DumpItem extends TreeItem {
    readonly tag: "dump"
    constructor(dump: Dump, connId: string) {
        const label = dump.categories.find(c => c.label === "ABAP runtime error")?.term || "dump"
        super(label, TreeItemCollapsibleState.None)
        this.tag = "dump"
    }
}

class SystemItem extends TreeItem {
    readonly tag = "system"
    private dumpFeed?: Feed | "none"
    constructor(label: string, private connId: string) { super(label, TreeItemCollapsibleState.Expanded) }
    async children() {
        const client = getClient(this.connId)
        if (!this.dumpFeed) {
            const feeds = await client.feeds()
            this.dumpFeed = feeds.find(f => f.href === '/sap/bc/adt/runtime/dumps') || "none"
        }
        if (this.dumpFeed === "none") return []
        const dumpfeed = await client.dumps()
        return dumpfeed.dumps.map(d => new DumpItem(d, this.connId))
    }
}

type Item = SystemItem | DumpItem
class DumpProvider implements TreeDataProvider<Item>{
    private systems = new Map<string, SystemItem>();
    getTreeItem(e: Item) {
        return e
    }
    getChildren(e?: Item) {
        switch (e?.tag) {
            case undefined:
                return this.roots()
            case "system":
                return e.children()
        }
        return []
    }
    private roots() {
        const roots = connectedRoots().keys()
        for (const root of roots) {
            if (!this.systems.has(root)) {
                this.systems.set(root, new SystemItem(root, root))
            }
        }
        return [...this.systems.values()]
    }
}

export const dumpProvider = new DumpProvider()