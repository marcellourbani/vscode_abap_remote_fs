/* eslint-disable */
// Wrap top-level test variables that are referenced inside `vi.mock(...)`
// factories in `vi.hoisted(...)`. Vitest hoists every `vi.mock(...)` call to
// the very top of the file, but it does NOT hoist surrounding `const`/`let`
// declarations - so any factory that closes over a top-level variable
// throws "Cannot access X before initialization" at module init.
//
// The canonical vitest 5 fix is `vi.hoisted`: it relocates an arbitrary
// initializer to the same hoisted position as `vi.mock`, returning the
// computed value to a top-level destructured const.
//
// Strategy:
//   1. Collect every top-level VariableStatement (const X = ...) in the file
//      whose declared name is *referenced inside any vi.mock factory body*.
//   2. Group consecutive eligible statements into a single `vi.hoisted` block
//      (preserves init-order dependencies between them).
//   3. Replace the group with:
//        const { X, Y } = vi.hoisted(() => { /* original initializers */; return { X, Y } })
//   4. Move the result before any `vi.mock(...)` call (already at top level,
//      so insertion order is preserved by ts-morph).

import { Project, SyntaxKind, type Node } from "ts-morph"
import { writeFileSync } from "node:fs"

import { resolveProjectRoot } from "./lib/projectRoot"
const PROJECT_ROOT = resolveProjectRoot()

const project = new Project({
  skipAddingFilesFromTsConfig: true,
  compilerOptions: { allowJs: false, target: 99 }
})

const TEST_GLOBS = [
  "client/src/**/*.test.ts",
  "server/src/**/*.test.ts",
  "modules/abapfs/src/**/*.test.ts",
  "modules/abapObject/src/**/*.test.ts"
]
for (const g of TEST_GLOBS) project.addSourceFilesAtPaths(`${PROJECT_ROOT}/${g}`)

const stats = {
  filesScanned: 0,
  filesChanged: 0,
  varsHoisted: 0
}

for (const sf of project.getSourceFiles()) {
  stats.filesScanned++

  // 1. Collect top-level const declarations (ignore `let` / `var` — they're
  // typically state variables reassigned later, and wrapping them in a
  // `const { ... } = vi.hoisted(...)` would break reassignment).
  type TopVar = { name: string; node: Node; statement: Node }
  const topVars: TopVar[] = []
  for (const stmt of sf.getStatements()) {
    if (stmt.getKind() !== SyntaxKind.VariableStatement) continue
    const vs = stmt.asKindOrThrow(SyntaxKind.VariableStatement)
    const declList = vs.getDeclarationList()
    if (declList.getDeclarationKind() !== "const") continue
    for (const decl of vs.getDeclarations()) {
      const name = decl.getNameNode().getText()
      // Only simple identifiers (no destructured top-level)
      if (decl.getNameNode().getKind() === SyntaxKind.Identifier) {
        // Only declarations that have an initializer — otherwise nothing
        // to hoist in the first place.
        if (decl.getInitializer()) {
          topVars.push({ name, node: decl, statement: stmt })
        }
      }
    }
  }

  if (topVars.length === 0) continue

  // 2. For each top-level var, check whether it is referenced inside any
  // vi.mock(...) factory body in this same file.
  const referencedInMock = new Set<string>()
  sf.forEachDescendant(node => {
    if (node.getKind() !== SyntaxKind.CallExpression) return
    const call = node.asKindOrThrow(SyntaxKind.CallExpression)
    const callee = call.getExpression()
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) return
    const pae = callee.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
    if (pae.getExpression().getText() !== "vi") return
    if (pae.getName() !== "mock" && pae.getName() !== "doMock") return
    const args = call.getArguments()
    if (args.length < 2) return
    const factory = args[1]
    // Collect identifiers used inside the factory body
    factory.forEachDescendant(idNode => {
      if (idNode.getKind() !== SyntaxKind.Identifier) return
      const text = idNode.getText()
      // Skip identifiers that are themselves declarations (param names etc.)
      const parent = idNode.getParent()
      if (
        parent?.getKind() === SyntaxKind.PropertyAssignment &&
        parent.getFirstChildByKind(SyntaxKind.Identifier) === idNode
      ) {
        // It's the KEY in `key: value` shorthand - skip
        // Actually shorthand uses ShorthandPropertyAssignment, not PropertyAssignment.
        // PropertyAssignment with key=identifier is `key: ...`, the key is not a reference.
        return
      }
      if (parent?.getKind() === SyntaxKind.Parameter) return
      referencedInMock.add(text)
    })
  })

  // 3. Find which top-level vars need hoisting
  const hoistTargets = topVars.filter(v => referencedInMock.has(v.name))
  if (hoistTargets.length === 0) continue

  // Get the unique statements that contain hoist targets (a single statement
  // can declare multiple vars). Dedup while preserving source order.
  const seenStmt = new Set<Node>()
  const hoistStatements: Array<{ statement: Node; names: string[] }> = []
  for (const v of hoistTargets) {
    if (seenStmt.has(v.statement)) {
      const last = hoistStatements[hoistStatements.length - 1]
      if (last && last.statement === v.statement) last.names.push(v.name)
      continue
    }
    seenStmt.add(v.statement)
    hoistStatements.push({ statement: v.statement, names: [v.name] })
  }

  // 4. Group CONSECUTIVE statements: walk the file's top-level statements in
  // order, and group runs of statements that are in hoistStatements.
  const fileStmts = sf.getStatements()
  const groups: Array<{ statements: Node[]; names: string[] }> = []
  let currentGroup: { statements: Node[]; names: string[] } | undefined
  for (const stmt of fileStmts) {
    const found = hoistStatements.find(h => h.statement === stmt)
    if (found) {
      if (!currentGroup) {
        currentGroup = { statements: [], names: [] }
        groups.push(currentGroup)
      }
      currentGroup.statements.push(stmt)
      currentGroup.names.push(...found.names)
    } else {
      currentGroup = undefined
    }
  }

  if (groups.length === 0) continue

  // 5. Build the replacement. Each group becomes:
  //
  //   const { X, Y, Z } = vi.hoisted(() => {
  //     <original-statements-bodies>
  //     return { X, Y, Z }
  //   })
  //
  // Apply each group in REVERSE order to keep ranges valid.
  for (let gi = groups.length - 1; gi >= 0; gi--) {
    const group = groups[gi]
    const bodyText = group.statements.map(s => s.getText()).join("\n  ")
    const namesText = group.names.join(", ")
    const replacementText =
      `const { ${namesText} } = vi.hoisted(() => {\n  ` +
      bodyText +
      `\n  return { ${namesText} }\n})`

    // Replace the FIRST statement with the new combined block, remove the rest.
    const first = group.statements[0]
    first.replaceWithText(replacementText)
    for (let i = group.statements.length - 1; i >= 1; i--) {
      const s = group.statements[i]
      if (!s.wasForgotten()) s.remove()
    }
    stats.varsHoisted += group.names.length
  }

  sf.saveSync()
  stats.filesChanged++
}

writeFileSync("/tmp/hoisted-vars-report.json", JSON.stringify(stats, null, 2))

console.error(
  `\n=== HOIST TOP-LEVEL VARS REFERENCED IN vi.mock ===\nfiles scanned: ${stats.filesScanned}\nfiles changed: ${stats.filesChanged}\nvars wrapped in vi.hoisted: ${stats.varsHoisted}\n`
)
