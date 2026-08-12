import { ADTClient, AtcWorkList, isAdtError, isHttpError } from "abap-adt-api"
import { Uri } from "vscode"
import { getClient } from "../../adt/conections"
import { findAbapObject } from "../../adt/operations/AdtObjectFinder"
import { extractPragmas } from "./functions"
import { RemoteManager } from "../../config"
import { listAtcVariants } from "../../adt/atcVariants"

export type AtcWLobject = AtcWorkList["objects"][0]
export type AtcWLFinding = AtcWLobject["findings"][0]

// The /atc/variants endpoint returns a plain HTTP/ADT 404 on systems that
// don't support it (older releases). Any other failure (auth, network, 500...)
// is NOT "unsupported", and must not be silently treated the same way -
// it should not be swallowed into the same "can't verify" fallback.
const isVariantEndpointNotFound = (error: unknown): boolean => {
  if (isHttpError(error)) return error.status === 404
  if (isAdtError(error)) return error.err === 404
  return false
}

export const getVariant = async (
  client: ADTClient,
  connectionId: string,
  overrideVariant?: string
) => {
  if (overrideVariant) {
    // atcCheckVariant silently succeeds with the system default for an unknown
    // variant name instead of erroring, so a typo would otherwise go unnoticed.
    // Confirm the name actually exists before trusting it.
    let variantExists: boolean | undefined
    try {
      const matches = await listAtcVariants(client, overrideVariant, 1)
      variantExists = matches.some(v => v.name.toUpperCase() === overrideVariant.toUpperCase())
    } catch (error) {
      // Only a confirmed 404 means the listing endpoint is unsupported on this
      // system; any other failure must not be silently treated the same way.
      if (!isVariantEndpointNotFound(error)) throw error
      variantExists = undefined
    }
    if (variantExists === false) {
      throw new Error(
        `ATC variant '${overrideVariant}' does not exist on system ${connectionId}. Use get_atc_variants to see available variants.`
      )
    }
    const checkVariant = await client.atcCheckVariant(overrideVariant)
    if (!checkVariant) throw new Error(`No matching ATC variant found for system ${connectionId}`)
    return { variant: overrideVariant, checkVariant }
  }
  const connection = RemoteManager.get().byId(connectionId)
  if (connection?.atcVariant) {
    const checkVariant =
      connection.atcVariant && (await client.atcCheckVariant(`${connection.atcVariant}`))
    if (!checkVariant) throw new Error(`No ATC variant found for system ${connectionId}`)
    return { variant: connection.atcVariant, checkVariant }
  }
  const customizing = await client.atcCustomizing()
  const variant = customizing.properties.find(x => x.name === "systemCheckVariant")
  const checkVariant = variant && (await client.atcCheckVariant(`${variant.value}`))
  if (!checkVariant) throw new Error(`No ATC variant found for system ${connectionId}`)
  return { variant: `${variant.value}`, checkVariant }
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
