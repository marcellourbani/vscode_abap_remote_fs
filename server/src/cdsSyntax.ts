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

export const isRuleContext = (tree: ParseTree): tree is ParserRuleContext => !!(tree as any).start

export const isTerminal = (tree: ParseTree): tree is TerminalNode => !!(tree as any).symbol

export const terminalType = (t: ParseTree) => isTerminal(t) && t.symbol.type

export const vscPosition = (line: number, character: number): Position => ({
  line: line - 1,
  character
})

const tokenStartPosition = (t: Token): Position => vscPosition(t.line, t.charPositionInLine)

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

export function findNode(ctx: ParserRuleContext, pos: Position): ParserRuleContext | undefined {
  if (positionInContext(ctx, pos))
    if (ctx.children) {
      const child = ctx.children.filter(isRuleContext).find(c => positionInContext(c, pos))
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
          if (ctx.ruleIndex === ABAPCDSParser.RULE_data_source && ctx.start.text)
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

export type CdsNavTarget =
  | { kind: "source"; name: string }        // table/view name (data source)
  | { kind: "field"; source: string; field: string }  // alias.field → resolved source.field
  | { kind: "association"; name: string }    // association target
  | { kind: "dataElement"; name: string }    // data element in CAST
  | { kind: "unknown"; word: string }        // fallback - just the word

interface AliasMap { [alias: string]: string }

function buildAliasMap(tree: ParserRuleContext): AliasMap {
  const map: AliasMap = {}
  const walk = (ctx: ParserRuleContext) => {
    if (ctx.ruleIndex === ABAPCDSParser.RULE_data_source) {
      // data_source: IDENTIFIER data_source_parameters? (AS? alias)? join*
      const children = ctx.children || []
      const ids = children.filter(isTerminal).filter(t => t.symbol.type === ABAPCDSLexer.IDENTIFIER)
      if (ids.length > 0) {
        const tableName = ids[0].text
        // find alias child rule
        const aliasCtx = (ctx.children || []).filter(isRuleContext).find(c => c.ruleIndex === ABAPCDSParser.RULE_alias)
        const aliasName = aliasCtx ? aliasCtx.text : tableName
        map[aliasName.toLowerCase()] = tableName
      }
    }
    for (const child of ctx.children || []) {
      if (isRuleContext(child)) walk(child)
    }
  }
  walk(tree)
  return map
}

function getWordAtPosition(source: string, pos: Position): string {
  const lines = source.split("\n")
  const line = lines[pos.line] || ""
  const before = line.substring(0, pos.character).match(/([\w\/]+)$/)
  const after = line.substring(pos.character).match(/^([\w\/]+)/)
  return (before ? before[1] : "") + (after ? after[1] : "")
}

function findParentRule(ctx: ParserRuleContext, pos: Position): ParserRuleContext | undefined {
  if (!positionInContext(ctx, pos)) return
  for (const child of ctx.children || []) {
    if (isRuleContext(child)) {
      const found = findParentRule(child, pos)
      if (found) return found
    }
  }
  return ctx
}

export function cdsNavigationTarget(source: string, pos: Position): CdsNavTarget | undefined {
  const word = getWordAtPosition(source, pos)
  if (!word) return

  try {
    const tree = parseCDS(source)
    const aliasMap = buildAliasMap(tree)

    // find the deepest rule containing the cursor
    const node = findParentRule(tree, pos)
    if (!node) return { kind: "unknown", word }

    // walk up from the node to find the semantic context
    let current: ParserRuleContext | undefined = node
    while (current) {
      switch (current.ruleIndex) {
        case ABAPCDSParser.RULE_data_source: {
          // cursor is on a data source name (table/view)
          const children = current.children || []
          const firstId = children.filter(isTerminal).find(t => t.symbol.type === ABAPCDSLexer.IDENTIFIER)
          if (firstId && positionInToken(pos, firstId.symbol)) {
            return { kind: "source", name: firstId.text }
          }
          break
        }
        case ABAPCDSParser.RULE_target: {
          // association target
          return { kind: "association", name: word }
        }
        case ABAPCDSParser.RULE_data_element: {
          return { kind: "dataElement", name: word }
        }
        case ABAPCDSParser.RULE_path_expr: {
          // path_expr: IDENTIFIER? path_association ('.' path_association)* ('.' IDENTIFIER)?
          // e.g. a071.matnr → alias=a071, field=matnr
          const text = current.text
          const parts = text.split(".")
          if (parts.length >= 2) {
            const alias = parts[0].toLowerCase()
            const resolvedSource = aliasMap[alias] || parts[0]
            // if cursor is on the alias part, navigate to the source
            const firstChild = (current.children || [])[0]
            if (isTerminal(firstChild) && positionInToken(pos, firstChild.symbol)) {
              return { kind: "source", name: resolvedSource }
            }
            // cursor is on a field part
            return { kind: "field", source: resolvedSource, field: parts.slice(1).join(".") }
          }
          break
        }
        case ABAPCDSParser.RULE_alias: {
          // alias after AS in field_rename or data_source — not a navigable object
          return undefined
        }
        case ABAPCDSParser.RULE_field:
        case ABAPCDSParser.RULE_case_operand:
        case ABAPCDSParser.RULE_arg: {
          // simple field reference - might be alias.field or just field
          // check if the word is an alias
          if (aliasMap[word.toLowerCase()]) {
            return { kind: "source", name: aliasMap[word.toLowerCase()] }
          }
          // it's a bare field name - try all sources
          const allSources = Object.values(aliasMap)
          if (allSources.length > 0) {
            return { kind: "field", source: allSources[0], field: word }
          }
          return { kind: "unknown", word }
        }
      }
      current = current.parent as ParserRuleContext | undefined
    }
  } catch (e) {
    // parse error - fall through to word-based lookup
  }

  return { kind: "unknown", word }
}

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

export function cdsDataSources(source: string): string[] {
  try {
    const tree = parseCDS(source)
    const map = buildAliasMap(tree)
    return [...new Set(Object.values(map))]
  } catch (e) {
    return []
  }
}
