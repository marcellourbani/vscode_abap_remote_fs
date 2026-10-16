import { describe, expect, it } from "vitest"
import { formatRepositoryAbap, normalizeRepositoryAbapWhitespace } from "./abapSourceFormatter"
import { parseAbapFile } from "../../lib/functions"

const lexicalCorpus = [
  {
    name: "classic report and procedural statements",
    source: `REPORT zlegacy.
TABLES mara.
DATA gt_mara TYPE STANDARD TABLE OF mara WITH HEADER LINE.
START-OF-SELECTION.
  SELECT * FROM mara INTO TABLE gt_mara UP TO 10 ROWS.
  LOOP AT gt_mara.
    WRITE: / gt_mara-matnr.
  ENDLOOP.
FORM display USING value TYPE any.
  WRITE value.
ENDFORM.
`
  },
  {
    name: "local class definitions and implementations",
    source: `REPORT zclasses.
CLASS lcl_worker DEFINITION.
  PUBLIC SECTION.
    METHODS run IMPORTING input TYPE string.
ENDCLASS.
CLASS lcl_worker IMPLEMENTATION.
  METHOD run.
    WRITE input.
  ENDMETHOD.
ENDCLASS.
`
  },
  {
    name: "modern expressions and table access",
    source: `REPORT zmodern.
DATA(values) = VALUE string_table( ( \`A  B\` ) ( \`C\` ) ).
DATA(first) = values[ 1 ].
DATA(result) = COND string( WHEN first IS NOT INITIAL THEN first ELSE \`none\` ).
`
  },
  {
    name: "modern Open SQL",
    source: `REPORT zsql.
DATA carrier TYPE s_carr_id VALUE 'LH'.
SELECT carrid, connid
  FROM spfli
  WHERE carrid = @carrier
  INTO TABLE @DATA(connections).
`
  },
  {
    name: "macros and placeholders",
    source: `REPORT zmacro.
DEFINE write_value.
  WRITE &1.
END-OF-DEFINITION.
write_value 'A  B'.
`
  },
  {
    name: "comments documentation pseudo-comments and pragmas",
    source: `REPORT zcomments.
* full-line  comment
" ordinary  comment
"! ABAP Doc  comment
DATA value TYPE i ##NEEDED.
WRITE value. "#EC NEEDED
`
  },
  {
    name: "escaped literals and string templates",
    source: `REPORT zliterals.
DATA text1 TYPE string VALUE 'It''s  spaced'.
DATA text2 TYPE string VALUE \`A  B\`.
DATA text3 TYPE string VALUE |A  B { 1 +  2 } C  D|.
DATA text4 TYPE string VALUE |escaped \\| pipe  text|.
`
  },
  {
    name: "method calls selectors offsets and operators",
    source: `REPORT zoperators.
result = object->factory( )->calculate(
  input = structure-component
  option = table[ id = 1 ]-value ).
part = result+0(1).
flag = xsdbool( left = right AND other <> 0 ).
`
  },
  {
    name: "control flow exceptions and inline declarations",
    source: `REPORT zflow.
TRY.
    LOOP AT items ASSIGNING FIELD-SYMBOL(<item>) WHERE active = abap_true.
      IF <item>-value IS INITIAL.
        CONTINUE.
      ENDIF.
    ENDLOOP.
  CATCH cx_root INTO DATA(error).
    MESSAGE error TYPE 'I'.
ENDTRY.
`
  },
  {
    name: "tabs CRLF and trailing whitespace",
    source:
      'REPORT ztabs.\r\n\tDATA\tvalue\tTYPE\tstring.\t\r\n\tWRITE\t`A\t B`.\t" keep\t comment\r\n'
  },
  {
    name: "interface definitions aliases and interface methods",
    source: `REPORT zinterfaces.
INTERFACE lif_worker.
  METHODS run IMPORTING input TYPE string.
ENDINTERFACE.
CLASS lcl_worker DEFINITION.
  PUBLIC SECTION.
    INTERFACES lif_worker.
    ALIASES run FOR lif_worker~run.
ENDCLASS.
CLASS lcl_worker IMPLEMENTATION.
  METHOD lif_worker~run.
    WRITE input.
  ENDMETHOD.
ENDCLASS.
`
  },
  {
    name: "function module source",
    source: `FUNCTION z_example.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING VALUE(INPUT) TYPE STRING
*"----------------------------------------------------------------------
  WRITE input.
ENDFUNCTION.
`
  },
  {
    name: "selection screen and event blocks",
    source: `REPORT zevents.
PARAMETERS parameter TYPE string.
SELECT-OPTIONS range FOR sy-datum.
INITIALIZATION.
  parameter = \`A  B\`.
AT SELECTION-SCREEN.
  IF parameter IS INITIAL.
    MESSAGE 'Required' TYPE 'E'.
  ENDIF.
START-OF-SELECTION.
  WRITE parameter.
`
  },
  {
    name: "field symbols data references and dereferencing",
    source: `REPORT zreferences.
FIELD-SYMBOLS <row> TYPE any.
DATA reference TYPE REF TO data.
CREATE DATA reference TYPE string.
ASSIGN reference->* TO <row>.
IF <row> IS ASSIGNED.
  <row> = \`A  B\`.
ENDIF.
`
  },
  {
    name: "chained declarations and calls",
    source: `REPORT zchains.
DATA: first TYPE i,
      second TYPE i,
      third TYPE string VALUE \`A  B\`.
CLEAR: first, second.
CALL METHOD object->execute
  EXPORTING
    input = third
  IMPORTING
    result = second.
`
  },
  {
    name: "aligned method declarations resembling generated class source",
    source: `REPORT zaligned.
CLASS lcl_example DEFINITION.
  PUBLIC SECTION.
    METHODS execute
      IMPORTING
        document_id          TYPE string
        appointment_id       TYPE string
        document_internal_id TYPE int4
      EXPORTING
        entity               TYPE string
      RAISING
        cx_root.
ENDCLASS.
`
  }
]

