import { listAtcVariants } from "./atcVariants"

describe("listAtcVariants", () => {
  const makeClient = (body: string) => ({
    httpClient: { request: jest.fn().mockResolvedValue({ body }) }
  })

  it("requests the named-items endpoint with query and maxItems", async () => {
    const client = makeClient(
      `<nameditem:namedItemList xmlns:nameditem="http://www.sap.com/adt/nameditem"></nameditem:namedItemList>`
    )

    await listAtcVariants(client as any, "Z*", 50)

    expect(client.httpClient.request).toHaveBeenCalledWith("/sap/bc/adt/atc/variants", {
      qs: { maxItemCount: 50, name: "Z*" },
      headers: { Accept: "application/vnd.sap.adt.nameditems.v1+xml" }
    })
  })

  it("defaults to query '*' and maxItems 100", async () => {
    const client = makeClient(
      `<nameditem:namedItemList xmlns:nameditem="http://www.sap.com/adt/nameditem"></nameditem:namedItemList>`
    )

    await listAtcVariants(client as any)

    expect(client.httpClient.request).toHaveBeenCalledWith(
      "/sap/bc/adt/atc/variants",
      expect.objectContaining({ qs: { maxItemCount: 100, name: "*" } })
    )
  })

  it("parses multiple named items", async () => {
    const client =
      makeClient(`<nameditem:namedItemList xmlns:nameditem="http://www.sap.com/adt/nameditem">
      <nameditem:namedItem>
        <nameditem:name>DEFAULT</nameditem:name>
        <nameditem:description>Default variant</nameditem:description>
        <nameditem:data></nameditem:data>
      </nameditem:namedItem>
      <nameditem:namedItem>
        <nameditem:name>ZCUSTOM</nameditem:name>
        <nameditem:description>Custom variant</nameditem:description>
        <nameditem:data></nameditem:data>
      </nameditem:namedItem>
    </nameditem:namedItemList>`)

    const result = await listAtcVariants(client as any)

    expect(result).toEqual([
      { name: "DEFAULT", description: "Default variant" },
      { name: "ZCUSTOM", description: "Custom variant" }
    ])
  })

  it("parses a single named item (not wrapped in an array by the XML parser)", async () => {
    const client =
      makeClient(`<nameditem:namedItemList xmlns:nameditem="http://www.sap.com/adt/nameditem">
      <nameditem:namedItem>
        <nameditem:name>DEFAULT</nameditem:name>
        <nameditem:description>Default variant</nameditem:description>
      </nameditem:namedItem>
    </nameditem:namedItemList>`)

    const result = await listAtcVariants(client as any)

    expect(result).toEqual([{ name: "DEFAULT", description: "Default variant" }])
  })

  it("returns an empty array when no items are found", async () => {
    const client = makeClient(
      `<nameditem:namedItemList xmlns:nameditem="http://www.sap.com/adt/nameditem"></nameditem:namedItemList>`
    )

    const result = await listAtcVariants(client as any)

    expect(result).toEqual([])
  })
})
