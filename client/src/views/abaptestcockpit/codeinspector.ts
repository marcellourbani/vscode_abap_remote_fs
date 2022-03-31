import { ADTClient } from "abap-adt-api"
import { Uri } from "vscode"
import { findAbapObject } from "../../adt/operations/AdtObjectFinder"

export const getVariant = async (client: ADTClient, connectionId: string) => {
    const customizing = await client.atcCustomizing()
    const variant = customizing.properties.find(x => x.name === "systemCheckVariant")
    const checkVariant = variant && await client.atcCheckVariant(`${variant.value}`)
    if (!checkVariant) throw new Error(`No ATC variant found for system ${connectionId}`)
    return checkVariant
}

export const runInspector = async (uri: Uri, variant: string, client: ADTClient) => {
    const object = await findAbapObject(uri)
    const run = await client.createAtcRun(variant, object.contentsPath())
    return client.atcWorklists(run.id, run.timestamp, run.id)
}


