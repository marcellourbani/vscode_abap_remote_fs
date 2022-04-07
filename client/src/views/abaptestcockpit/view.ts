import { ADTClient, AtcProposal, AtcWorkList } from "abap-adt-api"
import { Task } from "fp-ts/lib/Task"
import { commands, Disposable, EventEmitter, Position, ProgressLocation, QuickPickOptions, Range, Selection, TextEdit, ThemeColor, ThemeIcon, TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri, window, workspace, WorkspaceEdit } from "vscode"
import { getClient } from "../../adt/conections"
import { AdtObjectFinder } from "../../adt/operations/AdtObjectFinder"
import { AbapFsCommands, command } from "../../commands"
import { showErrorMessage, inputBox, quickPick, rfsTryCatch, fieldReplacer, chainTaskTransformers, rfsExtract, RfsTaskEither } from "../../lib"
import { AtcWLFinding, AtcWLobject, extractPragma, getVariant, runInspector, runInspectorByAdtUrl } from "./codeinspector"
import { triggerUpdateDecorations } from "./decorations"
import * as R from "ramda"
import { ATCDocumentation } from "./documentation"
import { AbapFile } from "abapfs"
import { AdtObjectActivator } from "../../adt/operations/AdtObjectActivator"



// tslint:disable:max-classes-per-file

export interface FindingMarker {
    finding: AtcWLFinding,
    uri: string,
    start: Position
}

export const hasExemption = (f: AtcWLFinding) => !!f.exemptionApproval

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

const items = [
    { id: 1, name: 'Al', country: 'AA' },
    { id: 2, name: 'Connie', country: 'BB' },
    { id: 3, name: 'Doug', country: 'CC' },
    { id: 4, name: 'Zen', country: 'BB' },
    { id: 5, name: 'DatGGboi', country: 'AA' },
    { id: 6, name: 'Connie', country: 'AA' },
]

class AtcSystem extends TreeItem {
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
            triggerUpdateDecorations()
            atcProvider.emitter.fire(this)
        }
        return this.refresh()
    }
    constructor(public readonly connectionId: string, public readonly variant: string, public readonly parent: AtcRoot) {
        super(connectionId, TreeItemCollapsibleState.Expanded)
    }
}

