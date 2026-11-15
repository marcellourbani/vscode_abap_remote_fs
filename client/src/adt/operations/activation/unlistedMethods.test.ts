import {
  RELIST_MARKER,
  changedMethods,
  listedMethods,
  markMethods,
  methodBodies,
  unlistedMethods
} from "./unlistedMethods"

const classUri = "/sap/bc/adt/oo/classes/zcl_test"

const classSource = (m1: string, m2: string) => `CLASS zcl_test DEFINITION PUBLIC.
  PUBLIC SECTION.
    CLASS-METHODS m1 RETURNING VALUE(rv) TYPE string.
    METHODS m2.
ENDCLASS.

CLASS ZCL_TEST IMPLEMENTATION.
  METHOD m1.
    ${m1}
  ENDMETHOD.

  METHOD m2.
    ${m2}
  ENDMETHOD.
ENDCLASS.`

const listedMethod = (name: string, uri = classUri) => ({
  "adtcore:name": `ZCL_TEST                      ${name}`,
  "adtcore:type": "CLAS/OM/public",
  "adtcore:uri": `${uri}/source/main#type=CLAS%2FOM;name=${name}`,
  "adtcore:parentUri": uri,
  user: "DEVELOPER",
  deleted: false
})

describe("unlistedMethods", () => {
  it("reads method implementations by upper case name", () => {
    const bodies = methodBodies(classSource("rv = 'a'.", "RETURN."))

    expect([...bodies.keys()]).toEqual(["M1", "M2"])
    expect(bodies.get("M1")).toBe("rv = 'a'.")
  })

  it("does not take method declarations for implementations", () => {
    expect(methodBodies("CLASS-METHODS m1.\nMETHODS m2.").size).toBe(0)
  })

  it("ignores indentation and blank lines but not literals", () => {
    const active = classSource("rv = 'a'.", "RETURN.")
    const reformatted = active.replace("    rv = 'a'.", "rv   =   'a'.\n\n")

    expect(changedMethods(active, reformatted)).toEqual([])
    expect(changedMethods(active, classSource("rv = 'A'.", "RETURN."))).toEqual(["M1"])
  })

  it("reports a changed method that SAP did not list as inactive", () => {
    const active = classSource("rv = 'v3'.", "RETURN.")
    const inactive = classSource("rv = 'v4'.", "RETURN.")

    expect(unlistedMethods(active, inactive, [], classUri)).toEqual(["M1"])
  })

  it("accepts changed methods that are in the inactive list", () => {
    const active = classSource("rv = 'v3'.", "RETURN.")
    const inactive = classSource("rv = 'v4'.", "rv = 'x'.")

    expect(unlistedMethods(active, inactive, [listedMethod("M1")], classUri)).toEqual(["M2"])
  })

  it("only accepts list entries of the same class", () => {
    const active = classSource("rv = 'v3'.", "RETURN.")
    const inactive = classSource("rv = 'v4'.", "RETURN.")
    const otherClass = listedMethod("M1", "/sap/bc/adt/oo/classes/zcl_other")

    expect(unlistedMethods(active, inactive, [otherClass], classUri)).toEqual(["M1"])
  })

  it("reports new methods that are not listed", () => {
    const active = classSource("rv = 'a'.", "RETURN.").replace(
      /  METHOD m2\.[\s\S]*?ENDMETHOD\./,
      ""
    )
    const inactive = classSource("rv = 'a'.", "RETURN.")

    expect(unlistedMethods(active, inactive, [], classUri)).toEqual(["M2"])
  })

  it("lists the methods of the class from the inactive objects", () => {
    const objects = [listedMethod("M2"), listedMethod("M1", "/sap/bc/adt/oo/classes/zcl_other")]

    expect(listedMethods(objects, classUri)).toEqual(["M2"])
  })

  it("marks only the given methods, before their ENDMETHOD", () => {
    const source = classSource("rv = 'a'.", "RETURN.").replace(/\n/g, "\r\n")

    const marked = markMethods(source, ["M2"])

    expect(methodBodies(marked).get("M1")).toBe("rv = 'a'.")
    expect(methodBodies(marked).get("M2")).toBe(`RETURN.\n${RELIST_MARKER}`)
    expect(marked.replace(`${RELIST_MARKER}\n`, "")).toBe(source)
  })

  it("finds nothing when there is no inactive version", () => {
    const source = classSource("rv = 'a'.", "RETURN.")

    expect(unlistedMethods(source, source, [], classUri)).toEqual([])
  })
})
