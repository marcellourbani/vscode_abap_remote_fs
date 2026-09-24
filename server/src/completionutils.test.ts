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

describe("convertToSnippet — methods", () => {
  it("Format A: empty multi-param (CRLF) keeps every slot and the closer", () => {
    const fullText =
      "add_to_transport(\r\n" +
      "      iv_object_type = \r\n" +
      "      iv_object_name = \r\n" +
      "    )."

    expect(convertToSnippet(fullText)).toBe(
      "add_to_transport(\n" +
        "      iv_object_type = ${1}\n" +
        "      iv_object_name = ${2}\n" +
        "    ).$0"
    )
  })

  it("Format A: echoed values on the next line are stripped", () => {
    const fullText =
      "add_to_transport(\n" +
      "      iv_object_type = \n" +
      "IV_OBJECT_TYPE\n" +
      "      iv_object_name = \n" +
      "IV_OBJECT_NAME\n" +
      "    )."

    expect(convertToSnippet(fullText)).toBe(
      "add_to_transport(\n" +
        "      iv_object_type = ${1}\n" +
        "      iv_object_name = ${2}\n" +
        "    ).$0"
    )
  })

  it("Format A: EXPORTING/IMPORTING with echoes keeps section headers", () => {
    const fullText =
      "ADD_TO_QUEUE(\n" +
      "  EXPORTING\n" +
      "    iv_huident = \n" +
      "iv_huident\n" +
      "    iv_lgnum = \n" +
      "iv_lgnum\n" +
      "  IMPORTING\n" +
      "    ev_print_data = \n" +
      "ev_print_data\n" +
      ")"

    expect(convertToSnippet(fullText)).toBe(
      "ADD_TO_QUEUE(\n" +
        "  EXPORTING\n" +
        "    iv_huident = ${1}\n" +
        "    iv_lgnum = ${2}\n" +
        "  IMPORTING\n" +
        "    ev_print_data = ${3}\n" +
        ")$0"
    )
  })

  it("Format A: empty slots before IMPORTING keep the section header", () => {
    const fullText =
      "ADD_TO_QUEUE(\n" +
      "  EXPORTING\n" +
      "    iv_huident = \n" +
      "    iv_lgnum = \n" +
      "  IMPORTING\n" +
      "    ev_print_data = \n" +
      ")"

    expect(convertToSnippet(fullText)).toBe(
      "ADD_TO_QUEUE(\n" +
        "  EXPORTING\n" +
        "    iv_huident = ${1}\n" +
        "    iv_lgnum = ${2}\n" +
        "  IMPORTING\n" +
        "    ev_print_data = ${3}\n" +
        ")$0"
    )
  })

  it("Format A: mixed echo and empty slots", () => {
    const fullText =
      "m(\n" + "      a = \n" + "ECHO_A\n" + "      b = \n" + "      c = \n" + "ECHO_C\n" + "    )."

    expect(convertToSnippet(fullText)).toBe(
      "m(\n" + "      a = ${1}\n" + "      b = ${2}\n" + "      c = ${3}\n" + "    ).$0"
    )
  })

  it("Format A: single param with echo then closer", () => {
    expect(convertToSnippet("foo(\n      iv_x = \nIV_X\n    ).")).toBe(
      "foo(\n      iv_x = ${1}\n    ).$0"
    )
  })

  it("Format B: inline ABAP comments after = are stripped", () => {
    const fullText =
      "m(\n" +
      '      iv_foo =                  " Importing\n' +
      '      iv_bar =                  " Importing\n' +
      "    )."

    expect(convertToSnippet(fullText)).toBe(
      "m(\n" + "      iv_foo = ${1}\n" + "      iv_bar = ${2}\n" + "    ).$0"
    )
  })

  it("Format C: single-line single param", () => {
    expect(convertToSnippet("method( iv_foo =  ).")).toBe("method( iv_foo =  ${1}).$0")
  })

  it("Format C: single-line multi param", () => {
    expect(convertToSnippet("method( iv_foo =  iv_bar =  ).")).toBe(
      "method( iv_foo =  ${1} iv_bar =  ${2}).$0"
    )
  })

  it("leaves already-filled assignments alone", () => {
    const fullText = "m(\n" + "      iv_a = 'X'\n" + "      iv_b = \n" + "    )."

    expect(convertToSnippet(fullText)).toBe(
      "m(\n" + "      iv_a = 'X'\n" + "      iv_b = ${1}\n" + "    ).$0"
    )
  })

  it("instance / interface method call prefix is preserved", () => {
    const fullText = "lo_obj->if_x~bar(\n" + "      iv_a = \n" + "      iv_b = \n" + "    )."

    expect(convertToSnippet(fullText)).toBe(
      "lo_obj->if_x~bar(\n" + "      iv_a = ${1}\n" + "      iv_b = ${2}\n" + "    ).$0"
    )
  })

  it("returns undefined when there are no empty assignment slots", () => {
    expect(convertToSnippet("method_name")).toBeUndefined()
    expect(convertToSnippet("method( ).")).toBeUndefined()
    expect(convertToSnippet("method( iv_a = 'X' ).")).toBeUndefined()
  })
})

describe("convertToSnippet — function modules", () => {
  it("classic CALL FUNCTION signature with optional IMPORTING commented out", () => {
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

  it("EXPORTING / IMPORTING / CHANGING sections", () => {
    const fullText =
      "Z_MY_FM'\n" +
      "  EXPORTING\n" +
      "    iv_a = \n" +
      "  IMPORTING\n" +
      "    ev_b = \n" +
      "  CHANGING\n" +
      "    cv_c = \n" +
      "  ."

    expect(convertToSnippet(fullText)).toBe(
      "Z_MY_FM'\n" +
        "  EXPORTING\n" +
        "    iv_a = ${1}\n" +
        "  IMPORTING\n" +
        "    ev_b = ${2}\n" +
        "  CHANGING\n" +
        "    cv_c = ${3}\n" +
        "  .$0"
    )
  })

  it("single EXPORTING parameter", () => {
    const fullText = "FM'\n" + "  EXPORTING\n" + "    iv_only = \n" + "  ."

    expect(convertToSnippet(fullText)).toBe(
      "FM'\n" + "  EXPORTING\n" + "    iv_only = ${1}\n" + "  .$0"
    )
  })

  it("does not tab-stop EXCEPTIONS values that are already filled", () => {
    const fullText =
      "FM'\n" + "  EXPORTING\n" + "    iv_a = \n" + "  EXCEPTIONS\n" + "    others = 1\n" + "  ."

    expect(convertToSnippet(fullText)).toBe(
      "FM'\n" +
        "  EXPORTING\n" +
        "    iv_a = ${1}\n" +
        "  EXCEPTIONS\n" +
        "    others = 1\n" +
        "  .$0"
    )
  })

  it("returns undefined when ADT provides no parameter slots", () => {
    expect(convertToSnippet("GET_TABLE_ACCESS'")).toBeUndefined()
  })
})
