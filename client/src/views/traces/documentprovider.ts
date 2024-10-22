import { CancellationToken, ProviderResult, TextDocumentContentProvider, Uri, workspace } from "vscode"
import { getClient } from "../../adt/conections"
import { convertRun } from "./convertProfile"
import { TraceRunItem, findRun } from "./views"
import { TraceRun } from "abap-adt-api/build/api/tracetypes"
export const ADTPROFILE = "adt_profile"
const uriNodes = new Map<string, TraceRun>()

const getRun = (uri: Uri) => {
    const run = uriNodes.get(uri.path)
    if (run) return run
    throw new Error(`No trace run for ${uri}`)
}

const adtProfileId = (uri: Uri) => uri.path.replace(/\.cpuprofile/, "")

class AbapProfile implements TextDocumentContentProvider {
    private static instance: AbapProfile
    public static get() {
        if (!this.instance) this.instance = new AbapProfile()
        return this.instance
    }
    async provideTextDocumentContent(uri: Uri, token: CancellationToken): Promise<string> {
        const id = adtProfileId(uri)
        const run = findRun(uri.authority, id)
        if (!run) throw new Error("No trace run for " + uri)
        const client = getClient(uri.authority)
        const hitlist = await client.tracesHitList(id)
        const profile = convertRun(getRun(uri), hitlist)
        return JSON.stringify(profile)
    }
}

workspace.registerTextDocumentContentProvider(ADTPROFILE, AbapProfile.get())

export const adtProfileUri = (run: TraceRunItem) => {
    const uri = Uri.parse(`${ADTPROFILE}://${run.connId}${run.run.id}.cpuprofile`)
    uriNodes.set(uri.path, run.run)
    return uri
}

