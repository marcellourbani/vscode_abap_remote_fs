import { ABAPCDSLexer, ABAPCDSParser } from "abapcdsgrammar"
import {
  ANTLRInputStream,
  CommonTokenStream,
  ParserRuleContext,
  Token,
  ANTLRErrorListener,
  TokenSource,
  CommonToken
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

function inNode(ctx: ParserRuleContext, position: Position) {
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

export const createSourceDetector = (
  detect: (s: string) => void
): ParseTreeListener => ({
  exitEveryRule: ctx => {
    if (ctx.ruleIndex === ABAPCDSParser.RULE_data_source) {
      const c = ctx.children && ctx.children[0]
      if (c && terminalType(c) === ABAPCDSParser.IDENTIFIER) detect(c.text)
    }
  }
})

export const BADTOKEN = -10
export const createFakeTokenInjector = (
  p: Position,
  notifier?: (t: Token) => void
) => (ts: TokenSource): TokenSource => {
  const source = { ...ts }
  source.nextToken = () => {
    const t = ts.nextToken()

    if (positionInToken(p, t)) {
      if (notifier) notifier(t)
      const nt = new CommonToken(BADTOKEN, t.text)
      nt.channel = t.channel
      nt.line = t.line
      nt.charPositionInLine = t.charPositionInLine
      nt.startIndex = t.startIndex
      nt.stopIndex = t.stopIndex
      return nt
    }
    return t
  }
  return source
}

export function findNode(
  ctx: ParserRuleContext,
  pos: Position
): ParserRuleContext | undefined {
  if (inNode(ctx, pos))
    if (ctx.children) {
      const child = ctx.children.filter(isRuleContext).find(c => inNode(c, pos))
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
