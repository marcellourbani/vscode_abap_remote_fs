import * as vscode from "vscode"
import { ADTSCHEME } from "../adt/conections"

// Strip ABAP inline comments (after an unquoted ")
function stripComment(line: string): string {
  const idx = line.indexOf('"')
  return idx >= 0 ? line.slice(0, idx) : line
}

type ChainKeyword =
  | "DATA"
  | "CLASS-DATA"
  | "STATICS"
  | "TYPES"
  | "CONSTANTS"
  | "FIELD-SYMBOLS"
  | "METHODS"
  | "CLASS-METHODS"

// Keywords that appear in method parameter specs – not method names
const METHOD_SPEC_KEYWORDS = new Set([
  "IMPORTING", "EXPORTING", "CHANGING", "RAISING", "EXCEPTIONS",
  "RETURNING", "TYPE", "LIKE", "OPTIONAL", "DEFAULT", "VALUE",
  "PREFERRED", "PARAMETER", "ABSTRACT", "FINAL", "REDEFINITION",
  "FOR", "TESTING", "AMDP", "BY", "DATABASE", "PROCEDURE"
])

function kindForChain(kw: ChainKeyword): vscode.SymbolKind {
  switch (kw) {
    case "TYPES":
      return vscode.SymbolKind.TypeParameter
    case "CONSTANTS":
      return vscode.SymbolKind.Constant
    case "CLASS-DATA":
      return vscode.SymbolKind.Field
    case "METHODS":
    case "CLASS-METHODS":
      return vscode.SymbolKind.Method
    default:
      return vscode.SymbolKind.Variable
  }
}

function addToScope(
  sym: vscode.DocumentSymbol,
  stack: vscode.DocumentSymbol[],
  root: vscode.DocumentSymbol[]
): void {
  if (stack.length > 0) stack[stack.length - 1].children.push(sym)
  else root.push(sym)
}

function findAncestorScope(
  stack: vscode.DocumentSymbol[],
  predicate: (symbol: vscode.DocumentSymbol) => boolean
) {
  for (let idx = stack.length - 1; idx >= 0; idx--) {
    const symbol = stack[idx]
    if (predicate(symbol)) return symbol
  }
}

function findMethodSymbol(scope: vscode.DocumentSymbol, methodName: string): vscode.DocumentSymbol | undefined {
  const wanted = methodName.toLowerCase()
  for (const child of scope.children) {
    if (child.kind === vscode.SymbolKind.Method && child.name.toLowerCase() === wanted) return child
    const nested = findMethodSymbol(child, methodName)
    if (nested) return nested
  }
}

// Details used to identify section sub-scopes inside a class
const SECTION_DETAILS = new Set(["public section", "private section", "protected section"])

