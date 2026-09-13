// Codemod: repair mechanical type errors in vitest test files that surfaced
// after the Jest -> Vitest / ESM migration.
//
// DIAGNOSTIC-DRIVEN: runs `tsc -p tsconfig.test.json` and only edits what the
// compiler flags, in these categories:
//   A. TS2304 for vitest type helpers (Mock, Mocked, MockedFunction, ...) used
//      but never imported -> add `import type { ... } from "vitest"`.
//   B. TS1484 (verbatimModuleSyntax): a value import carries a type specifier.
//      If EVERY named specifier is a type (and there is no default/namespace),
//      convert the whole import to `import type { ... }` so the module is fully
//      elided (no runtime side-effect load). Otherwise qualify the individual
//      type specifiers inline as `type X` (the module is already loaded for its
//      value specifiers, so no extra load is introduced).
//   C. TS2304 `fail` (jest global, absent in vitest) -> `throw new Error(...)`.
//   D. TS2554 on `vi.mock(path, factory, { virtual })` -> drop the jest-only
//      3rd argument.
//
// B/D use the TypeScript AST for precision; A/C are line-targeted. The tsc/fix
// loop repeats until these categories stop appearing.

import { execSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import ts from "typescript"

const VITEST_TYPES = new Set([
  "Mock",
  "Mocked",
  "MockedClass",
  "MockedFunction",
  "MockedObject",
  "MockInstance",
  "MockedObjectDeep",
  "MockedFunctionDeep"
])

/** Run tsc and return parsed diagnostics: { file, line, col, code, msg, name? }. */
function collectDiagnostics() {
  let out = ""
  try {
    out = execSync("npx tsc -p tsconfig.test.json --noEmit --pretty false", {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024
    })
  } catch (e) {
    out = `${e.stdout || ""}${e.stderr || ""}`
  }
  const diags = []
  const re = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/
  for (const raw of out.split("\n")) {
    const m = re.exec(raw.trim())
    if (!m) continue
    const [, file, ln, col, code, msg] = m
    diags.push({
      file,
      line: Number(ln),
      col: Number(col),
      code,
      msg,
      name: /'([^']+)'/.exec(msg)?.[1]
    })
  }
  return diags
}

/** Apply {start,end,text} edits (end exclusive) in reverse order. */
function applyEdits(text, edits) {
  edits.sort((a, b) => b.start - a.start || b.end - a.end)
  let out = text
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return out
}

/** A: insert vitest type-helper import, merging into an existing vitest import. */
function addVitestTypeImport(sf, names) {
  const wanted = [...names]
  let target = null
  for (const st of sf.statements) {
    if (
      ts.isImportDeclaration(st) &&
      ts.isStringLiteral(st.moduleSpecifier) &&
      st.moduleSpecifier.text === "vitest" &&
      st.importClause?.namedBindings &&
      ts.isNamedImports(st.importClause.namedBindings)
    ) {
      target = st
      break
    }
  }
  if (target) {
    const clause = target.importClause
    const named = clause.namedBindings
    const existing = new Set(named.elements.map(el => el.name.text))
    const missing = wanted.filter(n => !existing.has(n))
    if (missing.length === 0) return null
    const insertText = missing.map(n => (clause.isTypeOnly ? n : `type ${n}`)).join(", ")
    const last = named.elements[named.elements.length - 1]
    return { start: last.getEnd(), end: last.getEnd(), text: `, ${insertText}` }
  }
  let insertPos = 0
  for (const st of sf.statements) if (ts.isImportDeclaration(st)) insertPos = st.getEnd()
  const line = `import type { ${wanted.join(", ")} } from "vitest"`
  return insertPos === 0
    ? { start: 0, end: 0, text: `${line}\n` }
    : { start: insertPos, end: insertPos, text: `\n${line}` }
}

