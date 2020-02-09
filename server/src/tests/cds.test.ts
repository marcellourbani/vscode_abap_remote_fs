import {
  parseCDS,
  findNode,
  isTerminal,
  parseCDSWithDataSources
} from "../cdsSyntax"
import { Position } from "vscode-languageserver"
import { ABAPCDSParser } from "abapcdsgrammar"
import { ParseTreeListener, ParseTree } from "antlr4ts/tree"

const sampleview = `@AbapCatalog.sqlViewName: 'ZAPIDUMMY_DDEFSV'
@AbapCatalog.compiler.compareFilter: true
@AbapCatalog.preserveKey: true
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'data definition test'
@Metadata.allowExtensions: true
define view ZAPIDUMMY_datadef as select from e070 inner join e071 on e071~trkorr = e070~trkorr {
    trkorr,
    korrdev,
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
