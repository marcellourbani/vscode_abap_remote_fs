/* eslint-disable */
// Hoist `(await import("X"))` / `(await import("X")).Y` to top-level static
// imports when X is vi.mock'd in the same file. Vitest hoists vi.mock factories
// to the very top of the file, so a static `import` resolves to the mocked
// module just like `await import` does — without polluting every consuming
// function with `async`.
//
// This fixes a class of test-isolation bugs introduced by mechanically
// converting jest's `const { X } = require("./Y")` pattern to vitest's
// `const { X } = (await import("./Y"))`: every enclosing function becomes
// async, and tests that fire-and-forget those functions race the assignment.
//
// Strategy:
//   1. Collect every module path that is vi.mock("X")'d at the top level.
//   2. For each such path, find inline `(await import("X"))[.member]` uses.
//   3. Add a single top-level `import * as __mock_<sanitized> from "X"`.
//   4. Replace each inline use with the hoisted binding.
//   5. After the rewrite pass, walk async functions whose bodies contain no
//      remaining `await` expressions and drop the async keyword (so unawaited
//      calls regain their original synchronous behavior).

import {
  Project,
  SyntaxKind,
  Node,
  type ArrowFunction,
  type FunctionExpression,
  type FunctionDeclaration,
  type MethodDeclaration
} from "ts-morph"
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
  awaitImportHoisted: 0,
  asyncDropped: 0
}

function sanitizeImportSource(src: string): string {
  return src.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "") || "module"
}

// Concrete async-capable subset of ts-morph's `AsyncableNode` mixin. Listing
// the real classes (rather than `as unknown as { isAsync; setIsAsync }`) lets
// the type-checker enforce that we only call those methods on nodes that
// actually have them.
type AsyncCapable = ArrowFunction | FunctionExpression | FunctionDeclaration | MethodDeclaration

function isAsyncCapable(node: Node): node is AsyncCapable {
  return (
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node) ||
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node)
  )
}

// (unused — superseded by isAsyncCapable + walk that returns AsyncCapable directly)

for (const sf of project.getSourceFiles()) {
  stats.filesScanned++
  let changed = false

  // 1. Collect vi.mock'd module paths
  const mockedModules = new Set<string>()
  sf.forEachDescendant(node => {
    if (node.getKind() !== SyntaxKind.CallExpression) return
    const call = node.asKindOrThrow(SyntaxKind.CallExpression)
    const callee = call.getExpression()
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) return
    const pae = callee.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
    if (pae.getExpression().getText() !== "vi") return
    if (pae.getName() !== "mock" && pae.getName() !== "doMock") return
    const args = call.getArguments()
    if (args.length >= 1 && args[0].getKind() === SyntaxKind.StringLiteral) {
      mockedModules.add(args[0].asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue())
    }
  })

  if (mockedModules.size === 0) continue

  // 2. Find existing top-level static imports so we don't duplicate
  const existingNamespaceImports = new Map<string, string>() // src -> name
  for (const imp of sf.getImportDeclarations()) {
    const src = imp.getModuleSpecifierValue()
    const namespace = imp.getNamespaceImport()?.getText()
    if (src && namespace) existingNamespaceImports.set(src, namespace)
  }

  // 3. Find every `await import("X")` (the call expression `import(...)`) where
  // X is in mockedModules, AND it's wrapped in an AwaitExpression
  const importCallTargets: Array<{
    awaitNode: Node
    src: string
  }> = []
  sf.forEachDescendant(node => {
    if (node.getKind() !== SyntaxKind.AwaitExpression) return
    const aw = node
    // The expression of the await should be a CallExpression whose callee is `import` (ImportKeyword)
    const child = aw.getFirstChildByKind(SyntaxKind.CallExpression)
    if (!child) return
    const callee = child.getExpression()
    // dynamic import() looks like CallExpression with expression of kind ImportKeyword
    if (callee.getKind() !== SyntaxKind.ImportKeyword) return
    const args = child.getArguments()
    if (args.length !== 1 || args[0].getKind() !== SyntaxKind.StringLiteral) return
    const src = args[0].asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
    if (!mockedModules.has(src)) return
    importCallTargets.push({ awaitNode: aw, src })
  })

  if (importCallTargets.length === 0) continue

  // 4. For each unique src, ensure a top-level namespace import exists
  const sourceToNamespace = new Map<string, string>()
  for (const { src } of importCallTargets) {
    if (sourceToNamespace.has(src)) continue
    const existing = existingNamespaceImports.get(src)
    if (existing) {
      sourceToNamespace.set(src, existing)
      continue
    }
    const name = `__$mock_${sanitizeImportSource(src)}`
    sf.addImportDeclaration({ namespaceImport: name, moduleSpecifier: src })
    sourceToNamespace.set(src, name)
    changed = true
  }

  // 5. Replace each `(await import("X"))` (and its parens, if any) with the
  // namespace identifier. The await node itself is the precise replacement
  // target; ts-morph preserves surrounding parens.
  for (const { awaitNode, src } of importCallTargets) {
    if (awaitNode.wasForgotten()) continue
    const ns = sourceToNamespace.get(src)
    if (!ns) continue
    awaitNode.replaceWithText(ns)
    stats.awaitImportHoisted++
    changed = true
  }

  // 6. Walk async functions whose body now contains no AwaitExpression and
  // drop the async keyword. Skip top-level await callers (they don't have an
  // enclosing async function anyway).
  const asyncCandidates: AsyncCapable[] = []
  sf.forEachDescendant(node => {
    if (!isAsyncCapable(node)) return
    if (!node.isAsync()) return
    asyncCandidates.push(node)
  })

  for (const fn of asyncCandidates) {
    if (fn.wasForgotten()) continue
    // Has any descendant AwaitExpression / ForAwaitStatement?
    let hasAwait = false
    fn.forEachDescendant(child => {
      const ck = child.getKind()
      if (ck === SyntaxKind.AwaitExpression || ck === SyntaxKind.ForOfStatement) {
        // ForOfStatement may be `for await` — be conservative and keep async
        if (ck === SyntaxKind.AwaitExpression) hasAwait = true
        if (ck === SyntaxKind.ForOfStatement) {
          const text = child.getText()
          if (/^for\s*await\b/.test(text)) hasAwait = true
        }
      }
    })
    if (!hasAwait) {
      fn.setIsAsync(false)
      stats.asyncDropped++
      changed = true
    }
  }

  if (changed) {
    sf.saveSync()
    stats.filesChanged++
  }
}

writeFileSync("/tmp/hoist-mock-imports-report.json", JSON.stringify(stats, null, 2))

console.error(
  `\n=== HOIST MOCKED-MODULE IMPORTS ===\nfiles scanned: ${stats.filesScanned}\nfiles changed: ${stats.filesChanged}\n(await import) -> hoisted import: ${stats.awaitImportHoisted}\nfunctions de-asynced: ${stats.asyncDropped}\n`
)
