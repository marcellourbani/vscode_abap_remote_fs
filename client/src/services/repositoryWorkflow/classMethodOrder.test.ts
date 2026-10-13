import { alphabetizeClassMethods, type ClassMethodElement } from "./classMethodOrder"

const url = "/sap/bc/adt/oo/classes/zcl_test/source/main"
const header =
  "CLASS zcl_test DEFINITION. PUBLIC SECTION. METHODS: zebra, alpha. ENDCLASS.\nCLASS zcl_test IMPLEMENTATION.\n"
const zebra = "METHOD zebra.\n WRITE 'Z'.\nENDMETHOD."
const alpha = "METHOD alpha.\n WRITE 'A'.\nENDMETHOD."
const footer = "\nENDCLASS.\n"

function element(
  source: string,
  name: string,
  body: string,
  inclusiveEnd = false
): ClassMethodElement {
  const start = source.indexOf(body)
  const point = (offset: number) => {
    const prefix = source.slice(0, offset).split("\n")
    return `${prefix.length},${prefix[prefix.length - 1].length}`
  }
  return {
    name,
    type: "CLAS/OM",
    children: [],
    constructor: false,
    links: [
      {
        rel: "http://www.sap.com/adt/relations/implementationBlock",
        href: `${url}#start=${point(start)};end=${point(start + body.length - (inclusiveEnd ? 1 : 0))}`
      }
    ]
  }
}

function reorder(
  source: string,
  methods = [
    ["zebra", zebra],
    ["alpha", alpha]
  ]
) {
  return alphabetizeClassMethods(
    source,
    "ZCL_TEST",
    url,
    methods.map(([name, body]) => element(source, name, body))
  )
}

