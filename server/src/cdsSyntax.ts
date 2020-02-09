import { ABAPCDSLexer, ABAPCDSParser } from "abapcdsgrammar"
import {
  ANTLRInputStream,
  CommonTokenStream,
  ParserRuleContext,
  Token,
  ANTLRErrorListener,
  RecognitionException
} from "antlr4ts"
import { ParseTree, ParseTreeListener, TerminalNode } from "antlr4ts/tree"
import { Position } from "vscode-languageserver"

interface SyntaxError {
  position: Position
  offendingSymbol?: Token
  message: string
  error?: RecognitionException
}

export const isRuleContext = (tree: ParseTree): tree is ParserRuleContext =>
  !!(tree as any).start

export const isTerminal = (tree: ParseTree): tree is TerminalNode =>
  !!(tree as any).symbol

export const terminalType = (t: ParseTree) => isTerminal(t) && t.symbol.type

const tokenStartPosition = (t: Token): Position => ({
  line: t.line - 1,
  character: t.charPositionInLine + 1
})

const tokenStopPosition = (t: Token): Position => ({
  line: t.line - 1,
  character: t.stopIndex - t.startIndex + t.charPositionInLine + 1
})

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
const createSyntaxErrorListener = (
  errors: SyntaxError[]
): ANTLRErrorListener<Token> => ({
  syntaxError: (recognizer, offendingSymbol, line, character, message, error) =>
    errors.push({
      position: { line: line - 1, character: character + 1 },
      message,
      error,
      offendingSymbol
    })
})

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

export function parseCDS(source: string, listener?: ParseTreeListener) {
  const inputStream = new ANTLRInputStream(source)
  const lexer = new ABAPCDSLexer(inputStream)
  const tokenStream = new CommonTokenStream(lexer)
  const parser = new ABAPCDSParser(tokenStream)
  const errors: SyntaxError[] = []
  parser.addErrorListener(createSyntaxErrorListener(errors))
  if (listener) parser.addParseListener(listener)

  return {
    tree: parser.cdsddl(),
    errors
  }
}

export function parseCDSWithDataSources(source: string) {
  const sources: string[] = []
  const listener: ParseTreeListener = {
    exitEveryRule: ctx => {
      if (ctx.ruleIndex === ABAPCDSParser.RULE_data_source) {
        const c = ctx.children && ctx.children[0]
        if (c && terminalType(c) === ABAPCDSParser.IDENTIFIER)
          sources.push(c.text)
      }
    }
  }
  const result = parseCDS(source, listener)
  return { ...result, sources }
}