function tokenText(source: string): string[] {
  const parsed = parseAbapFile("ztest.prog.abap", source)
  expect(parsed).toBeDefined()
  return parsed!.getTokens(true).map(token => token.getStr())
}

function lineEndings(source: string): string[] {
  return source.match(/\r\n|\r|\n/g) ?? []
}

describe("formatRepositoryAbap", () => {
  it("uses one stable case and layout for ABAP code", () => {
    const upper = "REPORT ZTEST.\nDATA VALUE TYPE STRING.\nWRITE VALUE.\n"
    const lower = "report ztest.\ndata value type string.\nwrite value.\n"

    expect(formatRepositoryAbap("ztest.prog.abap", upper)).toBe(
      formatRepositoryAbap("ztest.prog.abap", lower)
    )
  })

  it("preserves case differences inside literals", () => {
    const upperLiteral = "REPORT ztest.\nWRITE 'VALUE'.\n"
    const lowerLiteral = "REPORT ztest.\nWRITE 'value'.\n"

    expect(formatRepositoryAbap("ztest.prog.abap", upperLiteral)).not.toBe(
      formatRepositoryAbap("ztest.prog.abap", lowerLiteral)
    )
  })

  it("collapses horizontal whitespace only between ABAPLint tokens", () => {
    const source = 'REPORT ztest.\n    WRITE    `A  B`.    " keep  comment\n'

    expect(normalizeRepositoryAbapWhitespace("ztest.prog.abap", source)).toBe(
      'REPORT ztest.\n WRITE `A  B`. " keep  comment\n'
    )
  })

  it("preserves string templates and line boundaries", () => {
    const source = "REPORT ztest.\r\n    WRITE    |A  B { 1 +  2 }|.\r\n"

    expect(normalizeRepositoryAbapWhitespace("ztest.prog.abap", source)).toBe(
      "REPORT ztest.\r\n WRITE |A  B { 1 + 2 }|.\r\n"
    )
  })

  it("preserves pragmas while normalizing their surrounding whitespace", () => {
    const source = "REPORT ztest.\nDATA    value    TYPE i    ##NEEDED.\n"

    expect(normalizeRepositoryAbapWhitespace("ztest.prog.abap", source)).toBe(
      "REPORT ztest.\nDATA value TYPE i ##NEEDED.\n"
    )
  })

  it("preserves character, string, and template literal contents exactly", () => {
    const source =
      "REPORT ztest.\n WRITE 'A  B''s'.\n WRITE `C\t  D`.\n WRITE |E  F { 1 +  2 } G  H|.\n"
    const normalized = normalizeRepositoryAbapWhitespace("ztest.prog.abap", source)

    expect(normalized).toContain("'A  B''s'")
    expect(normalized).toContain("`C\t  D`")
    expect(normalized).toContain("|E  F { 1 + 2 } G  H|")
  })

  it("preserves all comment forms exactly", () => {
    const source = '* full-line  comment\n"! documentation  comment\n WRITE value.  "#EC  NEEDED\n'

    expect(normalizeRepositoryAbapWhitespace("ztest.prog.abap", source)).toBe(
      '* full-line  comment\n"! documentation  comment\n WRITE value. "#EC  NEEDED\n'
    )
  })

  it("does not move a full-line asterisk comment away from column one", () => {
    const source = "* exact  comment\n    WRITE    value.\n"
    const normalized = normalizeRepositoryAbapWhitespace("ztest.prog.abap", source)

    expect(normalized.startsWith("* exact  comment\n")).toBe(true)
    expect(normalized).toBe("* exact  comment\n WRITE value.\n")
  })

  it("preserves LF, CRLF, and CR line boundaries exactly", () => {
    for (const source of [
      "REPORT ztest.\n    WRITE    value.\n",
      "REPORT ztest.\r\n    WRITE    value.\r\n",
      "REPORT ztest.\r    WRITE    value.\r"
    ]) {
      const normalized = normalizeRepositoryAbapWhitespace("ztest.prog.abap", source)
      expect(lineEndings(normalized)).toEqual(lineEndings(source))
    }
  })

  it("normalizes around standalone CR without relying on token columns", () => {
    const source = "REPORT    ztest.\r    WRITE    value.\r"

    expect(normalizeRepositoryAbapWhitespace("ztest.prog.abap", source)).toBe(
      "REPORT ztest.\r WRITE value.\r"
    )
  })

  it("preserves mixed line-ending order exactly", () => {
    const source = "REPORT ztest.\r\n    DATA    value TYPE i.\n    WRITE    value.\r"
    const normalized = normalizeRepositoryAbapWhitespace("ztest.prog.abap", source)

    expect(normalized).toBe("REPORT ztest.\r\n DATA value TYPE i.\n WRITE value.\r")
    expect(lineEndings(normalized)).toEqual(["\r\n", "\n", "\r"])
  })

  it("preserves blank-line count while normalizing horizontal whitespace", () => {
    const source = "REPORT ztest.\n   \n\t\t\n    WRITE    value.\n"

    expect(normalizeRepositoryAbapWhitespace("ztest.prog.abap", source)).toBe(
      "REPORT ztest.\n \n \n WRITE value.\n"
    )
  })

  it("preserves punctuation adjacency and only changes existing whitespace gaps", () => {
    const source =
      "REPORT ztest.\n result=object->method( )->component.\n value = table[ 1 ]-field.\n"

    expect(normalizeRepositoryAbapWhitespace("ztest.prog.abap", source)).toBe(
      "REPORT ztest.\n result=object->method( )->component.\n value = table[ 1 ]-field.\n"
    )
  })

  it("processes repeated identical tokens strictly in source order", () => {
    const source = "REPORT ztest.\n    value    =    value    +    value.\n"

    expect(normalizeRepositoryAbapWhitespace("ztest.prog.abap", source)).toBe(
      "REPORT ztest.\n value = value + value.\n"
    )
  })

  it("does not mistake token-like text inside literals and comments for later tokens", () => {
    const source =
      'REPORT ztest.\n    WRITE    `WRITE value.    DATA other TYPE i.`.    " WRITE    value.\n    WRITE    value.\n'

    expect(normalizeRepositoryAbapWhitespace("ztest.prog.abap", source)).toBe(
      'REPORT ztest.\n WRITE `WRITE value.    DATA other TYPE i.`. " WRITE    value.\n WRITE value.\n'
    )
  })

  it("normalizes leading and trailing horizontal whitespace without removing it", () => {
    const source = " \t REPORT    ztest. \t "

    expect(normalizeRepositoryAbapWhitespace("ztest.prog.abap", source)).toBe(" REPORT ztest. ")
  })

  it("handles a final comment and trailing whitespace without a newline", () => {
    const source = 'REPORT ztest.\n    WRITE    value.    " final  comment\t  '

    expect(normalizeRepositoryAbapWhitespace("ztest.prog.abap", source)).toBe(
      'REPORT ztest.\n WRITE value. " final  comment '
    )
  })

  it("keeps an indented multiplication operator away from comment column one", () => {
    const source = "REPORT ztest.\n    result = 2\n        *    3.\n"
    const normalized = normalizeRepositoryAbapWhitespace("ztest.prog.abap", source)

    expect(normalized).toBe("REPORT ztest.\n result = 2\n * 3.\n")
    expect(normalized.split("\n")[2].startsWith(" *")).toBe(true)
  })

  it("preserves comment-only files including delimiter-like text", () => {
    const source = "* '  |  `  DATA    value\n\" second  comment without newline"

    expect(normalizeRepositoryAbapWhitespace("ztest.prog.abap", source)).toBe(source)
  })

  it("normalizes declaration alignment matching repository diff noise", () => {
    const aligned = `REPORT ztest.
METHODS execute
  IMPORTING
    document_id          TYPE string
    appointment_id       TYPE string
    document_internal_id TYPE int4.
`
    const compact = `REPORT ztest.
METHODS execute
 IMPORTING
 document_id TYPE string
 appointment_id TYPE string
 document_internal_id TYPE int4.
`

    expect(normalizeRepositoryAbapWhitespace("ztest.prog.abap", aligned)).toBe(
      normalizeRepositoryAbapWhitespace("ztest.prog.abap", compact)
    )
  })

  it("normalizes alignment before pseudo-comments but preserves their content", () => {
    const aligned = 'REPORT ztest.\n    SELECT * FROM mara.                    "#EC  CI_NOWHERE\n'
    const compact = 'REPORT ztest.\n SELECT * FROM mara. "#EC  CI_NOWHERE\n'

    expect(normalizeRepositoryAbapWhitespace("ztest.prog.abap", aligned)).toBe(compact)
  })

  it("is idempotent", () => {
    const source =
      'REPORT ztest.\n    DATA\tvalue    TYPE string VALUE `A  B`.\n    WRITE    value.  " keep  this\n'
    const once = normalizeRepositoryAbapWhitespace("ztest.prog.abap", source)

    expect(normalizeRepositoryAbapWhitespace("ztest.prog.abap", once)).toBe(once)
  })

  it("makes horizontal-whitespace-only formatting differences equal", () => {
    const spaced = "REPORT ztest.\n    DATA    value    TYPE i.\n    WRITE    value.\n"
    const tabbed = "REPORT\tztest.\n\tDATA\tvalue\tTYPE\ti.\n\tWRITE\tvalue.\n"

    expect(formatRepositoryAbap("ztest.prog.abap", spaced)).toBe(
      formatRepositoryAbap("ztest.prog.abap", tabbed)
    )
  })

  it("does not hide literal whitespace differences", () => {
    const oneSpace = "REPORT ztest.\nWRITE `A B`.\n"
    const twoSpaces = "REPORT ztest.\nWRITE `A  B`.\n"

    expect(formatRepositoryAbap("ztest.prog.abap", oneSpace)).not.toBe(
      formatRepositoryAbap("ztest.prog.abap", twoSpaces)
    )
  })

  it("does not hide comment whitespace differences", () => {
    const oneSpace = 'REPORT ztest.\nWRITE value. " one space\n'
    const twoSpaces = 'REPORT ztest.\nWRITE value. " one  space\n'

    expect(formatRepositoryAbap("ztest.prog.abap", oneSpace)).not.toBe(
      formatRepositoryAbap("ztest.prog.abap", twoSpaces)
    )
  })

  it("fails closed when ABAPLint leaves a non-whitespace character uncovered", () => {
    expect(() =>
      normalizeRepositoryAbapWhitespace("ztest.prog.abap", "\uFEFFREPORT ztest.\n")
    ).toThrow("ABAPLint token coverage")
  })

  it.each([
    ["between statements", "REPORT ztest.\n\uFEFFWRITE value.\n"],
    ["at end of source", "REPORT ztest.\n\uFEFF"]
  ])("fails closed for an uncovered character %s", (_name, source) => {
    expect(() => normalizeRepositoryAbapWhitespace("ztest.prog.abap", source)).toThrow(
      "ABAPLint token coverage"
    )
  })

  it("handles empty source without inventing content", () => {
    expect(normalizeRepositoryAbapWhitespace("ztest.prog.abap", "")).toBe("")
  })

  it.each(lexicalCorpus)("preserves the complete token stream for $name", ({ source }) => {
    const normalized = normalizeRepositoryAbapWhitespace("ztest.prog.abap", source)

    expect(tokenText(normalized)).toEqual(tokenText(source))
    expect(lineEndings(normalized)).toEqual(lineEndings(source))
  })
})
