jest.mock("./conections", () => ({ getClient: jest.fn() }))

import { getClient } from "./conections"
import { AdtRelationApi, RelationObject } from "./relationApi"

const object = (name: string, type: string, uri: string): RelationObject => ({
  id: uri,
  name,
  type,
  uri,
  displayName: name,
  properties: [],
  links: []
})

const response = (body: string) => ({ body })

const networkXml = `<?xml version="1.0"?>
<oro:networkResponse xmlns:oro="http://www.sap.com/adt/objectrelations">
  <oro:activeContext><oro:value>ENV</oro:value></oro:activeContext>
  <oro:context oro:id="ENV" oro:displayName="Used Objects" oro:supportsComponents="true" oro:supportsGrouping="1" oro:supportsReferences="X" oro:isDefault="true" oro:relevance="7" />
  <oro:objectReference adtcore:uri="/root" adtcore:type="PROG/P" adtcore:name="ZROOT" oro:displayName="Root" adtcore:description="Root description" oro:exists="true" oro:canHaveComponents="1" />
  <oro:objectReference adtcore:uri="/child" adtcore:type="CLAS/OC" adtcore:name="ZCHILD" />
  <oro:relation oro:relationType="parentChild" oro:state="A"><oro:object1>ZROOT</oro:object1><oro:object2>/child</oro:object2><oro:role1 oro:singular="parent" /><oro:role2 oro:singular="child" /><oro:property><oro:name>kind</oro:name><oro:value>uses</oro:value></oro:property></oro:relation>
</oro:networkResponse>`

const componentsXml = `<oro:componentsResponse xmlns:oro="http://www.sap.com/adt/objectrelations"><oro:component oro:id="c1" adtcore:uri="/component" adtcore:type="DDLS/K" adtcore:name="Field" oro:parent="p1" oro:displayName="Field label"><oro:property><oro:name>key</oro:name><oro:value>true</oro:value></oro:property><oro:link href="/component" rel="toDefinition" type="text" title="Open" /></oro:component></oro:componentsResponse>`

const referencesXml = `<oroRef:result xmlns:oroRef="http://www.sap.com/adt/objectrelations/references" numberOfResults="1"><oroRef:reference><oroRef:from adtcore:name="ZROOT" adtcore:type="PROG/P" /><oroRef:to adtcore:name="ZCHILD" adtcore:type="CLAS/OC" /><oroRef:anchor uri="/source#start=1" program="ZROOT" include="I01" matches="1-4" snippet="CALL" /></oroRef:reference></oroRef:result>`

const relationSetXml = `<rel:RelationSetResult xmlns:rel="http://www.sap.com/adt/objectrelations/relations" leftTitle="Left" rightTitle="Right" header="Header"><rel:relation><rel:left adtcore:uri="/left" adtcore:type="PROG/P" adtcore:name="ZLEFT" /><rel:right adtcore:uri="/right" adtcore:type="TABL/DT" adtcore:name="ZRIGHT" /><rel:direction direction="left-to-right" /></rel:relation></rel:RelationSetResult>`

