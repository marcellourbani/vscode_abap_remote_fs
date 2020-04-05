import { cdsCompletionExtractor } from "../cdsSyntax"
import { parseCDS, findNode } from "../cdsSyntax"
import { Position } from "vscode-languageserver"
import { ABAPCDSParser } from "abapcdsgrammar"
import { ANTLRErrorListener, Token } from "antlr4ts"

const sampleview = `@AbapCatalog.sqlViewName: 'ZAPIDUMMY_DDEFSV'
@AbapCatalog.compiler.compareFilter: true
@AbapCatalog.preserveKey: true
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'data definition test'
@Metadata.allowExtensions: true
define view ZAPIDUMMY_datadef as select from e070 inner join e071 on e071.trkorr = e070.trkorr {
    e071.trkorr,
    @Aggregation.default: #NONE
    as4user ,
      cast(
  case trstatus
    when 'R' then 'X'
    when 'N' then 'X'
    else ' '
  end as flag )
  as isreleased, fo
}`

test("cds parse for completion end of line", async () => {
  const cursor: Position = { line: 16, character: 18 } // last character, not cursor position
  const result = parseCDS(sampleview)
  expect(result).toBeDefined()
  const leaf = findNode(result, cursor)
  expect(leaf).toBeDefined()
  expect(leaf?.ruleIndex).toBe(ABAPCDSParser.RULE_field)
  expect(leaf?.text).toBe("fo")
})

test("cds parse for completion after comma", async () => {
  const cursor: Position = { line: 16, character: 16 }
  const result = parseCDS(sampleview)
  expect(result).toBeDefined()
  const leaf = findNode(result, cursor)
  expect(leaf).toBeDefined()
  expect(leaf?.ruleIndex).toBe(ABAPCDSParser.RULE_select_list)
})

test("cds parsing errors", async () => {
  const source = `define view ZAPIDUMMY_datadef as select from { as4user foobar defwe }`
  const errors: string[] = []
  const errorListener: ANTLRErrorListener<Token> = {
    syntaxError: (recognizer, offendingSymbol, line, cp, msg) => {
      errors.push(msg)
    }
  }
  const tree = parseCDS(source, { errorListener })
  expect(tree).toBeDefined()
  expect(errors.length).toBe(2)
})
test("cds parse for annotation", async () => {
  const cursor: Position = { line: 8, character: 13 }
  const result = parseCDS(sampleview)
  expect(result).toBeDefined()
  const anno1 = findNode(result, cursor)
  expect(anno1).toBeDefined()
  expect(anno1?.ruleIndex).toBe(ABAPCDSParser.RULE_annotation_identifier)
  expect(anno1?.text).toBe("Aggregation")
  cursor.character = 20
  const anno2 = findNode(result, cursor)
  expect(anno2).toBeDefined()
  // with the patched CDS grammar a keyword is acceptable
  expect(anno2?.ruleIndex).toBe(ABAPCDSParser.RULE_keyword)
  expect(anno2?.text).toBe("default")
})

test("source completion", async () => {
  const findSource = (view: string, cursor: Position) => {
    const res = cdsCompletionExtractor(view, cursor)
    if (res.matched === "SOURCE") return res.prefix
    return "nocall"
  }
  expect(findSource(sampleview, { line: 6, character: 65 })).toEqual("e071")
  expect(findSource(sampleview, { line: 6, character: 62 })).toEqual("e")
  expect(findSource(sampleview, { line: 6, character: 49 })).toEqual("e070")
  expect(findSource(sampleview, { line: 7, character: 62 })).toEqual("nocall")
})

test("field completion", async () => {
  let sources: string[] = []
  const findField = (view: string, cursor: Position) => {
    const res = cdsCompletionExtractor(view, cursor)
    if (res.matched === "FIELD") {
      sources = res.sources
      return res.prefix
    } else return "nocall"
  }
  expect(findField(sampleview, { line: 7, character: 11 })).toEqual("e071.tr")
  expect(findField(sampleview, { line: 9, character: 11 })).toEqual("as4user")
  expect(sources).toEqual(["e071", "e070"])
  expect(findField(sampleview, { line: 9, character: 12 })).toEqual("nocall")
  expect(findField(sampleview, { line: 16, character: 18 })).toEqual("f")
  expect(findField(sampleview, { line: 16, character: 13 })).toEqual("nocall")
})
