import { ADTClient, AtcWorkList } from "abap-adt-api"
import { Task } from "fp-ts/lib/Task"
import { commands, Disposable, EventEmitter, Position, TextDocumentContentChangeEvent, ThemeColor, ThemeIcon, TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri } from "vscode"
import { getClient } from "../../adt/conections"
import { AdtObjectFinder } from "../../adt/operations/AdtObjectFinder"
import { AbapFsCommands } from "../../commands"
import { AtcWLFinding, AtcWLobject, getVariant, runInspector, runInspectorByAdtUrl } from "./codeinspector"
import * as R from "ramda"
import { AbapFile } from "abapfs"
import { AdtObjectActivator } from "../../adt/operations/AdtObjectActivator"
import { atcRefresh } from "./commands"
import { AbapObjectBase } from "abapobject/out/AbapObject"

// tslint:disable:max-classes-per-file

export interface FindingMarker {
    finding: AtcWLFinding,
    uri: string,
    start: Position
}

export const hasExemption = (f: AtcWLFinding) => !!f.exemptionApproval

export class AtcRoot extends TreeItem {
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

export class AtcSystem extends TreeItem {
    children: AtcObject[] = []
    // tslint:disable-next-line:no-empty
    refresh: Task<void> = async () => { }
    async load(task: Task<AtcWorkList>) {
        this.refresh = async () => {
            const wl = await task()
            const finder = new AdtObjectFinder(this.connectionId)
            this.children = []

            const objects = R.sortWith<AtcWLobject>([
                R.ascend(R.prop("type")),
                R.ascend(R.prop("name"))])
                (wl.objects.filter(o => o.findings.length > 0))
            for (const object of objects) this.children.push(await AtcObject.create(object, this, finder))
            atcProvider.emitter.fire(this)
        }
        return this.refresh()
    }
    constructor(public readonly connectionId: string, public readonly variant: string, public readonly parent: AtcRoot) {
        super(connectionId, TreeItemCollapsibleState.Expanded)
    }
}

export class AtcObject extends TreeItem {
    children: AtcFind[] = []
    static async create(object: AtcWLobject, parent: AtcSystem, finder: AdtObjectFinder) {
        const obj = new AtcObject(object, parent)
        const children: AtcFind[] = []
        for (const f of object.findings) {
            const { uri, start, file } = await finder.vscodeRange(f.location)
            const finding = new AtcFind(f, obj, uri, start || new Position(0, 0), file)
            children.push(finding)
        }

        obj.children = R.sortWith<AtcFind>([
            R.ascend(f => f.finding.priority),
            R.ascend(R.prop("uri")),
            R.ascend(f => f.start?.line || 0)])
            (children)
        obj.contextValue = object.findings.find(f => !!f.quickfixInfo) ? "object" : "object_exempted"
        return obj
    }
    constructor(public readonly object: AtcWLobject, public readonly parent: AtcSystem) {
        super(`${object.type} ${object.name}`, TreeItemCollapsibleState.Expanded)
    }
}
export class AtcFind extends TreeItem {
    children: AtcFind[] = []
    private unSavedStart: Position

    public get start() {
        return this.unSavedStart
    }
    public applyEdits(edits: readonly TextDocumentContentChangeEvent[]) {
        for (const edit of edits) {
            if (edit.range.start.line <= this.start.line) {
                const deltalines = edit.text.split("\n").length + edit.range.start.line - edit.range.end.line - 1
                this.unSavedStart = new Position(this.unSavedStart.line + deltalines, this.unSavedStart.character)
            }
        }
    }
    public savePosition() {
        this._start = this.unSavedStart
    }
    public cancelEdits() {
        this.unSavedStart = this.start
    }
    constructor(public readonly finding: AtcWLFinding, public readonly parent: AtcObject, public readonly uri: string, private _start: Position, file?: AbapFile) {
        super(finding.messageTitle, TreeItemCollapsibleState.None)
        this.unSavedStart = _start
        if (finding.quickfixInfo) {
            this.iconPath = new ThemeIcon("issue-opened", this.iconColor())
            this.contextValue = "finding"
        }
        else {
            this.contextValue = "finding_exempted"
            this.iconPath = new ThemeIcon("check", this.iconColor())
        }
        this.description = finding.checkTitle
        if (file) this.tooltip = `${file.object.type} ${file.object.name}`
        this.command = {
            title: "Open",
            command: AbapFsCommands.openLocation,
            arguments: [this]
        }
    }
    iconColor() {
        switch (this.finding.priority) {
            case 1: return new ThemeColor("list.errorForeground")
            case 2: return new ThemeColor("list.warningForeground")
            default: return new ThemeColor("list.deemphasizedForeground")
        }
    }
}

export type AtcNode = AtcRoot | AtcSystem | AtcObject | AtcFind
class AtcProvider implements TreeDataProvider<AtcNode>{
    emitter = new EventEmitter<AtcNode | undefined>()
    root = new AtcRoot("systems", this)
    private autoRefresh = false
    activationListeners = new Map<string, Disposable>()

    get onDidChangeTreeData() {
        return this.emitter.event
    }
    getTreeItem(element: AtcNode): AtcNode {
        return element
    }
    async getChildren(element?: AtcNode): Promise<AtcNode[]> {
        return element ? element.children : this.root.children
    }

    setAutoRefresh(enabled: boolean) {
        this.autoRefresh = enabled
        commands.executeCommand("setContext", "abapfs:atc:autorefreshOn", enabled)
        if (enabled) {
            for (const s of this.root.children) {
                if (this.activationListeners.has(s.connectionId)) continue
                const listener = AdtObjectActivator.get(s.connectionId).onActivate(e => {
                    const parent = e.object instanceof AbapObjectBase ? e.object.parent : undefined
                    const h = s.children.find(o => (o.object.name === e.object.name && o.object.objectTypeId === e.object.type)
                        || (o.object.name === parent?.name && o.object.objectTypeId === parent?.type))
                    if (h) atcRefresh()
                })
                this.activationListeners.set(s.connectionId, listener)
            }
        }
        else {
            for (const [connectionId, listener] of this.activationListeners) listener.dispose()
            this.activationListeners.clear()
        }
    }

    public findings() {
        return [...this.root.systems.values()].flatMap(s => s.children.flatMap(o => o.children))
    }

    async runInspectorByAdtUrl(uri: string, connectionId: string) {
        const client = getClient(connectionId)
        const system = await this.root.child(connectionId, () => getVariant(client, connectionId))
        await system.load(() => runInspectorByAdtUrl(uri, system.variant, client))
        commands.executeCommand("abapfs.atcFinds.focus")
        this.setAutoRefresh(this.autoRefresh)
    }

    async runInspector(uri: Uri) {
        const client = getClient(uri.authority)
        const system = await this.root.child(uri.authority, () => getVariant(client, uri.authority))
        await system.load(() => runInspector(uri, system.variant, client))
        commands.executeCommand("abapfs.atcFinds.focus")
        this.setAutoRefresh(this.autoRefresh)
    }

}

export const atcProvider = new AtcProvider()