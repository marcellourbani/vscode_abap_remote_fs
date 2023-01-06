import { ADTClient, AtcWorkList } from "abap-adt-api"
import { Task } from "fp-ts/lib/Task"
import { commands, Disposable, EventEmitter, Position, TextDocumentContentChangeEvent, ThemeColor, ThemeIcon, TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri, window } from "vscode"
import { getClient } from "../../adt/conections"
import { AdtObjectFinder } from "../../adt/operations/AdtObjectFinder"
import { AbapFsCommands } from "../../commands"
import { AtcWLFinding, AtcWLobject, getVariant, runInspector, runInspectorByAdtUrl } from "./codeinspector"
import * as R from "ramda"
import { AbapFile } from "abapfs"
import { AdtObjectActivator } from "../../adt/operations/AdtObjectActivator"
import { atcRefresh } from "./commands"
import { AbapObjectBase } from "abapobject/out/AbapObject"
import { log } from "../../lib"

// tslint:disable:max-classes-per-file

export interface FindingMarker {
    finding: AtcWLFinding,
    uri: string,
    start: Position
}

export const hasExemption = (f: AtcWLFinding) => !!f.exemptionApproval
export const approvedExemption = (f: AtcWLFinding) => f.exemptionApproval === "-"

export class AtcRoot extends TreeItem {
    systems = new Map<string, AtcSystem>()
    get filterExempt() {
        return this.parent.exemptFilter
    }
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
interface ResFinding extends AtcWLFinding {
    fileuri?: string
    start?: Position
    file?: AbapFile
}
interface ResObject extends AtcWLobject {
    findings: ResFinding[]
}
const zeroPos = new Position(0, 0)

const resolveObjects = async (base: AtcWLobject[], finder: AdtObjectFinder): Promise<ResObject[]> => {
    const result: ResObject[] = []
    for (const o of base) {
        const findings: ResFinding[] = []
        for (const f of o.findings) {
            try {
                const { uri, start, file } = await finder.vscodeRange(f.location)
                findings.push({ ...f, start, file, fileuri: uri })
            } catch (error) {
                log(`Error resolving finding location ${f.location.uri}`)
                findings.push(f)
            }
        }
        result.push({ ...o, findings })
    }
    return result
}

export class AtcSystem extends TreeItem {
    children: AtcObject[] = []
    refresh: Task<void> = async () => { /* */ }
    objects: ResObject[] = []

    get hasErrors() {
        for (const o of this.children) if (o.hasError) return true
        return false
    }
    async load(task: Task<AtcWorkList>) {
        this.refresh = async () => {
            const wl = await task()
            const finder = new AdtObjectFinder(this.connectionId)
            this.children = []

            const objects = R.sortWith<AtcWLobject>([
                R.ascend(R.prop("type")),
                R.ascend(R.prop("name"))])
                (wl.objects.filter(o => o.findings.length > 0))
            this.objects = await resolveObjects(objects, finder)
            this.updateChildren()
        }
        return this.refresh()
    }
    updateChildren() {
        this.children = []
        for (const o of this.objects) {
            const relevant = o.findings.filter(f => !!f.fileuri && (!this.parent.filterExempt || !approvedExemption(f)))
            if (relevant.length) {
                const obj = new AtcObject(o, this)
                obj.children = relevant.map(r => new AtcFind(r, obj, r.fileuri!, r.start || zeroPos, r.file))
                this.children.push(obj)
            }
        }
        atcProvider.emitter.fire(this)
    }
    constructor(public readonly connectionId: string, public readonly variant: string, public readonly parent: AtcRoot) {
        super(connectionId, TreeItemCollapsibleState.Expanded)
    }
}

export class AtcObject extends TreeItem {
    children: AtcFind[] = []
    hasError: boolean = false
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
        if (hasExemption(finding)) {
            this.contextValue = "finding_exempted"
            this.iconPath = new ThemeIcon("check", this.iconColor())
        }
        else {
            this.iconPath = new ThemeIcon("issue-opened", this.iconColor())
            this.contextValue = "finding"
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
    exemptFilter: boolean = true
    constructor() {
        this.setExemptFilter(true)
    }

    get onDidChangeTreeData() {
        return this.emitter.event
    }
    getTreeItem(element: AtcNode): AtcNode {
        return element
    }
    async getChildren(element?: AtcNode): Promise<AtcNode[]> {
        return element ? element.children : this.root.children
    }

    setExemptFilter(enabled: boolean) {
        this.exemptFilter = enabled
        commands.executeCommand("setContext", "abapfs:atc:exemptFilterOn", enabled)
        for (const s of this.root.children) s.updateChildren()
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

    reportError(system: AtcSystem) {
        if (system.hasErrors) window.showErrorMessage("Errors during ATC analysis, some issues won't be reported see ABAPFS logs for details.")
    }

    async runInspectorByAdtUrl(uri: string, connectionId: string) {
        const client = getClient(connectionId)
        const system = await this.root.child(connectionId, () => getVariant(client, connectionId))
        await system.load(() => runInspectorByAdtUrl(uri, system.variant, client))
        commands.executeCommand("abapfs.atcFinds.focus")
        this.setAutoRefresh(this.autoRefresh)
        this.reportError(system)
    }

    async runInspector(uri: Uri) {
        const client = getClient(uri.authority)
        const system = await this.root.child(uri.authority, () => getVariant(client, uri.authority))
        await system.load(() => runInspector(uri, system.variant, client))
        commands.executeCommand("abapfs.atcFinds.focus")
        this.setAutoRefresh(this.autoRefresh)
        this.reportError(system)
    }

}

export const atcProvider = new AtcProvider()