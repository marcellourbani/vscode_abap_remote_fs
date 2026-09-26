import { describe, expect, test, vi } from "vitest"
import type { ADTClient } from "abap-adt-api"
import { ddicRepositoryAccessField, ddicRepositoryAccessSource } from "./cdsNavigation"

const clientWithResponse = (body: string) => {
  const request = vi.fn().mockResolvedValue({ body })
  return {
    client: { httpClient: { request } } as unknown as ADTClient,
    request
  }
}

describe("CDS navigation", () => {
  test("preserves parser-native attributes from the adtcore response", async () => {
    const { client } = clientWithResponse(`
      <adtcore:objectReferences xmlns:adtcore="urn:adtcore">
        <adtcore:objectReference
          adtcore:uri="0001"
          adtcore:type="true"
          adtcore:name="1.20"
          ddl:path="field" />
      </adtcore:objectReferences>
    `)

    await expect(ddicRepositoryAccessSource(client, "SOURCE")).resolves.toEqual({
      uri: 1,
      type: true,
      name: 1.2,
      path: "field"
    })
  })

  test("uses the first ddl reference and preserves the request contract", async () => {
    const { client, request } = clientWithResponse(`
      <ddl:ddlObjectReferences xmlns:ddl="urn:ddl" xmlns:adtcore="urn:adtcore">
        <ddl:ddlObjectReference adtcore:uri="/first" adtcore:type="DDLS" adtcore:name="FIRST" />
        <ddl:ddlObjectReference adtcore:uri="/second" adtcore:type="DDLS" adtcore:name="SECOND" />
      </ddl:ddlObjectReferences>
    `)

    await expect(ddicRepositoryAccessField(client, "SOURCE", "FIELD")).resolves.toEqual({
      uri: "/first",
      type: "DDLS",
      name: "FIRST",
      path: ""
    })
    expect(request).toHaveBeenCalledWith("/sap/bc/adt/ddic/ddl/ddicrepositoryaccess", {
      qs: {
        requestScope: "all",
        path: "SOURCE.FIELD",
        exactMatch: "X",
        uriRequired: "X"
      },
      headers: { Accept: "application/*" }
    })
  })

  test("returns undefined for an unusable first reference", async () => {
    const { client } = clientWithResponse(`
      <adtcore:objectReferences xmlns:adtcore="urn:adtcore">
        <adtcore:objectReference adtcore:uri="not_used" />
      </adtcore:objectReferences>
    `)

    await expect(ddicRepositoryAccessSource(client, "SOURCE")).resolves.toBeUndefined()
  })
})
