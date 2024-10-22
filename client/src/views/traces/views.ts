import { EventEmitter, MarkdownString, ThemeIcon, TreeDataProvider, TreeItem, TreeItemCollapsibleState } from "vscode"
import { connectedRoots } from "../../config"
import { getClient } from "../../adt/conections"
import { TraceRequest, TraceRun } from "abap-adt-api/build/api/tracetypes"
import { cache } from "../../lib"
import { adtProfileUri } from "./documentprovider"
import { AbapFsCommands } from "../../commands"
import { openCommand } from "./commands"
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
    constructor(readonly connId: string, readonly config: Readonly<TraceRequest>) {
        const label = `${config.title} ${config.extendedData.host} ${config.published.toLocaleString()}`
        super(label, TreeItemCollapsibleState.None)
        this.tooltip = configToolTip(config)
    }
    iconPath = icons.get("gear")
    children() { return [] }
}
export class TraceRunItem extends TreeItem {
    constructor(readonly connId: string, readonly run: TraceRun) {
        super(`${run.title} ${run.published.toLocaleString()} ${run.extendedData.objectName}`, TreeItemCollapsibleState.None)
        this.command = openCommand(this)
        this.tooltip = runToolTip(run)
    }
    id = this.run.id

    iconPath = icons.get(this.run.extendedData.isAggregated ? "file" : "file-binary")
    children() {
        return []
    }
}
class ConfigFolder extends TreeItem {
    readonly tag = "config"
    constructor(private connId: string) {
        super("Configurations", TreeItemCollapsibleState.Expanded)
    }
    iconPath = icons.get("gear")
    async children() {
        const client = getClient(this.connId)
        const { requests } = await client.tracesListRequests()
        return requests.map(c => new Configuration(this.connId, c))
    }
}

class RunsFolder extends TreeItem {
    readonly tag = "config"
    runs: TraceRunItem[] = []
    constructor(private connId: string) {
        super("Runs", TreeItemCollapsibleState.Expanded)
    }
    iconPath = icons.get("files")
    async children() {
        const client = getClient(this.connId)
        const { runs } = await client.tracesList()
        this.runs = runs.map(r => new TraceRunItem(this.connId, r))
        return this.runs
    }
    public getRun(id: string) {
        id = decodeURIComponent(id)
        return this.runs.find(r => decodeURIComponent(r.id) === id)
    }
}


class SystemFolder extends TreeItem {
    readonly tag = "system"
    readonly runs: RunsFolder
    private configs: ConfigFolder
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

type Item = SystemFolder | ConfigFolder | RunsFolder | Configuration | TraceRunItem

class TracesProvider implements TreeDataProvider<Item>{
    readonly emitter = new EventEmitter<Item | Item[] | undefined>()
    readonly onDidChangeTreeData = this.emitter.event
    getTreeItem(element: Item): Item {
        return element
    }
    async getChildren(element?: Item): Promise<Item[]> {
        if (element) return element.children()
        return this.roots
    }
    private roots = [...connectedRoots().keys()].map(r => new SystemFolder(r))
    public root(connId: string) {
        return this.roots.find(r => r.connId === connId)
    }
}

export const tracesProvider = new TracesProvider()

export const findRun = (connId: string, id: string) => {
    return tracesProvider.root(connId)?.runs.getRun(id)
}