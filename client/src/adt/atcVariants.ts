import { ADTClient } from "abap-adt-api"
import { XMLParser } from "fast-xml-parser"

export interface AtcVariant {
  name: string
  description: string
}

const asArray = <T>(x: T | T[] | undefined | null): T[] => (x ? (Array.isArray(x) ? x : [x]) : [])

export const listAtcVariants = async (
  client: ADTClient,
  query = "*",
  maxItems = 100
): Promise<AtcVariant[]> => {
  const headers = { Accept: "application/vnd.sap.adt.nameditems.v1+xml" }
  const qs = { maxItemCount: maxItems, name: query }
  const response = await client.httpClient.request("/sap/bc/adt/atc/variants", { qs, headers })
  const parsed = new XMLParser({ ignoreAttributes: false, trimValues: false }).parse(response.body)
  const items = asArray(parsed?.["nameditem:namedItemList"]?.["nameditem:namedItem"])
  return items.map(item => ({
    name: `${item["nameditem:name"] ?? ""}`,
    description: `${item["nameditem:description"] ?? ""}`
  }))
}
