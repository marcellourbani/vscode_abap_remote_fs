import { completionSourceUrl, convertToSnippet } from "./completionutils"

describe("completionSourceUrl", () => {
  it("adds the selected master program as completion context", () => {
    expect(
      completionSourceUrl(
        "/sap/bc/adt/programs/includes/zxpadu01/source/main",
        "/sap/bc/adt/functions/groups/xpad"
      )
    ).toBe(
      "/sap/bc/adt/programs/includes/zxpadu01/source/main?context=%2Fsap%2Fbc%2Fadt%2Ffunctions%2Fgroups%2Fxpad"
    )
  })

  it("leaves standalone program URLs unchanged", () => {
    const sourceUrl = "/sap/bc/adt/programs/programs/zmd_ddic_create/source/main"

    expect(completionSourceUrl(sourceUrl)).toBe(sourceUrl)
  })
})

describe("convertToSnippet", () => {
  it("converts a function module signature into a snippet", () => {
    const fullText =
      "GET_TABLE_ACCESS'\r\n" +
      "  EXPORTING\r\n" +
      "    progname   = \r\n" +
      "    tabname    = \r\n" +
      "*  IMPORTING\r\n" +
      "*    exec_sql   = \r\n" +
      "  TABLES\r\n" +
      "    access_tab = \r\n" +
      "  ."

    expect(convertToSnippet(fullText)).toBe(
      "GET_TABLE_ACCESS'\n" +
        "  EXPORTING\n" +
        "    progname   = ${1}\n" +
        "    tabname    = ${2}\n" +
        "*  IMPORTING\n" +
        "*    exec_sql   = \n" +
        "  TABLES\n" +
        "    access_tab = ${3}\n" +
        "  .$0"
    )
  })

  it("returns undefined when ADT provides no parameter slots", () => {
    expect(convertToSnippet("GET_TABLE_ACCESS'")).toBeUndefined()
  })
})