describe("AdtRelationApi", () => {
  let request: jest.Mock

  beforeEach(() => {
    request = jest.fn()
    ;(getClient as jest.Mock).mockReturnValue({ httpClient: { request } })
  })

  it("normalizes connectionId and posts network requests", async () => {
    request.mockResolvedValue(response(networkXml))
    const result = await new AdtRelationApi("DEV100").network(object("ZROOT", "PROG/P", "/root"))
    expect(getClient).toHaveBeenCalledWith("dev100")
    expect(request).toHaveBeenCalledWith(
      "/sap/bc/adt/objectrelations/network",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/vnd.sap.adt.objectrelations.request.v1+xml",
          Accept: "application/vnd.sap.adt.objectrelations.response.network.v1+xml"
        })
      })
    )
    expect(result.activeContext).toBe("ENV")
    expect(result.contexts[0]).toMatchObject({
      id: "ENV",
      supportsComponents: true,
      supportsGrouping: true,
      supportsReferences: true,
      isDefault: true,
      relevance: 7
    })
    expect(result.objects[0]).toMatchObject({
      name: "ZROOT",
      displayName: "Root",
      description: "Root description",
      exists: true,
      canHaveComponents: true
    })
    expect(result.relations[0]).toMatchObject({
      from: "/root",
      to: "/child",
      type: "parentChild",
      state: "A",
      roleFrom: "parent",
      roleTo: "child",
      properties: [{ name: "kind", value: "uses" }]
    })
  })

  it("uses desired contexts and parses components", async () => {
    request.mockResolvedValue(response(componentsXml))
    const result = await new AdtRelationApi("DEV100").components(
      object("ZROOT", "PROG/P", "/root"),
      "BO"
    )
    const body = request.mock.calls[0][1].body as string
    expect(body).toContain("<oro:preferredContext>BO</oro:preferredContext>")
    expect(result[0]).toMatchObject({
      id: "c1",
      name: "Field",
      type: "DDLS/K",
      parentId: "p1",
      properties: [{ name: "key", value: "true" }],
      links: [{ href: "/component", rel: "toDefinition", type: "text", title: "Open" }]
    })
  })

  it("parses references and anchors", async () => {
    request.mockResolvedValue(response(referencesXml))
    const result = await new AdtRelationApi("DEV100").references(
      object("ZROOT", "PROG/P", "/root"),
      object("ZCHILD", "CLAS/OC", "/child"),
      "ENV"
    )
    expect(result).toEqual({
      numberOfResults: 1,
      from: expect.objectContaining({ name: "ZROOT", type: "PROG/P" }),
      to: expect.objectContaining({ name: "ZCHILD", type: "CLAS/OC" }),
      anchors: [
        {
          uri: "/source#start=1",
          program: "ZROOT",
          include: "I01",
          matches: "1-4",
          snippet: "CALL"
        }
      ]
    })
  })

  it("returns an empty reference result when SAP has no relation", async () => {
    request.mockResolvedValue(
      response(
        '<oroRef:result xmlns:oroRef="http://www.sap.com/adt/objectrelations/references" numberOfResults="0" />'
      )
    )
    await expect(
      new AdtRelationApi("DEV100").references(
        object("ZROOT", "PROG/P", "/root"),
        object("ZCHILD", "CLAS/OC", "/child")
      )
    ).resolves.toEqual({ numberOfResults: 0, anchors: [] })
  })

  it("parses compare relations and sends canonical OSL XML", async () => {
    request.mockResolvedValue(response(relationSetXml))
    const result = await new AdtRelationApi("DEV100").compare(
      object("ZLEFT", "PROG/P", "/left"),
      object("ZRIGHT", "TABL/DT", "/right")
    )
    const body = request.mock.calls[0][1].body as string
    expect(body).toContain('<osl:objectSet xmlns:osl="http://www.sap.com/api/osl"')
    expect(body).toContain('xsi:type="flatObjectSet"')
    expect(body).toContain('name="ZLEFT" type="PROG"')
    expect(body).toContain('name="ZRIGHT" type="TABL"')
    expect(result).toMatchObject({
      leftTitle: "Left",
      rightTitle: "Right",
      header: "Header",
      relations: [expect.objectContaining({ direction: "left-to-right", type: "set relation" })]
    })
  })

  it("preserves HTTP failures", async () => {
    request.mockRejectedValue(new Error("HTTP 500"))
    await expect(
      new AdtRelationApi("DEV100").network(object("ZROOT", "PROG/P", "/root"))
    ).rejects.toThrow("HTTP 500")
  })

  it("handles missing optional XML values and nested text values", async () => {
    request.mockResolvedValue(
      response(
        `<oro:networkResponse xmlns:oro="http://www.sap.com/adt/objectrelations"><oro:objectReference adtcore:name="ZEMPTY" adtcore:type="PROG/P" /></oro:networkResponse>`
      )
    )
    const result = await new AdtRelationApi("DEV100").network(
      object("ZEMPTY", "PROG/P", "/empty"),
      "ENV",
      []
    )
    expect(result.activeContext).toBe("")
    expect(result.objects[0]).toMatchObject({ name: "ZEMPTY", type: "PROG/P", uri: "" })
    expect(result.objects[0].exists).toBeUndefined()
  })

  it("serializes compare sets using SAP's polymorphic OSL objectSet contract", async () => {
    request.mockResolvedValue({
      body: '<?xml version="1.0"?><rel:RelationSetResult xmlns:rel="http://www.sap.com/adt/objectrelations/relations" />'
    })

    await new AdtRelationApi("DEV100").compare(
      object("ZREPORT", "PROG/P", "/report"),
      object("ZTABLE", "TABL/DT", "/table")
    )

    const body = request.mock.calls[0][1].body as string
    expect(body).toContain('<osl:objectSet xmlns:osl="http://www.sap.com/api/osl"')
    expect(body).toContain('xsi:type="flatObjectSet"')
    expect(body).not.toContain("<osl:flatObjectSet")
  })
})
