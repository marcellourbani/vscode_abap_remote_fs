import { ADTClient, AtcWorkList, UriParts } from "abap-adt-api"
import { Task } from "fp-ts/lib/Task"
import { commands, EventEmitter, Position, Selection, ThemeColor, ThemeIcon, TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri, window, workspace } from "vscode"
import { AbapFsCommands, command } from "../../commands"
import { vsCodeUri } from "../../langClient"
import { showErrorMessage } from "../../lib"
import { getVariant, runInspector } from "./codeinspector"
type AtcWLobject = AtcWorkList["objects"][0]
type AtcWLFinding = AtcWLobject["findings"][0]
// tslint:disable:max-classes-per-file
class AtcRoot extends TreeItem {
    systems = new Map<string, AtcSystem>()
    constructor(label: string, private parent: AtcProvider) {
        super(label, TreeItemCollapsibleState.Expanded)
    }
    get children() {
        return [...this.systems.values()]
    }
    async child(key: string, creator: Task<string>) {
        const cached = this.systems.get(key)
        if (cached) return cached
        const variant = await creator()
        const system = new AtcSystem(key, variant, this)
        this.systems.set(key, system)
        this.parent.emitter.fire(undefined)
        return system
    }
    static isA(x: any): x is AtcRoot {
        return x instanceof AtcRoot
    }
}

class AtcSystem extends TreeItem {
    children: AtcObject[] = []
    setWorklist(worklist: AtcWorkList) {
        this.children = worklist.objects.map(o => new AtcObject(o, this))
    }
    constructor(public readonly connectionId: string, public readonly variant: string, public readonly parent: AtcRoot) {
        super(connectionId, TreeItemCollapsibleState.Expanded)
    }
}

class AtcObject extends TreeItem {
    children: AtcFind[] = []
    constructor(public readonly object: AtcWLobject, public readonly parent: AtcSystem) {
        super(`${object.type} ${object.name}`, TreeItemCollapsibleState.Expanded)
        this.children = object.findings.map(f => new AtcFind(f, this))
    }
}
class AtcFind extends TreeItem {
    children: AtcFind[] = []
    constructor(public readonly finding: AtcWLFinding, public readonly parent: AtcObject) {
        super(finding.checkTitle, TreeItemCollapsibleState.None)
        if (finding.quickfixInfo)
            this.iconPath = new ThemeIcon("issue-opened", new ThemeColor("list.warningForeground"))
        else
            this.iconPath = new ThemeIcon("check", new ThemeColor("notebookStatusSuccessIcon.foreground"))
        this.description = finding.messageTitle
        this.command = {
            title: "Open",
            command: AbapFsCommands.openLocation,
            arguments: [parent.parent.connectionId, finding.location]
        }
    }
}

type AtcNode = AtcRoot | AtcSystem | AtcObject | AtcFind
class AtcProvider implements TreeDataProvider<AtcNode>{
    emitter = new EventEmitter<AtcNode | undefined>()
    root = new AtcRoot("systems", this)
    get onDidChangeTreeData() {
        return this.emitter.event
    }
    getTreeItem(element: AtcNode): AtcNode {
        return element
    }
    async getChildren(element?: AtcNode): Promise<AtcNode[]> {
        return element ? element.children : this.root.children
    }

    async runInspector(uri: Uri, client: ADTClient) {
        const system = await this.root.child(uri.authority, () => getVariant(client, uri.authority))
        const worklist = await runInspector(uri, system.variant, client)
        system.setWorklist(worklist)
        this.emitter.fire(system)
        commands.executeCommand("abapfs.atcFinds.focus")
    }

    @command(AbapFsCommands.openLocation)
    private async OpenLocation(connId: string, location: UriParts) {
        try {
            const uri = await vsCodeUri(connId, location.uri, false)
            const uriP = Uri.parse(uri)
            const document = await workspace.openTextDocument(uriP)
            const doc = await window.showTextDocument(document, { preserveFocus: false })
            const pos = new Position(location.range.start.line - 1, location.range.start.column)
            doc.selection = new Selection(pos, pos)
        } catch (error) {
            showErrorMessage(error)
        }
    }
}

export const atcProvider = new AtcProvider()