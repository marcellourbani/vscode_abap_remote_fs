import { ABAPCDSLexer, ABAPCDSParser } from "abapcdsgrammar"
import {
  ANTLRInputStream,
  CommonTokenStream,
  ParserRuleContext,
  Token,
  ANTLRErrorListener,
  TokenSource
} from "antlr4ts"
import { ParseTree, ParseTreeListener, TerminalNode } from "antlr4ts/tree"
import { Position } from "vscode-languageserver"

export const isRuleContext = (tree: ParseTree): tree is ParserRuleContext =>
  !!(tree as any).start

export const isTerminal = (tree: ParseTree): tree is TerminalNode =>
  !!(tree as any).symbol

export const terminalType = (t: ParseTree) => isTerminal(t) && t.symbol.type

export const vscPosition = (line: number, character: number): Position => ({
  line: line - 1,
  character
})

const tokenStartPosition = (t: Token): Position =>
  vscPosition(t.line, t.charPositionInLine)

const tokenStopPosition = (t: Token): Position =>
  vscPosition(t.line, t.stopIndex - t.startIndex + t.charPositionInLine)

export const positionInToken = (p: Position, t: Token) => {
  const start = tokenStartPosition(t)
  const stop = tokenStopPosition(t)
  return (
    p.line === stop.line &&
    p.line === start.line &&
    p.character >= start.character &&
    p.character <= stop.character
  )
}

export function positionInContext(ctx: ParserRuleContext, position: Position) {
  const start = tokenStartPosition(ctx.start)
  const stop = tokenStopPosition(ctx.stop || ctx.start)

  if (start.line === stop.line)
    return (
      position.line === start.line &&
      position.character >= start.character &&
      position.character <= stop.character
    )
  if (start.line === position.line) return position.character >= start.character
  if (stop.line === position.line) return position.character <= stop.character
  return start.line < position.line && stop.line > position.line
}

export function findNode(
  ctx: ParserRuleContext,
  pos: Position
): ParserRuleContext | undefined {
  if (positionInContext(ctx, pos))
    if (ctx.children) {
      const child = ctx.children
        .filter(isRuleContext)
        .find(c => positionInContext(c, pos))
      const leaf = child && findNode(child, pos)
      return leaf || ctx
    } else return ctx
}

interface ParserConfig {
  tokenMiddleware?: (s: TokenSource) => TokenSource
  errorListener?: ANTLRErrorListener<Token>
  parserListener?: ParseTreeListener
}
export function parseCDS(source: string, config: ParserConfig = {}) {
  const { tokenMiddleware: mid, errorListener, parserListener } = config
  const inputStream = new ANTLRInputStream(source)
  const lexer = new ABAPCDSLexer(inputStream)

  const tokenStream = new CommonTokenStream(mid ? mid(lexer) : lexer)
  const parser = new ABAPCDSParser(tokenStream)
  if (errorListener) parser.addErrorListener(errorListener)
  if (parserListener) parser.addParseListener(parserListener)
  return parser.cdsddl()
}

const completionItemDetector = (
  notify: (ctx: ParserRuleContext, sources: string[]) => void
): ParseTreeListener => {
  const completionRules = new Set([
    ABAPCDSParser.RULE_data_source,
    ABAPCDSParser.RULE_field,
    ABAPCDSParser.RULE_case_operand
  ])
  let sources: string[] = []
  return {
    exitEveryRule: ctx => {
      if (completionRules.has(ctx.ruleIndex)) {
        if (ctx.start.type === ABAPCDSLexer.IDENTIFIER) {
          notify(ctx, sources)
          if (
            ctx.ruleIndex === ABAPCDSParser.RULE_data_source &&
            ctx.start.text
          )
            sources = [...sources, ctx.start.text]
        }
      }
      if (ctx.ruleIndex === ABAPCDSParser.RULE_view) sources = []
    }
  }
}

const sourceOrFieldCompletion = (
  cursor: Position,
  completeSource: (prefix: string) => void,
  completeField: (prefix: string, sources: string[]) => void
) => {
  const last = { line: cursor.line, character: cursor.character - 1 }
  return completionItemDetector((ctx, sources) => {
    if (positionInContext(ctx, last)) {
      const len = cursor.character - ctx.start.charPositionInLine
      if (ctx.ruleIndex === ABAPCDSParser.RULE_data_source) {
        if (len && ctx.start.text && positionInToken(last, ctx.start))
          completeSource(ctx.start.text.substr(0, len))
      } else if (len > 0) completeField(ctx.text.substr(0, len), sources)
    }
  })
}

export type MatchType = "NONE" | "FIELD" | "SOURCE"

export const cdsCompletionExtractor = (source: string, cursor: Position) => {
  const result = {
    prefix: "",
    sources: [] as string[],
    matched: "NONE" as MatchType
  }
  const parserListener = sourceOrFieldCompletion(
    cursor,
    prefix => {
      result.prefix = prefix
      result.matched = "SOURCE"
    },
    (prefix, src) => {
      result.prefix = prefix
      result.matched = "FIELD"
      result.sources = src
    }
  )
  parseCDS(source, { parserListener })
  return result
}
