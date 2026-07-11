jest.mock("vscode", () => ({}), { virtual: true })
jest.mock("../adt/conections", () => ({ abapUri: jest.fn(), uriRoot: jest.fn() }))
jest.mock("abapfs", () => ({ isAbapStat: jest.fn() }))

import { buildTooltip } from "./AbapFileDecorationProvider"

const obj = (overrides: Record<string, unknown> = {}) =>
  ({
    type: "PROG/P",
    name: "ZFOO",
    version: "active",
    path: "/sap/bc/adt/programs/programs/zfoo",
    structure: {
      metaData: {
        "adtcore:description": "My report",
        "adtcore:changedAt": Date.UTC(2024, 0, 15, 10, 30, 0),
        "adtcore:changedBy": "DEVELOPER",
        "program:programType": "1",
        ...overrides
      }
    }
  }) as any

describe("buildTooltip", () => {
  it("returns curated header + humanized metadata fields", () => {
    const t = buildTooltip(obj())!
    expect(t).toContain("Name: ZFOO")
    expect(t).toContain("Description: My report")
    expect(t).toContain("Changed by: DEVELOPER")
    expect(t).toContain("Program type: 1")
  })

  it("suppresses Type / ADT path / low-value fields", () => {
    const t = buildTooltip(
      obj({
        "abapsource:sourceUri": "source/main",
        "abapsource:fixPointArithmetic": true,
        "abapsource:activeUnicodeCheck": false,
        "abapsource:abapLanguageVersion": "5"
      })
    )!
    expect(t).not.toMatch(/^Type: /m)
    expect(t).not.toMatch(/ADT path/)
    expect(t).not.toMatch(/Source uri/i)
    expect(t).not.toMatch(/Fix point arithmetic/i)
    expect(t).not.toMatch(/Active unicode check/i)
    expect(t).not.toMatch(/Abap language version/i)
  })

  it("formats *At numeric fields as dates", () => {
    const t = buildTooltip(obj())!
    expect(t).toMatch(/Changed at:.*2024/)
  })

  it("skips empty / null / nested values", () => {
    const t = buildTooltip(
      obj({
        "adtcore:masterLanguage": "",
        "adtcore:responsible": null,
        "adtcore:links": [{ href: "x" }]
      })
    )!
    expect(t).not.toMatch(/Master language/i)
    expect(t).not.toMatch(/Responsible/i)
    expect(t).not.toMatch(/Links/i)
  })

  it("still produces output when structure is missing", () => {
    const bare = { type: "CLAS/OC", name: "ZCL_X", path: "/foo" } as any
    const t = buildTooltip(bare)!
    expect(t).toContain("Name: ZCL_X")
  })

  it("returns undefined when nothing to show", () => {
    expect(buildTooltip({} as any)).toBeUndefined()
  })
})