class AtcObject extends TreeItem {
    children: AtcFind[] = []
    static async create(object: AtcWLobject, parent: AtcSystem, finder: AdtObjectFinder) {
        const obj = new AtcObject(object, parent)
        const children: AtcFind[] = []
        for (const f of object.findings) {
            const { uri, start, file } = await finder.vscodeRange(f.location)
            const finding = new AtcFind(f, obj, uri, start, file)
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
class AtcFind extends TreeItem {
    children: AtcFind[] = []
    constructor(public readonly finding: AtcWLFinding, public readonly parent: AtcObject, public readonly uri: string, public readonly start?: Position, file?: AbapFile) {
        super(finding.messageTitle, TreeItemCollapsibleState.None)
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
            arguments: [uri, start]
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

type AtcNode = AtcRoot | AtcSystem | AtcObject | AtcFind
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
                    const h = s.children.find(o => o.object.name === e.object.name && o.object.objectTypeId === e.object.type)
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

    public markers(uri: Uri) {
        const system = this.root.systems.get(uri.authority)
        const findings: FindingMarker[] = []
        if (system) {
            const us = uri.toString()
            for (const object of system.children) {
                for (const finding of object.children) {
                    if (finding.uri === us && finding.start) findings.push({ uri: finding.uri, finding: finding.finding, start: finding.start })
                }
            }
        }
        return findings
    }

    async runInspectorByAdtUrl(uri: string, connectionId: string) {
        const client = getClient(connectionId)
        const system = await this.root.child(connectionId, () => getVariant(client, connectionId))
        await system.load(() => runInspectorByAdtUrl(uri, system.variant, client))
        commands.executeCommand("abapfs.atcFinds.focus")
        this.setAutoRefresh(this.autoRefresh)
    }

    async runInspector(uri: Uri, client: ADTClient) {
        const system = await this.root.child(uri.authority, () => getVariant(client, uri.authority))
        await system.load(() => runInspector(uri, system.variant, client))
        commands.executeCommand("abapfs.atcFinds.focus")
        this.setAutoRefresh(this.autoRefresh)
    }

}

const selectors = (connId: string) => ({
    inputJustification: fieldReplacer("justification", inputBox({ prompt: "Justification" })),
    inputReason: fieldReplacer("reason", quickPick(
        [{ label: "False Positive", value: "FPOS" }, { label: "Other", value: "OTHR" }],
        { placeHolder: "Select Reason" }, x => x.value)),
    notifyOn: fieldReplacer("notify", quickPick(
        [{ label: "On rejection", value: "on_rejection" }, { label: "Always", value: "always" }, { label: "Never", value: "never" }],
        { placeHolder: "Select Reason" }, x => x.value)),
    approver: fieldReplacer("approver", inputBox({ prompt: "Enter approver user ID" })),
})

const selectKey = <K extends string, T extends Record<K, boolean>>(keys: K[], r: T, options: QuickPickOptions): RfsTaskEither<K> => {
    keys.filter(k => r[k])
    if (keys.length <= 1) return rfsTryCatch(async () => keys[0])
    return quickPick(keys, options)
}

const atcRefresh = async (item?: AtcNode) => {
    try {
        await window.withProgress(
            { location: ProgressLocation.Window, title: `Refreshing ABAP Test cockpit` },
            async () => {
                if (item instanceof AtcSystem) {
                    return item.refresh()
                }
                if (item instanceof AtcObject) {
                    return item.parent.refresh()
                }
                if (item instanceof AtcFind) {
                    return item.parent.parent.refresh()
                }
                if (item instanceof AtcRoot) {
                    return Promise.all(item.children.map(i => i.refresh()))
                }
                if (!item) {
                    return Promise.all(atcProvider.root.children.map(i => i.refresh()))
                }
            }
        )
    } catch (e) {
        showErrorMessage(e)
    }
}
class Commands {

    @command(AbapFsCommands.openLocation)
    private async OpenLocation(uri: string, pos?: Position) {
        try {
            const uriP = Uri.parse(uri)
            const document = await workspace.openTextDocument(uriP)
            const selection = pos && new Selection(pos, pos)
            await window.showTextDocument(document, { preserveFocus: false, selection })
        } catch (error) {
            showErrorMessage(error)
        }
    }

    @command(AbapFsCommands.atcIgnore)
    private async tryIgnoreFinfing(finding?: AtcFind) {
        const pos = finding?.start
        if (!pos) {
            window.showInformationMessage(`Position information is missing.`)
            return
        }
        const pragmas = await extractPragma(finding.parent.parent.connectionId, finding.finding)
        if (!pragmas.length) {
            window.showInformationMessage(`Can't find a pragma or pseudocomment`)
            return
        }
        const pragma = pragmas.length === 1 ? pragmas[0] : rfsExtract(await quickPick(pragmas, { placeHolder: "Select pragma" })())
        if (!pragma) return
        const uriP = Uri.parse(finding.uri)
        const document = await workspace.openTextDocument(uriP)
        const lines = document.getText().split("\n")
        const line = lines[pos.line]
        if (line.includes(pragma)) {
            window.showInformationMessage(`Pragma or pseudocomment ${pragma} already included`)
            return
        }
        const selection = pos && new Selection(pos, pos)
        const edit = new WorkspaceEdit()
        edit.insert(uriP, new Position(pos.line, line.length), ` ${pragma}`)
        workspace.applyEdit(edit)
        await window.showTextDocument(document, { preserveFocus: false, selection })
    }
    @command(AbapFsCommands.atcAutoRefreshOn)
    private async auroRefreshOn() {
        atcProvider.setAutoRefresh(true)
    }
    @command(AbapFsCommands.atcAutoRefreshOff)
    private async auroRefreshOff() {
        atcProvider.setAutoRefresh(false)
    }
    @command(AbapFsCommands.atcRequestExemption)
    private async RequestExemption(item: AtcFind) {
        try {
            const client = getClient(item.parent.parent.connectionId)
            if (!item.finding.quickfixInfo) throw new Error("No info available - exemption requested?")
            const proposal = await client.atcExemptProposal(item.finding.quickfixInfo)
            if (client.isProposalMessage(proposal)) throw new Error("Exemption proposal expected")
            proposal.restriction.enabled = true
            proposal.restriction.singlefinding = true
            const { inputReason, approver, notifyOn, inputJustification } = selectors(item.parent.parent.connectionId)
            const actualResult = await chainTaskTransformers<AtcProposal>(inputReason, approver, notifyOn, inputJustification)(proposal)()
            const actual = rfsExtract(actualResult)
            if (!actual) return
            await client.atcRequestExemption(actual)
            await item.parent.parent.refresh()
        } catch (error) {
            showErrorMessage(error)
        }
    }
    @command(AbapFsCommands.atcRefresh)
    private async atcRefresh(item?: AtcNode) {
        atcRefresh(item)
    }

    @command(AbapFsCommands.atcRequestExemptionAll)
    private async RequestExemptionAll(item: AtcFind) {
        try {
            const client = getClient(item.parent.parent.connectionId)
            if (!item.finding.quickfixInfo) throw new Error("No info available - exemption requested?")
            const proposal = await client.atcExemptProposal(item.finding.quickfixInfo)
            if (client.isProposalMessage(proposal)) throw new Error("Exemption proposal expected")
            proposal.restriction.enabled = true
            proposal.restriction.singlefinding = false
            const { inputReason, approver, notifyOn, inputJustification } = selectors(item.parent.parent.connectionId)
            const target = rfsExtract(await selectKey(["object", "package", "subobject"],
                proposal.restriction.rangeOfFindings.restrictByObject,
                { placeHolder: "Select target object" })())
            if (!target) return
            proposal.restriction.rangeOfFindings.restrictByObject.target = target
            const targetmsg = rfsExtract(await selectKey(["check", "message"],
                proposal.restriction.rangeOfFindings.restrictByCheck,
                { placeHolder: "Select target object" })())
            if (!targetmsg) return
            proposal.restriction.rangeOfFindings.restrictByCheck.target = targetmsg

            const actualResult = await chainTaskTransformers<AtcProposal>(inputReason, approver, notifyOn, inputJustification)(proposal)()
            const actual = rfsExtract(actualResult)
            if (!actual) return
            await client.atcRequestExemption(actual)
            await item.parent.parent.refresh()
        } catch (error) {
            showErrorMessage(error)
        }
    }
    @command(AbapFsCommands.atcShowDocumentation)
    private async ShowDocumentation(item: AtcFind) {
        try {
            const connId = item.parent.parent.connectionId
            const url = item.finding.link.href
            await ATCDocumentation.get().showDocumentation({ connId, url })
            commands.executeCommand("abapfs.views.atcdocs.focus")
        } catch (error) {
            showErrorMessage(error)
        }
    }

}

export const atcProvider = new AtcProvider()