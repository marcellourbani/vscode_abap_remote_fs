import {
  createSourceDetector,
  createFakeTokenInjector,
  parseCDS,
  findNode
} from "../cdsSyntax"
import { Position } from "vscode-languageserver"
import { ABAPCDSParser, ABAPCDSLexer } from "abapcdsgrammar"
import {
  ANTLRErrorListener,
  Token,
  Lexer,
  Parser,
  ANTLRInputStream
} from "antlr4ts"
import { autosuggester, Constructor } from "antlr4-autosuggest"
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
      msg: string,
      e
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
  syntaxError: (
    recognizer,
    offendingSymbol,
    line: number,
    charPositionInLine: number,
    msg: string,
    e
  ) => {
    const state = recognizer.atn.states[recognizer.state]
    for (const token of state?.nextTokenWithinRule?.intervals || []) {
      const name = recognizer.vocabulary.getDisplayName(token.a)
      if (name) collect(name)
    }
    // offendingSymbol?.inputStream?.LA.
    for (const t of state.getTransitions()) {
      if (t.isEpsilon) collect(t.label?.toString() || "")
    }

    const tokens: Token[] = (recognizer?.inputStream as any)?.tokens || []
    const traversed = new Set<number>()

    const traverse = (s: ATNState) => {
      traversed.add(s.stateNumber)
      for (const t of s.getTransitions()) {
        if (t.isEpsilon) {
          if (!traversed.has(t.target.stateNumber)) traverse(t.target)
        } else if (t.serializationType === TransitionType.ATOM) {
          collect(recognizer.vocabulary.getDisplayName((t as any)._label))
          collect(t.target.toString())
        } else if (t.serializationType === TransitionType.SET) {
          collect(t.target.toString())
        }
      }
    }

    traverse(state)

    if (tokens.length > 1) {
      const lastToken = tokens[tokens.length - 2]
      const tokenType = recognizer.vocabulary.getDisplayName(lastToken.type)
      collect(tokenType)
    }
    collect(msg)
  }
})
test("syntax completion suggestions", async () => {
  const source = `define as view ZAPIDUMMY_datadef af select from e070 inn a { as4user }`
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
  expect(suggestions[0]).toBe("as")
  expect(suggestions[1]).toBe("WITH")
})

test("syntax completion suggestions 2", async () => {
  const source = `define view ZAPIDUMMY_datadef A`
  const lc: any = (ABAPCDSLexer as any) as Constructor<Lexer>
  const pc: any = (ABAPCDSParser as any) as Constructor<Parser>

  const suggester = autosuggester(lc, pc, "BOTH")
  const suggestions = suggester.autosuggest(source)
  expect(suggestions).toBeDefined()
  fail(1)
})
