import { ADTClient, AtcWorkList } from "abap-adt-api"
import { Uri } from "vscode"
import { getClient } from "../../adt/conections"
import { findAbapObject } from "../../adt/operations/AdtObjectFinder"
import { extractPragmas } from "./functions"

export type AtcWLobject = AtcWorkList["objects"][0]
export type AtcWLFinding = AtcWLobject["findings"][0]
export const getVariant = async (client: ADTClient, connectionId: string) => {
    const customizing = await client.atcCustomizing()
    const variant = customizing.properties.find(x => x.name === "systemCheckVariant")
    const checkVariant = variant && await client.atcCheckVariant(`${variant.value}`)
    if (!checkVariant) throw new Error(`No ATC variant found for system ${connectionId}`)
    return checkVariant
}

export const runInspectorByAdtUrl = async (uri: string, variant: string, client: ADTClient) => {
    const run = await client.createAtcRun(variant, uri)
    const LASTRUN = "99999999999999999999999999999999"
    const worklist = client.atcWorklists(run.id, run.timestamp, LASTRUN)
    return worklist
}

export const runInspector = async (uri: Uri, variant: string, client: ADTClient) => {
    const object = await findAbapObject(uri)
    if (!object.structure) await object.loadStructure()
    return runInspectorByAdtUrl(object.contentsPath(), variant, client)
}



export const findingPragmas = async (connId: string, finding: AtcWLFinding) => {
    const client = getClient(connId)
    const response = await client.httpClient.request(finding.link.href)
    return extractPragmas(response.body)
}