/** B: convert TS1484-flagged specifiers to type-only, whole-import when possible. */
function fixTypeOnlyImports(sf, ts1484, edits) {
  if (!ts1484.length) return false
  const flagged = new Set(ts1484.map(d => `${d.line}:${d.name}`))
  let changed = false
  for (const st of sf.statements) {
    if (
      !ts.isImportDeclaration(st) ||
      !st.importClause ||
      st.importClause.isTypeOnly ||
      !st.importClause.namedBindings ||
      !ts.isNamedImports(st.importClause.namedBindings)
    )
      continue
    const clause = st.importClause
    const elements = clause.namedBindings.elements
    const isFlagged = el =>
      flagged.has(`${sf.getLineAndCharacterOfPosition(el.getStart()).line + 1}:${el.name.text}`)
    const flaggedEls = elements.filter(isFlagged)
    if (flaggedEls.length === 0) continue
    const allNamedFlagged = elements.every(isFlagged)
    if (allNamedFlagged && !clause.name) {
      // Whole import is type-only -> `import type { ... }` (fully elided).
      const bindingsStart = clause.namedBindings.getStart()
      edits.push({ start: bindingsStart, end: bindingsStart, text: "type " })
      changed = true
    } else {
      // Mixed: qualify each flagged specifier inline.
      for (const el of flaggedEls) {
        if (!el.isTypeOnly) {
          edits.push({ start: el.getStart(), end: el.getStart(), text: "type " })
          changed = true
        }
      }
    }
  }
  return changed
}

function fixFile(file, diags) {
  const text = readFileSync(file, "utf8")
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const edits = []
  let changed = false

  // A. vitest type-helper imports.
  const neededTypes = new Set()
  for (const d of diags)
    if (d.code === "TS2304" && d.name && VITEST_TYPES.has(d.name)) neededTypes.add(d.name)
  if (neededTypes.size) {
    const edit = addVitestTypeImport(sf, neededTypes)
    if (edit) {
      edits.push(edit)
      changed = true
    }
  }

  // B. TS1484 type-only imports.
  if (
    fixTypeOnlyImports(
      sf,
      diags.filter(d => d.code === "TS1484" && d.name),
      edits
    )
  )
    changed = true

  // C. fail("msg") -> throw new Error("msg").
  const failLines = new Set(
    diags.filter(d => d.code === "TS2304" && d.name === "fail").map(d => d.line)
  )
  if (failLines.size) {
    const orig = text.split("\n")
    let offset = 0
    for (let i = 0; i < orig.length; i++) {
      const lineStart = offset
      offset += orig[i].length + 1
      if (failLines.has(i + 1) && orig[i].includes("fail(")) {
        edits.push({
          start: lineStart,
          end: lineStart + orig[i].length,
          text: orig[i].replace(/\bfail\(/g, "throw new Error(")
        })
        changed = true
      }
    }
  }

  // D. vi.mock(path, factory, {...}) -> drop 3rd arg.
  const visitMock = node => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "vi" &&
      node.expression.name.text === "mock" &&
      node.arguments.length === 3
    ) {
      edits.push({ start: node.arguments[1].getEnd(), end: node.arguments[2].getEnd(), text: "" })
      changed = true
    }
    ts.forEachChild(node, visitMock)
  }
  visitMock(sf)

  if (!changed || edits.length === 0) return false
  writeFileSync(file, applyEdits(text, edits))
  return true
}

// ── main loop ────────────────────────────────────────────────────────────────
const MAX_ITERS = 6
for (let iter = 1; iter <= MAX_ITERS; iter++) {
  const diags = collectDiagnostics()
  const actionable = diags.filter(
    d =>
      (d.code === "TS2304" && d.name && (VITEST_TYPES.has(d.name) || d.name === "fail")) ||
      d.code === "TS1484" ||
      d.code === "TS2554"
  )
  const byFile = new Map()
  for (const d of diags) {
    if (!byFile.has(d.file)) byFile.set(d.file, [])
    byFile.get(d.file).push(d)
  }
  let touched = 0
  for (const file of byFile.keys()) if (fixFile(file, byFile.get(file))) touched++
  console.log(`iter ${iter}: ${actionable.length} actionable diags, touched ${touched} files`)
  if (actionable.length === 0 || touched === 0) break
}
console.log("done")
