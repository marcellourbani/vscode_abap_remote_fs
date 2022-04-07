import { ADTClient, AtcWorkList } from "abap-adt-api"
import { Uri } from "vscode"
import { getClient } from "../../adt/conections"
import { findAbapObject } from "../../adt/operations/AdtObjectFinder"
import { decodeEntity } from "../../lib"

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


export const extractPragma = async (connId: string, finding: AtcWLFinding) => {
    const client = getClient(connId)
    const response = await client.httpClient.request(finding.link.href)
    const pcmatch = response.body.match(/([^>]+)pseudo comment\s+([^<]+)/)
    const prefix = finding.checkTitle.match(/SLIN/) ? "EC " : ""
    if (pcmatch && !pcmatch[1].match(/can(\s*)not/i)) {
        return decodeEntity(pcmatch[2]).split(" or ").map(s => {
            if (s.startsWith('"')) return s
            if (s.startsWith('#')) return `"${s}`
            return `"#${prefix}${s}`
        })
    }
    const prmatch = response.body.match(/([^>]+)pragma\s+([^<]+)/)
    if (prmatch && !prmatch[1].match(/can(\s*)not/i)) {
        return decodeEntity(prmatch[2]).split(" or ").map(s => {
            if (s.startsWith('#')) return s
            return `#${prefix}${s}`
        })
    }
    return []
}
