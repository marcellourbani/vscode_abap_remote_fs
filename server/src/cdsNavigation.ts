import { ADTClient, type DdicObjectReference } from "abap-adt-api"
import { XMLParser } from "fast-xml-parser"

const _parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: false,
  parseAttributeValue: true
})

const fullParse = (xml: string) => _parser.parse(xml)

const xmlArray = (node: any, ...keys: string[]): any[] => {
  let cur = node
  for (const k of keys) cur = cur?.[k]
  if (!cur) return []
  return Array.isArray(cur) ? cur : [cur]
}
const xmlNodeAttr = (node: unknown): Record<string, any> => {
  if (typeof node !== "object" || node === null) return {}
  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>)
      .filter(([k]) => k.startsWith("@_") && !k.startsWith("@_xmlns"))
      .map(([k, v]) => [k.slice(2), v])
  )
}

async function ddicRepositoryAccessRaw(
  client: ADTClient,
  qs: Record<string, string>
): Promise<DdicObjectReference | undefined> {
  const response = await client.httpClient.request(`/sap/bc/adt/ddic/ddl/ddicrepositoryaccess`, {
    qs: { ...qs, uriRequired: "X" },
    headers: { Accept: "application/*" }
  })
  const raw = fullParse(response.body)
  const records = raw["adtcore:objectReferences"]
    ? xmlArray(raw, "adtcore:objectReferences", "adtcore:objectReference")
    : xmlArray(raw, "ddl:ddlObjectReferences", "ddl:ddlObjectReference")
  const refs: DdicObjectReference[] = records.map((r: any) => {
    const attr = xmlNodeAttr(r)
    return {
      uri: attr["adtcore:uri"] || "",
      type: attr["adtcore:type"] || "",
      name: attr["adtcore:name"] || "",
      path: attr["ddl:path"] || ""
    }
  })
  return refs.length > 0 && refs[0].uri && refs[0].uri !== "not_used" ? refs[0] : undefined
}

/**
 * Resolve a CDS field reference to the corresponding DDIC object entry.
 */
export async function ddicRepositoryAccessField(
  client: ADTClient,
  source: string,
  field: string
): Promise<DdicObjectReference | undefined> {
  return ddicRepositoryAccessRaw(client, {
    requestScope: "all",
    path: `${source}.${field}`,
    exactMatch: "X"
  })
}

/**
 * Resolve a CDS data source name to the corresponding DDIC repository object.
 */
export async function ddicRepositoryAccessSource(
  client: ADTClient,
  name: string
): Promise<DdicObjectReference | undefined> {
  return ddicRepositoryAccessRaw(client, { datasource: name })
}
