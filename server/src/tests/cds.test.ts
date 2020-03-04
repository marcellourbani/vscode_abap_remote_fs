import { TransitionType } from "antlr4ts/atn"
import { positionInToken } from "./../cdsSyntax"
import {
  createSourceDetector,
  createFakeTokenInjector,
  parseCDS,
  findNode
} from "../cdsSyntax"
import { Position } from "vscode-languageserver"
import { ABAPCDSParser } from "abapcdsgrammar"
import {
  ANTLRErrorListener,
  Token,
  Recognizer,
  RuleContext,
  ParserRuleContext
} from "antlr4ts"
import { ParseTreeListener, ParseTree } from "antlr4ts/tree"
import { ATNState } from "antlr4ts/atn/ATNState"
const literals: { [key: string]: string | string[] } = {
  DEFINE: "define",
  VIEW: "view",
  AS: "as",
  SELECT: "select",
  FROM: "from",
  WHERE: "where",
  GROUPBY: "group by",
  HAVING: "having",
  UNION: "union",
  ALL: "all",
  KEY: "key",
  CASE: "case",
  WHEN: "when",
  THEN: "then",
  ELSE: "else",
  END: "end",
  CAST: "cast",
  PRESERVINGTYPE: "preserving type",
  DISTINCT: "distinct",
  TO: "to",
  WITH: "with",
  PARAMETERS: "parameters",
  DEFAULT: "default",
  FILTER: "filter",
  ASSOCIATION: "association",
  ON: "on",
  NOT: "not",
  AND: "and",
  OR: "or",
  BETWEEN: "between",
  LIKE: "like",
  ESCAPE: "escape",
  IS: "is",
  NULL: "null",
  INNER: "inner",
  JOIN: "join",
  OUTER: "outer",
  LEFT: "left",
  RIGHT: "right",
  ONE: "one",
  MANY: "many",
  CROSS: "cross",
  MAX: "max",
  MIN: "min",
  AVG: "avg",
  SUM: "sum",
  COUNT: "count",
  IMPLEMENTEDBYMETHOD: "implemented by method",
  TABLEFUNCTION: "table function",
  RETURNS: "returns",
  BOOLEANLITERAL: ["true", "false"]
}

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
const isEof = (t?: Token) => !!t && t.type === Token.EOF // t.stopIndex < t.startIndex

const prevTokens = (r: Recognizer<Token, any>) => {
  const tokens: Token[] = (r?.inputStream as any)?.tokens || []
  let idx = tokens.length - 1
  if (isEof(tokens[idx])) idx--
  const current = tokens[idx]
  const previous = tokens[idx - 1]
  return { current, previous }
}
const ptStart = (x: any) => x.start
const leafContext = (t: Token, c: ParseTree): ParseTree | undefined => {
  if (ptStart(c) === t && c.sourceInterval.a === c.sourceInterval.b) return c

  for (let idx = 0; idx < c.childCount; idx++) {
    const child = leafContext(t, c.getChild(idx))
    if (child) return child
  }
}
const lastTokenContext = (t: Token, c?: RuleContext) => {
  const findLast = (tk: Token, ct?: RuleContext): RuleContext | undefined => {
    const idx = (ct && ct.childCount - 1) || -1
    const last = ct && (ct.getChild(idx) as ParserRuleContext)
    if (last)
      if (last.start === tk) return last
      else return findLast(tk, last)
    return last
  }
  return findLast(t, c)
}

