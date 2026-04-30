import { ADTClient, DdicObjectReference } from "abap-adt-api"

export async function ddicRepositoryAccessField(
  client: ADTClient,
  source: string,
  field: string
): Promise<DdicObjectReference | undefined> {
  const response = await client.httpClient.request(
    `/sap/bc/adt/ddic/ddl/ddicrepositoryaccess`,
    {
      qs: {
        requestScope: "all",
        path: `${source}.${field}`,
        uriRequired: "X",
        exactMatch: "X"
      },
      headers: { Accept: "application/*" }
    }
  )
  const { fullParse, xmlArray, xmlNodeAttr } = require("abap-adt-api/build/utilities")
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