export function parseAbapDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
  const root: vscode.DocumentSymbol[] = []
  const scopeStack: vscode.DocumentSymbol[] = []
  let chainKind: ChainKeyword | null = null
  let structDepth = 0
  // When in a METHODS/CLASS-METHODS chain: true means the next identifier is a method name
  let methodNameNext = false
  const lineCount = document.lineCount

  // Process one line's worth of text while inside a METHODS/CLASS-METHODS chain.
  // Returns the updated methodNameNext flag (whether a name is expected on the NEXT line).
  function processMethodsChunk(text: string, expectName: boolean, lineIdx: number): boolean {
    let remaining = text.trimStart()
    let expect = expectName
    while (remaining.length > 0) {
      const ci = remaining.indexOf(",")
      const segment = (ci >= 0 ? remaining.slice(0, ci) : remaining).trimStart()
      remaining = ci >= 0 ? remaining.slice(ci + 1).trimStart() : ""
      if (expect) {
        const nm = /^([\w\/~$]+)/.exec(segment)
        if (nm && !METHOD_SPEC_KEYWORDS.has(nm[1].toUpperCase())) {
          addDeclaration(nm[1], vscode.SymbolKind.Method, chainKind!, lineIdx)
          expect = false
        }
        // spec keyword while expecting name: keep expect=true (e.g. ABSTRACT before name)
      }
      if (ci >= 0) expect = true  // comma found → next segment starts a new method name
    }
    return expect
  }
  // Track merged class scopes: name (lower) → symbol
  const classScopes = new Map<string, vscode.DocumentSymbol>()
  // Classes whose DEFINITION has closed but IMPLEMENTATION not yet opened
  const awaitingImpl = new Set<string>()
  const reusedImplementationScopes = new Set<vscode.DocumentSymbol>()

  function openScope(name: string, kind: vscode.SymbolKind, detail: string, lineIdx: number) {
    const lineText = document.lineAt(lineIdx).text
    const pos = new vscode.Position(lineIdx, 0)
    const range = new vscode.Range(lineIdx, 0, lineIdx, lineText.length)
    const sym = new vscode.DocumentSymbol(name, detail, kind, range, range)
    addToScope(sym, scopeStack, root)
    scopeStack.push(sym)
    chainKind = null
  }

  function closeScope(lineIdx: number) {
    const sym = scopeStack.pop()
    if (sym) {
      reusedImplementationScopes.delete(sym)
      const lineText = document.lineAt(lineIdx).text
      sym.range = new vscode.Range(sym.range.start, new vscode.Position(lineIdx, lineText.length))
    }
  }

  function addDeclaration(
    name: string,
    kind: vscode.SymbolKind,
    detail: string,
    lineIdx: number
  ) {
    if (structDepth > 0) return
    const lineText = document.lineAt(lineIdx).text
    const range = new vscode.Range(lineIdx, 0, lineIdx, lineText.length)
    const sym = new vscode.DocumentSymbol(name, detail, kind, range, range)
    addToScope(sym, scopeStack, root)
  }

  for (let i = 0; i < lineCount; i++) {
    const rawLine = document.lineAt(i).text

    // Skip full-line comments (* in first column or leading whitespace)
    if (/^\s*\*/.test(rawLine)) continue

    const trimmed = stripComment(rawLine).trim()
    if (!trimmed) continue

    // Scope-closing keywords always exit chain mode first so their scope handler can run
    if (
      chainKind !== null &&
      /^(ENDFORM|ENDFUNCTION|ENDMODULE|ENDCLASS|ENDMETHOD|ENDINTERFACE)\b/i.test(trimmed)
    ) {
      chainKind = null
      methodNameNext = false
      structDepth = 0
    }

    // ── IN CHAIN MODE ──────────────────────────────────────────────────────
    if (chainKind !== null) {
      const endsWithDot = trimmed.endsWith(".")

      // ── METHODS / CLASS-METHODS chain ──
      if (chainKind === "METHODS" || chainKind === "CLASS-METHODS") {
        methodNameNext = processMethodsChunk(trimmed, methodNameNext, i)
        if (endsWithDot) { chainKind = null; methodNameNext = false }
        continue
      }

      // ── DATA / TYPES / CONSTANTS / FIELD-SYMBOLS chain ──
      if (/\bBEGIN\s+OF\b/i.test(trimmed)) {
        if (structDepth === 0) {
          const sm = /\bBEGIN\s+OF\s+([\w\/]+)/i.exec(trimmed)
          if (sm) addDeclaration(sm[1], vscode.SymbolKind.Struct, "structure", i)
        }
        structDepth++
      } else if (/\bEND\s+OF\b/i.test(trimmed)) {
        if (structDepth > 0) structDepth--
      } else if (structDepth === 0) {
        // Extract chain continuation variable name
        const contFS = /^<([\w\/]+)>\s+(?:TYPE\b|LIKE\b)/i.exec(trimmed)
        const contMain = /^([\w\/]+)\s+(?:TYPE\b|LIKE\b|VALUE\b)/i.exec(trimmed)
        if (contFS) {
          addDeclaration(contFS[1], vscode.SymbolKind.Field, "FIELD-SYMBOLS", i)
        } else if (contMain) {
          addDeclaration(contMain[1], kindForChain(chainKind), chainKind, i)
        }
      }

      if (endsWithDot && structDepth === 0) {
        chainKind = null
      }
      continue
    }

    // ── NORMAL PARSING ─────────────────────────────────────────────────────
    let m: RegExpExecArray | null

    // --- Scope closers
    if (/^ENDFORM\b/i.test(trimmed)) {
      closeScope(i)
      continue
    }
    if (/^ENDFUNCTION\b/i.test(trimmed)) {
      closeScope(i)
      continue
    }
    if (/^ENDMODULE\b/i.test(trimmed)) {
      closeScope(i)
      continue
    }
    if (/^ENDCLASS\b/i.test(trimmed)) {
      // Close any open section sub-scope first
      if (scopeStack.length > 0 && SECTION_DETAILS.has(scopeStack[scopeStack.length - 1].detail)) {
        closeScope(i)
      }
      // The class scope is now on top
      const classTop = scopeStack[scopeStack.length - 1]
      const classKey = classTop ? classTop.name.toLowerCase() : ""
      if (awaitingImpl.has(classKey)) {
        // Closing IMPLEMENTATION – fully done
        classScopes.delete(classKey)
        awaitingImpl.delete(classKey)
        closeScope(i)
      } else {
        // Closing DEFINITION – keep the scope open for IMPLEMENTATION to reuse
        closeScope(i)
        awaitingImpl.add(classKey)
      }
      continue
    }
    if (/^ENDMETHOD\b/i.test(trimmed)) {
      closeScope(i)
      continue
    }
    if (/^ENDINTERFACE\b/i.test(trimmed)) {
      // Close any open section sub-scope first
      if (scopeStack.length > 0 && SECTION_DETAILS.has(scopeStack[scopeStack.length - 1].detail)) {
        closeScope(i)
      }
      closeScope(i)
      continue
    }

    // --- Scope openers
    if ((m = /^\s*FORM\s+([\w$\/]+)/i.exec(rawLine))) {
      openScope(m[1].toUpperCase(), vscode.SymbolKind.Function, "FORM", i)
      continue
    }
    if ((m = /^\s*FUNCTION\s+([\w$\/]+)/i.exec(rawLine))) {
      openScope(m[1].toUpperCase(), vscode.SymbolKind.Function, "FUNCTION MODULE", i)
      continue
    }
    if ((m = /^\s*MODULE\s+([\w$\/]+)/i.exec(rawLine))) {
      openScope(m[1].toUpperCase(), vscode.SymbolKind.Function, "MODULE", i)
      continue
    }
    if ((m = /^\s*CLASS\s+([\w$\/]+)\s+DEFINITION/i.exec(rawLine))) {
      const key = m[1].toLowerCase()
      openScope(m[1], vscode.SymbolKind.Class, "CLASS", i)
      classScopes.set(key, scopeStack[scopeStack.length - 1])
      continue
    }
    if ((m = /^\s*CLASS\s+([\w$\/]+)\s+IMPLEMENTATION/i.exec(rawLine))) {
      const key = m[1].toLowerCase()
      const existing = awaitingImpl.has(key) ? classScopes.get(key) : undefined
      if (existing) {
        // Reuse the definition scope
        scopeStack.push(existing)
        chainKind = null
      } else {
        openScope(m[1], vscode.SymbolKind.Class, "CLASS", i)
        classScopes.set(key, scopeStack[scopeStack.length - 1])
      }
      continue
    }
    // PUBLIC / PRIVATE / PROTECTED SECTION (inside class)
    if (/^\s*PUBLIC\s+SECTION\b/i.test(rawLine)) {
      if (scopeStack.length > 0 && SECTION_DETAILS.has(scopeStack[scopeStack.length - 1].detail)) {
        closeScope(i)
      }
      openScope("Public", vscode.SymbolKind.Namespace, "public section", i)
      continue
    }
    if (/^\s*PRIVATE\s+SECTION\b/i.test(rawLine)) {
      if (scopeStack.length > 0 && SECTION_DETAILS.has(scopeStack[scopeStack.length - 1].detail)) {
        closeScope(i)
      }
      openScope("Private", vscode.SymbolKind.Namespace, "private section", i)
      continue
    }
    if (/^\s*PROTECTED\s+SECTION\b/i.test(rawLine)) {
      if (scopeStack.length > 0 && SECTION_DETAILS.has(scopeStack[scopeStack.length - 1].detail)) {
        closeScope(i)
      }
      openScope("Protected", vscode.SymbolKind.Namespace, "protected section", i)
      continue
    }
    // METHOD implementation opener – must NOT match METHODS (declaration keyword)
    if ((m = /^\s*METHOD\s+((?!S\b)[\w$\/~]+)/i.exec(rawLine))) {
      const classScope = findAncestorScope(scopeStack, s => s.kind === vscode.SymbolKind.Class)
      const declaredMethod = classScope && findMethodSymbol(classScope, m[1])
      if (declaredMethod) {
        scopeStack.push(declaredMethod)
        reusedImplementationScopes.add(declaredMethod)
        chainKind = null
      } else {
        openScope(m[1], vscode.SymbolKind.Method, "METHOD", i)
      }
      continue
    }
    // INTERFACE (standalone definition only – INTERFACES as a class statement has a trailing S)
    if ((m = /^\s*INTERFACE\s+([\w$\/]+)/i.exec(rawLine)) && !/^\s*INTERFACES\s+/i.test(rawLine)) {
      openScope(m[1], vscode.SymbolKind.Interface, "INTERFACE", i)
      continue
    }

    // --- METHODS / CLASS-METHODS chain or single declaration
    if ((m = /^\s*(CLASS-METHODS|METHODS)\s*:/i.exec(rawLine))) {
      const kw = m[1].toUpperCase() as ChainKeyword
      chainKind = kw
      // Use the comment-stripped trimmed to find the colon position
      const colonIdx = trimmed.indexOf(":")
      const rest = colonIdx >= 0 ? trimmed.slice(colonIdx + 1) : ""
      methodNameNext = processMethodsChunk(rest, true, i)
      if (trimmed.endsWith(".")) { chainKind = null; methodNameNext = false }
      continue
    }
    if ((m = /^\s*(CLASS-METHODS|METHODS)\s+([\w\/]+)/i.exec(rawLine)) &&
        !/^\s*(CLASS-METHODS|METHODS)\s*:/i.test(rawLine)) {
      const kw = m[1].toUpperCase() as ChainKeyword
      addDeclaration(m[2], vscode.SymbolKind.Method, kw, i)
      if (!trimmed.endsWith(".")) {
        chainKind = kw
        methodNameNext = false
      }
      continue
    }

    // --- Colon-chain declarations: DATA: / CLASS-DATA: / STATICS: / TYPES: / CONSTANTS: / FIELD-SYMBOLS:
    if ((m = /^\s*(DATA|CLASS-DATA|STATICS)\s*:/i.exec(rawLine))) {
      const kw = m[1].toUpperCase() as ChainKeyword
      const rest = rawLine.slice(m[0].length).trim()
      chainKind = kw
      if (/^\s*BEGIN\s+OF\b/i.test(rest)) {
        const sm = /^\s*BEGIN\s+OF\s+([\w\/]+)/i.exec(rest)
        if (sm) addDeclaration(sm[1], vscode.SymbolKind.Struct, "structure", i)
        structDepth++
      } else {
        const ffv = /^<([\w\/]+)>\s+(?:TYPE\b|LIKE\b)/i.exec(rest)
        const fv = /^([\w\/]+)\s+(?:TYPE\b|LIKE\b|VALUE\b)/i.exec(rest)
        if (ffv) addDeclaration(ffv[1], vscode.SymbolKind.Field, "FIELD-SYMBOLS", i)
        else if (fv) addDeclaration(fv[1], kindForChain(kw), kw, i)
      }
      if (trimmed.endsWith(".") && structDepth === 0) chainKind = null
      continue
    }

    if ((m = /^\s*TYPES\s*:/i.exec(rawLine))) {
      chainKind = "TYPES"
      const rest = rawLine.slice(m[0].length).trim()
      if (/^\s*BEGIN\s+OF\b/i.test(rest)) {
        const sm = /^\s*BEGIN\s+OF\s+([\w\/]+)/i.exec(rest)
        if (sm) addDeclaration(sm[1], vscode.SymbolKind.Struct, "type structure", i)
        structDepth++
      } else {
        const fv = /^([\w\/]+)\s+(?:TYPE\b|LIKE\b)/i.exec(rest)
        if (fv) addDeclaration(fv[1], vscode.SymbolKind.TypeParameter, "TYPES", i)
      }
      if (trimmed.endsWith(".") && structDepth === 0) chainKind = null
      continue
    }

    if ((m = /^\s*CONSTANTS\s*:/i.exec(rawLine))) {
      chainKind = "CONSTANTS"
      const rest = rawLine.slice(m[0].length).trim()
      const fv = /^([\w\/]+)\s+(?:TYPE\b|LIKE\b|VALUE\b)/i.exec(rest)
      if (fv) addDeclaration(fv[1], vscode.SymbolKind.Constant, "CONSTANTS", i)
      if (trimmed.endsWith(".") && structDepth === 0) chainKind = null
      continue
    }

    if ((m = /^\s*FIELD-SYMBOLS\s*:/i.exec(rawLine))) {
      chainKind = "FIELD-SYMBOLS"
      const rest = rawLine.slice(m[0].length).trim()
      const fv = /^<([\w\/]+)>\s+(?:TYPE\b|LIKE\b)/i.exec(rest)
      if (fv) addDeclaration(fv[1], vscode.SymbolKind.Field, "FIELD-SYMBOLS", i)
      if (trimmed.endsWith(".") && structDepth === 0) chainKind = null
      continue
    }

    // --- Single-name declarations (no colon chain)
    if ((m = /^\s*(DATA|STATICS)\s+([\w\/]+)\s*/i.exec(rawLine))) {
      if (/\bBEGIN\s+OF\b/i.test(rawLine)) {
        const sm = /\bBEGIN\s+OF\s+([\w\/]+)/i.exec(rawLine)
        if (sm) addDeclaration(sm[1], vscode.SymbolKind.Struct, "structure", i)
      } else {
        addDeclaration(m[2], vscode.SymbolKind.Variable, m[1].toUpperCase(), i)
      }
      continue
    }

    if ((m = /^\s*CLASS-DATA\s+([\w\/]+)\s*/i.exec(rawLine))) {
      if (/\bBEGIN\s+OF\b/i.test(rawLine)) {
        const sm = /\bBEGIN\s+OF\s+([\w\/]+)/i.exec(rawLine)
        if (sm) addDeclaration(sm[1], vscode.SymbolKind.Struct, "CLASS-DATA structure", i)
      } else {
        addDeclaration(m[1], vscode.SymbolKind.Field, "CLASS-DATA", i)
      }
      continue
    }

    if ((m = /^\s*TYPES\s+([\w\/]+)\s*/i.exec(rawLine))) {
      if (/\bBEGIN\s+OF\b/i.test(rawLine)) {
        const sm = /\bBEGIN\s+OF\s+([\w\/]+)/i.exec(rawLine)
        if (sm) addDeclaration(sm[1], vscode.SymbolKind.Struct, "type structure", i)
      } else {
        addDeclaration(m[1], vscode.SymbolKind.TypeParameter, "TYPES", i)
      }
      continue
    }

    if ((m = /^\s*CONSTANTS\s+([\w\/]+)\s+/i.exec(rawLine))) {
      addDeclaration(m[1], vscode.SymbolKind.Constant, "CONSTANTS", i)
      continue
    }

    if ((m = /^\s*FIELD-SYMBOLS\s+<([\w\/]+)>/i.exec(rawLine))) {
      addDeclaration(m[1], vscode.SymbolKind.Field, "FIELD-SYMBOLS", i)
      continue
    }

    // --- Selection-screen declarations
    if ((m = /^\s*PARAMETERS\s+([\w\/]+)\b/i.exec(rawLine))) {
      addDeclaration(m[1], vscode.SymbolKind.Variable, "PARAMETERS", i)
      continue
    }
    if ((m = /^\s*SELECT-OPTIONS\s+([\w\/]+)\b/i.exec(rawLine))) {
      addDeclaration(m[1], vscode.SymbolKind.Variable, "SELECT-OPTIONS", i)
      continue
    }
    if ((m = /^\s*TABLES\s+([\w\/]+)\b/i.exec(rawLine))) {
      addDeclaration(m[1], vscode.SymbolKind.Variable, "TABLES", i)
      continue
    }

    // --- Inline DATA(var) declarations (ABAP 7.4+)
    // Runs only when no keyword was matched above (no `continue` was hit)
    const inlineRe = /\bDATA\s*\(\s*([\w\/]+)\s*\)/gi
    let inlineMatch: RegExpExecArray | null
    while ((inlineMatch = inlineRe.exec(rawLine)) !== null) {
      addDeclaration(inlineMatch[1], vscode.SymbolKind.Variable, "inline data", i)
    }
  }

  // Close any unclosed scopes (e.g., incomplete/truncated files)
  while (scopeStack.length > 0) closeScope(lineCount - 1)

  return root
}

export class AbapDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    if (document.uri.scheme !== ADTSCHEME) return []
    if (document.languageId !== "abap") return []

    // CLASS and INTF objects are handled by the language server via classComponents API
    const uriPath = document.uri.path.toLowerCase()
    if (uriPath.includes("/oo/classes/") || uriPath.includes("/oo/interfaces/")) return []

    return parseAbapDocumentSymbols(document)
  }
}