describe("alphabetizeClassMethods", () => {
  it("sorts only implementations and preserves the definition", () => {
    const source = header + zebra + "\n\n" + alpha + footer
    expect(reorder(source)).toBe(header + alpha + "\n\n" + zebra + footer)
  })
  it("is idempotent", () => {
    const source = header + alpha + "\n\n" + zebra + footer
    expect(reorder(source)).toBe(source)
  })
  it("supports no methods", () => {
    const source = "CLASS zcl_test DEFINITION. ENDCLASS. CLASS zcl_test IMPLEMENTATION. ENDCLASS."
    expect(reorder(source, [])).toBe(source)
  })
  it("supports one method", () => {
    const source = header + zebra + footer
    expect(reorder(source, [["zebra", zebra]])).toBe(source)
  })
  it("retains standalone comments in their original slots", () => {
    const gap = '\n* standalone comment\n" another comment\n'
    const source = header + zebra + gap + alpha + footer
    expect(reorder(source)).toBe(header + alpha + gap + zebra + footer)
  })
  it("moves inline ENDMETHOD comments with their method", () => {
    const source = header + zebra + ' " zebra comment\n' + alpha + footer
    expect(reorder(source)).toBe(header + alpha + "\n" + zebra + ' " zebra comment' + footer)
  })
  it("does not confuse keywords in comments and strings with methods", () => {
    const body = "METHOD zebra.\n* METHOD fake.\n WRITE 'ENDMETHOD.'. \" METHOD fake.\nENDMETHOD."
    const source = header + body + "\n" + alpha + footer
    expect(
      reorder(source, [
        ["zebra", body],
        ["alpha", alpha]
      ])
    ).toBe(header + alpha + "\n" + body + footer)
  })
  it("supports interface-qualified names", () => {
    const body = "METHOD if_test~run.\nENDMETHOD."
    const source = header + body + "\n" + alpha + footer
    expect(
      reorder(source, [
        ["if_test~run", body],
        ["alpha", alpha]
      ])
    ).toBe(header + alpha + "\n" + body + footer)
  })
  it("rejects missing metadata", () => {
    expect(() => reorder(header + zebra + "\n" + alpha + footer, [["zebra", zebra]])).toThrow(
      "inventory"
    )
  })
  it("rejects stale positions", () => {
    const source = header + zebra + "\n" + alpha + footer
    const metadata = [element(source, "zebra", zebra), element(source, "alpha", alpha)]
    expect(() => alphabetizeClassMethods("\n" + source, "ZCL_TEST", url, metadata)).toThrow(
      "does not match"
    )
  })
  it("rejects duplicate metadata", () => {
    const source = header + zebra + footer
    const method = element(source, "zebra", zebra)
    expect(() => alphabetizeClassMethods(source, "ZCL_TEST", url, [method, method])).toThrow(
      "Duplicate"
    )
  })
  it("ignores components in other includes", () => {
    const source = header + zebra + footer
    const other = element(source, "other", zebra)
    other.links[0].href = other.links[0].href.replace("source/main", "includes/testclasses")
    expect(
      alphabetizeClassMethods(source, "ZCL_TEST", url, [other, element(source, "zebra", zebra)])
    ).toBe(source)
  })
  it.each(["CLAS/OR", "CLAS/OC", "CLAS/OA"])("ignores non-method %s block links", type => {
    const source = header + zebra + footer
    const other = { ...element(source, "owner", zebra), type }
    expect(
      alphabetizeClassMethods(source, "ZCL_TEST", url, [other, element(source, "zebra", zebra)])
    ).toBe(source)
  })
  it("visits nested metadata", () => {
    const source = header + zebra + "\n" + alpha + footer
    const parent = {
      ...element(source, "owner", zebra),
      type: "CLAS/OR",
      links: [],
      children: [element(source, "alpha", alpha), element(source, "zebra", zebra)]
    }
    expect(alphabetizeClassMethods(source, "ZCL_TEST", url, [parent])).toBe(
      header + alpha + "\n" + zebra + footer
    )
  })
  it.each(["\r\n", "\n"])("supports %j line endings", newline => {
    const source = (header + zebra + "\n" + alpha + footer).replace(/\n/g, newline)
    const result = reorder(source, [
      ["zebra", zebra.replace(/\n/g, newline)],
      ["alpha", alpha.replace(/\n/g, newline)]
    ])
    expect(result).toBe((header + alpha + "\n" + zebra + footer).replace(/\n/g, newline))
  })
  it("supports methods sharing a physical line", () => {
    const first = "METHOD zebra. ENDMETHOD."
    const second = "METHOD alpha. ENDMETHOD."
    const source = header + first + " " + second + footer
    expect(
      reorder(source, [
        ["zebra", first],
        ["alpha", second]
      ])
    ).toBe(header + second + " " + first + footer)
  })
  it("preserves local class implementations unchanged", () => {
    const local = "\nCLASS lcl_local IMPLEMENTATION.\nMETHOD zebra. ENDMETHOD.\nENDCLASS."
    const source = header + zebra + "\n" + alpha + footer + local
    expect(reorder(source)).toBe(header + alpha + "\n" + zebra + footer + local)
  })
  it("preserves Unicode strings and comments", () => {
    const body = "METHOD zebra.\n WRITE 'caf\u00e9'.\nENDMETHOD."
    const source = header + body + "\n" + alpha + footer
    expect(
      reorder(source, [
        ["zebra", body],
        ["alpha", alpha]
      ])
    ).toBe(header + alpha + "\n" + body + footer)
  })
  it("rejects unknown methods in the main source inventory", () => {
    const source = header + zebra + footer
    expect(() =>
      alphabetizeClassMethods(source, "ZCL_TEST", url, [element(source, "other", zebra)])
    ).toThrow("does not match")
  })
  it.each([
    "#start=999,0;end=999,1",
    "#start=0,0;end=1,0",
    "#start=1,99999;end=2,0",
    "#start=1,0",
    "#start=2,-1;end=3,0"
  ])("rejects malformed or out-of-bounds ranges %s", fragment => {
    const source = header + zebra + footer
    const method = element(source, "zebra", zebra)
    method.links[0].href = url + fragment
    expect(() => alphabetizeClassMethods(source, "ZCL_TEST", url, [method])).toThrow()
  })
  it("rejects overlapping ranges", () => {
    const source = header + zebra + "\n" + alpha + footer
    const methods = [element(source, "zebra", zebra), element(source, "alpha", alpha)]
    methods[1].links[0].href = methods[0].links[0].href
    expect(() => alphabetizeClassMethods(source, "ZCL_TEST", url, methods)).toThrow(
      "does not match"
    )
  })
  it("matches names case-insensitively and sorts deterministically", () => {
    const source = header + zebra + "\n" + alpha + footer
    expect(
      reorder(source, [
        ["ZEBRA", zebra],
        ["AlPhA", alpha]
      ])
    ).toBe(header + alpha + "\n" + zebra + footer)
  })
  it("accepts relative implementation links", () => {
    const source = header + zebra + footer
    const method = element(source, "zebra", zebra)
    method.links[0].href = method.links[0].href.replace(url, "main")
    expect(alphabetizeClassMethods(source, "ZCL_TEST", url, [method])).toBe(source)
  })
  it("accepts links relative to the class object URI", () => {
    const source = header + zebra + footer
    const method = element(source, "zebra", zebra)
    method.links[0].href = method.links[0].href.replace(url, "source/main")
    expect(alphabetizeClassMethods(source, "ZCL_TEST", url, [method])).toBe(source)
  })
  it("accepts fragment-only links with component identifiers", () => {
    const source = header + zebra + footer
    const method = element(source, "zebra", zebra)
    method.links[0].href = method.links[0].href.replace(url + "#", "#type=CLAS/OM;name=ZEBRA;")
    expect(alphabetizeClassMethods(source, "ZCL_TEST", url, [method])).toBe(source)
  })
  it("does not require a final newline", () => {
    const source = (header + zebra + "\n" + alpha + footer).trimEnd()
    expect(reorder(source)).toBe((header + alpha + "\n" + zebra + footer).trimEnd())
  })
  it("preserves CRLF gaps while moving inline end comments", () => {
    const source = (header + zebra + ' " zebra comment\n' + alpha + footer).replace(/\n/g, "\r\n")
    expect(
      reorder(source, [
        ["zebra", zebra.replace(/\n/g, "\r\n")],
        ["alpha", alpha.replace(/\n/g, "\r\n")]
      ])
    ).toBe((header + alpha + "\n" + zebra + ' " zebra comment' + footer).replace(/\n/g, "\r\n"))
  })
  it("preserves METHOD header comments, pragmas and multiline statements", () => {
    const body =
      'METHOD zebra. " header comment\n DATA text TYPE string ##NEEDED.\n text =\n `METHOD alpha. ENDMETHOD.`.\nENDMETHOD.'
    const source = header + body + "\n" + alpha + footer
    expect(
      reorder(source, [
        ["zebra", body],
        ["alpha", alpha]
      ])
    ).toBe(header + alpha + "\n" + body + footer)
  })
  it("handles constructor names and unequal method sizes", () => {
    const constructor = "METHOD constructor.\nENDMETHOD."
    const source = header + zebra + "\n" + constructor + "\n" + alpha + footer
    expect(
      reorder(source, [
        ["zebra", zebra],
        ["constructor", constructor],
        ["alpha", alpha]
      ])
    ).toBe(header + alpha + "\n" + constructor + "\n" + zebra + footer)
  })
  it("supports customer namespaces", () => {
    const source = (header + zebra + "\n" + alpha + footer).replace(/zcl_test/g, "/test/cl_worker")
    const methods = [element(source, "zebra", zebra), element(source, "alpha", alpha)]
    expect(alphabetizeClassMethods(source, "/TEST/CL_WORKER", url, methods)).toBe(
      (header + alpha + "\n" + zebra + footer).replace(/zcl_test/g, "/test/cl_worker")
    )
  })
  it("rejects extra end columns that spill into the next line", () => {
    const source = header + zebra + footer
    const method = element(source, "zebra", zebra)
    method.links[0].href = method.links[0].href.replace(/end=(\d+),\d+/, "end=$1,11")
    expect(() => alphabetizeClassMethods(source, "ZCL_TEST", url, [method])).toThrow(
      "Invalid ADT method position"
    )
  })
  it.each(["\n", "\r\n"])("sorts SAP dot-relative links with inclusive ends using %j", newline => {
    const first = "  METHOD zebra.\n    WRITE 'Z'.\n  ENDMETHOD."
    const second = "  METHOD alpha.\n    WRITE 'A'.\n  ENDMETHOD."
    const source = (header + first + "\n\n" + second + footer).replace(/\n/g, newline)
    const metadata = [
      ["zebra", first],
      ["alpha", second]
    ].map(([name, body]) => {
      const method = element(source, name, body.replace(/\n/g, newline).trimStart(), true)
      method.links[0].href = method.links[0].href.replace(url, "./source/main")
      method.links[0].rel = "http://www.sap.com/adt/relations/source/implementationBlock"
      return method
    })
    expect(alphabetizeClassMethods(source, "ZCL_TEST", url, metadata)).toBe(
      (header + second + "\n\n" + first + footer).replace(/\n/g, newline)
    )
  })
  it.each(["\n", "\r\n"])(
    "moves inline comments with SAP inclusive-end methods using %j",
    newline => {
      const source = (header + zebra + ' " zebra comment\n' + alpha + footer).replace(
        /\n/g,
        newline
      )
      const metadata = [
        ["zebra", zebra],
        ["alpha", alpha]
      ].map(([name, body]) => {
        const method = element(source, name, body.replace(/\n/g, newline), true)
        method.links[0].href = method.links[0].href.replace(url, "./source/main")
        return method
      })
      expect(alphabetizeClassMethods(source, "ZCL_TEST", url, metadata)).toBe(
        (header + alpha + "\n" + zebra + ' " zebra comment' + footer).replace(/\n/g, newline)
      )
    }
  )
  it("ignores dot-relative links pointing to other class resources", () => {
    const source = header + zebra + footer
    const other = element(source, "other", zebra, true)
    other.links[0].href = other.links[0].href.replace(url, "./includes/testclasses")
    expect(
      alphabetizeClassMethods(source, "ZCL_TEST", url, [
        other,
        element(source, "zebra", zebra, true)
      ])
    ).toBe(source)
  })
  it("rejects an inclusive end that misses the final period", () => {
    const source = header + zebra + footer
    const method = element(source, "zebra", zebra, true)
    method.links[0].href = method.links[0].href.replace(/end=(\d+),\d+/, "end=$1,8")
    expect(() => alphabetizeClassMethods(source, "ZCL_TEST", url, [method])).toThrow(
      "does not match"
    )
  })
  it("still rejects mismatched start positions with inclusive ends", () => {
    const source = header + zebra + footer
    const method = element(source, "zebra", zebra, true)
    method.links[0].href = method.links[0].href.replace(/start=(\d+),\d+/, "start=$1,1")
    expect(() => alphabetizeClassMethods(source, "ZCL_TEST", url, [method])).toThrow(
      "does not match"
    )
  })
})
