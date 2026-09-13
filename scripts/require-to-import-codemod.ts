/* eslint-disable */
/**
 * Phase 2 codemod: convert `require("./path")` inside test-function bodies
 * to `await import("./path")`, and mark the enclosing function async.
 *
 * vitest does not transform CJS require() the way jest did. Tests using the
 * jest pattern of `vi.resetModules()` + `require("./mod")` to grab a freshly-
 * mocked module need to switch to `await import("./mod")`.
 *
 * Conservative — only touches:
 *   - require(STRING_LITERAL) where the string is relative ("./..." or "../...")
 *     OR is a known external module that the test mocks
 *   - require calls inside a function body (not at module top level)
 *
 * Side effects:
 *   - Rewrites the enclosing arrow function / function expression / function
 *     declaration to be `async`
 *   - Wraps the require call in an `await` expression
 */

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

// External modules that tests `require()` after `vi.mock(...)` - also needs the rewrite
const KNOWN_MOCKED_EXTERNALS = new Set([
  "abap-adt-api",
  "abap_cloud_platform",
  "fs",
  "node:fs",
  "vscode",
  "crypto",
  "node:crypto",
  "path",
  "node:path",
  "https",
  "node:https",
  "http",
  "node:http"
])

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
  callsRewritten: 0,
  asyncMarked: 0,
  skipped: [] as Array<{ file: string; reason: string; line: number }>
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

function findEnclosingAsyncCapable(node: Node): AsyncCapable | undefined {
  let cur: Node | undefined = node.getParent()
  while (cur) {
    if (isAsyncCapable(cur)) return cur
    cur = cur.getParent()
  }
  return undefined
}

for (const sf of project.getSourceFiles()) {
  stats.filesScanned++
  let fileChanged = false
  const filePath = sf.getFilePath().replace(PROJECT_ROOT + "/", "")

  // First, scan the file for every module name that is `vi.mock("...")`'d
  // at the top level. Any `require("sameName")` call inside test bodies
  // needs to become `await import("sameName")` so vitest's mock registry
  // is honored.
  const mockedModules = new Set<string>()
  sf.forEachDescendant(node => {
    if (node.getKind() !== SyntaxKind.CallExpression) return
    const call = node.asKindOrThrow(SyntaxKind.CallExpression)
    const callee = call.getExpression()
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) return
    const pae = callee.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
    if (pae.getExpression().getText() !== "vi") return
    const fnName = pae.getName()
    if (fnName !== "mock" && fnName !== "doMock") return
    const args = call.getArguments()
    if (args.length >= 1 && args[0].getKind() === SyntaxKind.StringLiteral) {
      mockedModules.add(args[0].asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue())
    }
  })

  // Collect require() calls bottom-up to avoid AST invalidation
  const targets: Array<{ call: Node; path: string }> = []

  sf.forEachDescendant(node => {
    if (node.getKind() !== SyntaxKind.CallExpression) return
    const call = node.asKindOrThrow(SyntaxKind.CallExpression)
    if (call.getExpression().getText() !== "require") return
    const args = call.getArguments()
    if (args.length !== 1 || args[0].getKind() !== SyntaxKind.StringLiteral) return
    const literal = args[0].asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
    const isRelative =
      literal.startsWith("./") || literal.startsWith("../") || literal.startsWith("/")
    const isMockedExternal = KNOWN_MOCKED_EXTERNALS.has(literal) || mockedModules.has(literal)
    if (!isRelative && !isMockedExternal) return

    // Skip if at module top level (real imports) UNLESS this is a `require`
    // for a module that's `vi.mock(...)`'d in the same file. In that case
    // we need a top-level await import to get the mocked module — vitest
    // can't transform top-level CJS require() calls.
    const fn = findEnclosingAsyncCapable(call)
    if (!fn) {
      if (mockedModules.has(literal)) {
        // Top-level require of a mocked module — must be rewritten to TLA
        targets.push({ call, path: literal })
      } else {
        stats.skipped.push({
          file: filePath,
          reason: "top-level require - leave alone",
          line: call.getStartLineNumber()
        })
      }
      return
    }
    targets.push({ call, path: literal })
  })

  // Rewrite each call in reverse order to keep ranges valid
  for (let i = targets.length - 1; i >= 0; i--) {
    const { call, path } = targets[i]
    if (call.wasForgotten()) continue

    // Mark enclosing function async if not already (no-op for top-level)
    const fn = findEnclosingAsyncCapable(call)
    if (fn && !fn.isAsync()) {
      fn.setIsAsync(true)
      stats.asyncMarked++
    }

    // Wrap the require call in `(await import(...))`
    // Replace `require("./mod")` with `(await import("./mod"))` so that when
    // it's used as `const { X } = require("./mod")`, the result is identical:
    //   const { X } = (await import("./mod"))
    // Parens are required to make the AsyncExpression parse inside a
    // VariableStatement initializer.
    const ce = call.asKindOrThrow(SyntaxKind.CallExpression)
    ce.replaceWithText(`(await import("${path}"))`)
    stats.callsRewritten++
    fileChanged = true
  }

  if (fileChanged) {
    sf.saveSync()
    stats.filesChanged++
  }
}

writeFileSync("/tmp/require-to-import-report.json", JSON.stringify(stats, null, 2))

console.error(`
=== REQUIRE → AWAIT IMPORT ===
files scanned: ${stats.filesScanned}
files changed: ${stats.filesChanged}
calls rewritten: ${stats.callsRewritten}
async marked: ${stats.asyncMarked}
skipped: ${stats.skipped.length}
report: /tmp/require-to-import-report.json
`)
