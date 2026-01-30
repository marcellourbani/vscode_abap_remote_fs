import { EventEmitter, MarkdownString, ThemeIcon, TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri } from "vscode"
import { connectedRoots } from "../../config"
import { getOrCreateClient } from "../../adt/conections"
import { TraceRequest, TraceRun } from "abap-adt-api/build/api/tracetypes"
import { cache } from "../../lib"
import { openCommand } from "./commands"
import { adtProfileUri } from "./fsProvider"
const icons = cache((id: string) => new ThemeIcon(id))
const configToolTip = (config: TraceRequest) => {
    const admin = config.authors.find(a => a.role === "admin")?.name || ""
    const tracer = config.authors.find(a => a.role === "trace")?.name || ""
    const { published, extendedData: { objectType, processType, executions: { completed, maximal }, host, isAggregated } } = config
    return new MarkdownString(`|          |         |
| -------- | ------- |
| Host | ${host} |
| Admin    | ${admin} |
| Tracer   | ${tracer} |
| Process Type | ${processType} |
| Object Type | ${objectType} |
| Completed traces| ${completed} |
| Max number of traces | ${maximal} |
| Has detailed data | ${!isAggregated} |
| Published | ${published.toLocaleString()} |`)
}

const runToolTip = (run: TraceRun) => {
    const { author, type, extendedData: { runtime, host, objectName, runtimeABAP, runtimeDatabase, runtimeSystem, isAggregated, state, system } } = run
    const tot = (runtimeABAP + runtimeDatabase + runtimeSystem) || 1
    const percent = (n: number) => Math.round((n / tot) * 100)
    return new MarkdownString(
        `|          |         |
| -------- | ------- |
| Host | ${host} |
| Object name    | ${objectName} |
| Run time   | ${runtime} |
| State | ${state.text} ${state.value} |
| System | ${system} |
| Has detailed data | ${!isAggregated} |

| type     | time    | %  |
| -------- | ------- | -- |
| ABAP     | ${runtimeABAP}     | ${percent(runtimeABAP)}     |
| DB       | ${runtimeDatabase} | ${percent(runtimeDatabase)} |
| System   | ${runtimeSystem}   | ${percent(runtimeSystem)}   |`)
}

class Configuration extends TreeItem {
    readonly contextValue = "configuration"
    constructor(readonly connId: string, readonly config: Readonly<TraceRequest>) {
        const label = `${config.title} ${config.extendedData.host} ${config.published.toLocaleString()}`
        super(label, TreeItemCollapsibleState.None)
        this.tooltip = configToolTip(config)
    }
    iconPath = icons.get("gear")
    children() { return [] }
}
export class TraceRunItem extends TreeItem {
    readonly contextValue = "run"
    constructor(readonly connId: string, readonly run: TraceRun) {
        super(`${run.title} ${run.published.toLocaleString()} ${run.extendedData.objectName}`, TreeItemCollapsibleState.None)
        if (!this.error) {
            const uri = adtProfileUri(this)
            this.command = openCommand(uri)
        }
        this.tooltip = runToolTip(run)
    }
    id = this.run.id
    error = this.run.extendedData.state.value === "E"
    detailed = !this.run.extendedData.isAggregated
    iconPath = icons.get(this.error ? "error" : this.run.extendedData.isAggregated ? "file" : "file-binary")
    children() {
        return []
    }
}
class ConfigFolder extends TreeItem {
    readonly contextValue = "configfolder"
    constructor(private connId: string) {
        super("Configurations", TreeItemCollapsibleState.Expanded)
    }
    iconPath = icons.get("gear")
    async children() {
        const client = await getOrCreateClient(this.connId)
        const { requests } = await client.tracesListRequests()
        return requests.map(c => new Configuration(this.connId, c))
    }
}

class RunsFolder extends TreeItem {
    readonly contextValue = "runfolder"
    runs: TraceRunItem[] | undefined
    constructor(private connId: string) {
        super("Runs", TreeItemCollapsibleState.Expanded)
    }
    iconPath = icons.get("files")
    async children() {
        const client = await getOrCreateClient(this.connId)
        const { runs } = await client.tracesList()
        this.runs = runs.map(r => new TraceRunItem(this.connId, r)).sort((a, b) => b.run.published.getTime() - a.run.published.getTime())
        return this.runs
    }
    public async getRun(id: string) {
        const runs = this.runs || await this.children()
        id = decodeURIComponent(id)
        return runs.find(r => decodeURIComponent(r.id) === id)
    }
}


class SystemFolder extends TreeItem {
    readonly contextValue = "system"
    readonly runs: RunsFolder
    readonly configs: ConfigFolder
    constructor(readonly connId: string) {
        super(connId, TreeItemCollapsibleState.Expanded)
        this.runs = new RunsFolder(connId)
        this.configs = new ConfigFolder(connId)
    }
    async refresh(node: any) {
        tracesProvider.emitter.fire(node)
    }
    iconPath = new ThemeIcon("device-desktop")
    async children() {
        return [this.configs, this.runs]
    }
}

export type TraceView = SystemFolder | ConfigFolder | RunsFolder | Configuration | TraceRunItem

class TracesProvider implements TreeDataProvider<TraceView>{
    readonly emitter = new EventEmitter<TraceView | TraceView[] | undefined>()
    readonly onDidChangeTreeData = this.emitter.event
    getTreeItem(element: TraceView): TraceView {
        return element
    }
    async getChildren(element?: TraceView): Promise<TraceView[]> {
        if (element) return element.children()
        return this.roots
    }
    private roots = [...connectedRoots().keys()].map(r => new SystemFolder(r))
    public root(connId: string) {
        return this.roots.find(r => r.connId === connId)
    }
}

export const tracesProvider = new TracesProvider()

export const findRun = async (connId: string, id: string) => {
    await getOrCreateClient(connId)//in case the tree is not displayed yet
    return tracesProvider.root(connId)?.runs.getRun(id)
}