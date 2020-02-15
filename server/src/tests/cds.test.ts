import { parseCDS, findNode, parseCDSWithDataSources } from "../cdsSyntax"
import { Position } from "vscode-languageserver"
import { ABAPCDSParser } from "abapcdsgrammar"

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
  as isreleased,fo
}`

test("cds parse for completion", async () => {
  const cursor: Position = { line: 16, character: 18 }
  const result = parseCDS(sampleview)
  expect(result).toBeDefined()
  const leaf = findNode(result.tree, cursor)
  expect(leaf).toBeDefined()
  expect(leaf?.ruleIndex).toBe(ABAPCDSParser.RULE_field)
  expect(leaf?.text).toBe("fo")
})

test("cds parse for completion end of line", async () => {
  const cursor: Position = { line: 16, character: 16 }
  const result = parseCDS(sampleview)
  expect(result).toBeDefined()
  const leaf = findNode(result.tree, cursor)
  expect(leaf).toBeDefined()
  expect(leaf?.ruleIndex).toBe(ABAPCDSParser.RULE_select_list)
})

test("cds parsing errors", async () => {
  const source = `define view ZAPIDUMMY_datadef as select from { as4user foobar defwe }`
  const tree = parseCDS(source)
  expect(tree).toBeDefined()
  expect(tree.errors.length).toBe(2)
})

test("extract source tables", async () => {
  const result = parseCDSWithDataSources(sampleview)
  expect(result).toBeDefined()
  expect(result.sources.length).toBe(2)
  expect(result.sources).toEqual(["e071", "e070"])
})

test("cds parse for annotation", async () => {
  const cursor: Position = { line: 8, character: 13 }
  const result = parseCDS(sampleview)
  expect(result).toBeDefined()
  const anno1 = findNode(result.tree, cursor)
  expect(anno1).toBeDefined()
  expect(anno1?.ruleIndex).toBe(ABAPCDSParser.RULE_annotation_identifier)
  expect(anno1?.text).toBe("Aggregation")
  cursor.character = 20
  const anno2 = findNode(result.tree, cursor)
  expect(anno2).toBeDefined()
  // with the patched CDS grammar a keyword is acceptable
  expect(anno2?.ruleIndex).toBe(ABAPCDSParser.RULE_keyword)
  expect(anno2?.text).toBe("default")
})
