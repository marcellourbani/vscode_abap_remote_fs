import { Disposable, Event, EventEmitter, FileChangeEvent, FileStat, FileSystemProvider, FileType, Uri, workspace } from "vscode"
import { TraceRunItem, findRun } from "./views"
import { convertRun, convertStatements } from "./convertProfile"
import { TraceRun } from "abap-adt-api/build/api/tracetypes"
import { getClient } from "../../adt/conections"

const adtProfileId = (uri: Uri) => uri.path.replace(/\.cpuprofile/, "")

const loadProfile = async (uri: Uri, run: TraceRunItem) => {
    const client = getClient(uri.authority)
    const id = adtProfileId(uri)
    if (run.detailed) {
        const statements = await client.tracesStatements(id, { withSystemEvents: true, withDetails: true })
        return convertStatements(run.run, statements, uri.authority)
    }

    const hitlist = await client.tracesHitList(id, true)
    return convertRun(run.run, hitlist, uri.authority)
}

class TraceFs implements FileSystemProvider {
    static readonly instance = new TraceFs()
    private emitter = new EventEmitter<FileChangeEvent[]>()
    private uriSource = new WeakMap<Uri, Uint8Array>()
    onDidChangeFile = this.emitter.event
    // public addUri(uri: Uri, run: TraceRun) {
    //     this.uriruns.set(uri, run)
    // }
    private async read(uri: Uri) {
        const cached = this.uriSource.get(uri)
        if (cached) return cached
        const id = adtProfileId(uri)
        const run = await findRun(uri.authority, id)
        if (!run) throw new Error("No trace run for " + uri)
        const profile = await loadProfile(uri, run)
        const contents = new TextEncoder().encode(JSON.stringify(profile))
        this.uriSource.set(uri, contents)
        return contents
    }
    watch(uri: Uri, options: { readonly recursive: boolean; readonly excludes: readonly string[] }): Disposable {
        return new Disposable(() => { })// do nothing
    }
    async stat(uri: Uri): Promise<FileStat> {
        const contents = await this.read(uri)
        return { type: FileType.File, ctime: 0, mtime: 0, size: contents.byteLength }
    }
    readDirectory(uri: Uri) {
        return []
    }
    createDirectory(uri: Uri): void | Thenable<void> {
        throw new Error("Method not implemented.")
    }
    async readFile(uri: Uri): Promise<Uint8Array> {
        return this.read(uri)
    }
    writeFile(uri: Uri, content: Uint8Array) {
        throw new Error("Method not implemented.")
    }
    delete(uri: Uri) {
        throw new Error("Method not implemented.")
    }
    rename(oldUri: Uri, newUri: Uri) {
        throw new Error("Method not implemented.")
    }
    copy?(source: Uri, destination: Uri) {
        throw new Error("Method not implemented.")
    }
}

export const ADTPROFILE = "adt_profile"

export const adtProfileUri = (run: TraceRunItem) => {
    const uri = Uri.parse(`${ADTPROFILE}://${run.connId}${run.run.id}.cpuprofile`)
    // TraceFs.instance.addUri(uri, run.run)
    return uri
}


workspace.registerFileSystemProvider(ADTPROFILE, TraceFs.instance)