const genTraverse = (
  collect: (sugg: string) => void,
  recognizer: Recognizer<Token, any>
) => {
  const traversed = new Set<number>()

  const traverse = (s: ATNState) => {
    traversed.add(s.stateNumber)
    for (const t of s.getTransitions()) {
      if (t.isEpsilon) {
        if (!traversed.has(t.target.stateNumber)) traverse(t.target)
      } else if (t.serializationType === TransitionType.ATOM) {
        collect(recognizer.vocabulary.getDisplayName((t as any)._label))
        collect(t.target.toString())
      }
    }
  }
  return traverse
}
const suggestionCollector = (
  collect: (sugg: string) => void,
  position: Position
): ANTLRErrorListener<Token> => ({
  syntaxError: (recognizer, offending, line, char, msg, exc) => {
    // instanceof doesn't seem to work, at least in tests
    if (exc?.constructor.name === "InputMismatchException") {
      if (isEof(offending)) {
        const { current, previous } = prevTokens(recognizer)
        if (current && positionInToken(position, current) && previous) {
          // follow
          const context =
            exc.context && leafContext(previous, exc.context)?.parent
          const t = genTraverse(collect, recognizer)
          const state =
            context &&
            recognizer.atn.states[(context as RuleContext).invokingState]
          if (state) t(state)
          collect((context && context.text) || "bar")
        }
      } else if (offending && positionInToken(position, offending)) {
        const tokens = exc.expectedTokens?.intervals || []
        tokens.forEach(i => {
          const lit = literals[recognizer.vocabulary.getDisplayName(i.a)]
          if (lit) Array.isArray(lit) ? lit.map(collect) : collect(lit)
        })
      }
    }
  }
})

// ok, we get the token names. IDs are easy too.
// But couldn't find a way to convert i.e. BOOLEANLITERAL to true or false
// guess ANTLR compiles those in an automata, might try to follow that but risk going down a rabbit hole
// completion of table names and fields will do for now
test("syntax completion suggestions 1", async () => {
  const source = `define view ZAPIDUMMY_datadef as select from e070 foo`
  const cursor: Position = { line: 0, character: 50 }
  let original: Token | undefined
  const suggestions: string[] = []
  const tokenMiddleware = createFakeTokenInjector(cursor, t => (original = t))
  const result = parseCDS(source, {
    // tokenMiddleware,
    errorListener: suggestionCollector(s => suggestions.push(s), cursor)
  })
  expect(result).toBeDefined()
  // expect(original).toBeDefined()
  expect(suggestions.find(x => x === "as")).toBeTruthy()
  expect(suggestions.find(x => x === "WITH")).toBeTruthy()
})
const createPL = (
  collect: (sugg: string) => void,
  p: Position
): ParseTreeListener => ({
  enterEveryRule: ctx => {
    const t = ctx.start
    if (t.text && positionInToken(p, t)) {
      if (
        t.type === ABAPCDSParser.IDENTIFIER &&
        ctx.ruleIndex === ABAPCDSParser.RULE_data_source
      ) {
        const prefixLen = p.character - t.charPositionInLine
        collect(t.text?.substr(0, prefixLen))
      }
      // tslint:disable-next-line: no-console
      console.log(t.charPositionInLine)
      collect(`${t.text}`)
    }
  }
})
test("syntax completion suggestions 2", async () => {
  const source = sampleview
  const cursor: Position = { line: 6, character: 47 } // data_source, e070
  // const cursor: Position = { line: 6, character: 64 } // data_source, e070
  // const source = `define view ZAPIDUMMY_datadef kkk select from e070`
  // const cursor: Position = { line: 0, character: 32 } // syntax error
  const suggestions: string[] = []
  const parserListener = createPL(s => suggestions.push(s), cursor)
  const result = parseCDS(source, {
    errorListener: suggestionCollector(s => suggestions.push(s), cursor),
    parserListener
  })
  expect(result).toBeDefined()
  expect(suggestions.find(x => x === "as")).toBeTruthy()
  expect(suggestions.find(x => x === "with")).toBeTruthy()
})

test("syntax completion suggestions keywords", async () => {
  const source = `define view ZAPIDUMMY_datadef kkk select from e070`
  const cursor: Position = { line: 0, character: 30 } // syntax error
  const suggestions: string[] = []
  const parserListener = createPL(s => suggestions.push(s), cursor)
  const result = parseCDS(source, {
    errorListener: suggestionCollector(s => suggestions.push(s), cursor),
    parserListener
  })
  expect(result).toBeDefined()
  expect(suggestions.find(x => x === "as")).toBeTruthy()
  expect(suggestions.find(x => x === "with")).toBeTruthy()
})
