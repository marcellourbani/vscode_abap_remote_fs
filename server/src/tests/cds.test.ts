import {
  createSourceDetector,
  createFakeTokenInjector,
  parseCDS,
  findNode
} from "../cdsSyntax"
import { Position } from "vscode-languageserver"
import { ABAPCDSParser } from "abapcdsgrammar"
import { ANTLRErrorListener, Token } from "antlr4ts"
import { ATNState, TransitionType } from "antlr4ts/atn"

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
  const leaf = findNode(result, cursor)
  expect(leaf).toBeDefined()
  expect(leaf?.ruleIndex).toBe(ABAPCDSParser.RULE_field)
  expect(leaf?.text).toBe("fo")
})

test("cds parse for completion end of line", async () => {
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
    syntaxError: (
      recognizer,
      offendingSymbol,
      line: number,
      charPositionInLine: number,
      msg: string
    ) => {
      errors.push(msg)
    }
  }
  const tree = parseCDS(source, { errorListener })
  expect(tree).toBeDefined()
  expect(errors.length).toBe(2)
})

test("extract source tables", async () => {
  const sources: string[] = []
  const parserListener = createSourceDetector(s => sources.push(s))
  const result = parseCDS(sampleview, { parserListener })
  expect(result).toBeDefined()
  expect(sources.length).toBe(2)
  expect(sources).toEqual(["e071", "e070"])
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
const suggestionCollector = (
  collect: (sugg: string) => void
): ANTLRErrorListener<Token> => ({
  syntaxError: recognizer => {
    const state = recognizer.atn.states[recognizer.state]
    const traversed = new Set<number>()

    const traverse = (s: ATNState) => {
      traversed.add(s.stateNumber)
      for (const t of s.getTransitions()) {
        if (t.isEpsilon) {
          if (!traversed.has(t.target.stateNumber)) traverse(t.target)
        } else if (t.serializationType === TransitionType.ATOM) {
          collect(recognizer.vocabulary.getDisplayName((t as any)._label))
        } else if (t.serializationType === TransitionType.SET) {
          // not implemented...
        }
      }
    }

    traverse(state)
  }
})

// ok, we get the token names. IDs are easy too.
// But couldn't find a way to convert i.e. BOOLEANLITERAL to true or false
// guess ANTLR compiles those in an automata, might try to follow that but risk going down a rabbit hole
// completion of table names and fields will do for now
test("syntax completion suggestions", async () => {
  const source = `define view ZAPIDUMMY_datadef af select from e070 inn a { as4user }`
  const cursor: Position = { line: 0, character: 31 }
  let original: Token | undefined
  const suggestions: string[] = []
  const tokenMiddleware = createFakeTokenInjector(cursor, t => (original = t))
  const result = parseCDS(source, {
    tokenMiddleware,
    errorListener: suggestionCollector(s => suggestions.push(s))
  })
  expect(result).toBeDefined()
  expect(original).toBeDefined()
  expect(suggestions.find(x => x === "AS")).toBeTruthy()
  expect(suggestions.find(x => x === "WITH")).toBeTruthy()
})
// autocomplete doesn't seem to work at all...
// test("syntax completion suggestions 2", async () => {
//   const source = `define view ZAPIDUMMY_datadef `
//   const lc: any = (ABAPCDSLexer as any) as Constructor<Lexer>
//   const pc: any = (ABAPCDSParser as any) as Constructor<Parser>

//   const suggester = autosuggester(lc, pc, "BOTH")
//   const suggestions = suggester.autosuggest(source)
//   expect(suggestions.length).toBeGreaterThan(0)
// })
