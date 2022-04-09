import { Dump, Feed } from "abap-adt-api"
import { EventEmitter, Range, TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri, ViewColumn, window, workspace } from "vscode"
import { getClient, getOrCreateClient } from "../../adt/conections"
import { AdtObjectFinder } from "../../adt/operations/AdtObjectFinder"
import { AbapFsCommands, command } from "../../commands"
import { connectedRoots } from "../../config"
// tslint:disable:max-classes-per-file

const jsFooter = `<script type="text/javascript">
const vscode = acquireVsCodeApi();
const as = document.querySelectorAll("a")
console.log(as.length)
as.forEach(
    a=>a.addEventListener('click',e=>{
        const uri = e.currentTarget.attributes.href.value
        if(!uri.match(/^#/)){
            e.preventDefault();
            vscode.postMessage({
                command: 'click',
                uri
            });
        }
    })
)</script>`

const inject = (x: string) => `${x}${jsFooter}`

class DumpItem extends TreeItem {
    readonly tag: "dump"
    private dump: Dump
    private connId: string
    constructor(dump: Dump, connId: string) {
        const label = dump.categories.find(c => c.label === "ABAP runtime error")?.term || "dump"
        super(label, TreeItemCollapsibleState.None)
        this.connId = connId
        this.tag = "dump"
        this.dump = dump
        this.command = {
            title: "show dump",
            command: AbapFsCommands.showDump,
            arguments: [this]
        }
    }
    @command(AbapFsCommands.showDump)
    private static show(i: DumpItem) {
        const panel = window.createWebviewPanel("DUMP", "ABAP Dump", ViewColumn.Active, {
            enableScripts: true, enableCommandUris: true, enableFindWidget: true, retainContextWhenHidden: true
        })
        panel.webview.onDidReceiveMessage(async m => {
            return new AdtObjectFinder(i.connId).displayAdtUri(m.uri)
        })
        panel.webview.html = inject(i.dump.text)
    }
}

class SystemItem extends TreeItem {
    readonly tag = "system"
    private dumpFeed?: Feed | "none"
    contextValue = "system"
    constructor(label: string, private connId: string) { super(label, TreeItemCollapsibleState.Expanded) }
    @command(AbapFsCommands.refreshDumps)
    async refresh(node: any) {
        dumpProvider.emitter.fire(node)
    }
    async children() {
        const client = await getOrCreateClient(this.connId)
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
    emitter = new EventEmitter<Item>()
    get onDidChangeTreeData() {
        return this.emitter.event
    }
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