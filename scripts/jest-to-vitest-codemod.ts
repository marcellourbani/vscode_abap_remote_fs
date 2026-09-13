/* eslint-disable */
/**
 * Jest -> Vitest codemod for vscode_abap_remote_fs.
 *
 * What it does (AST-aware via ts-morph, multi-line safe):
 *
 * 1. Identifier rewrites in expression position:
 *      jest.fn / jest.mock / jest.spyOn / jest.useFakeTimers / jest.clearAllMocks /
 *      jest.resetAllMocks / jest.restoreAllMocks / jest.doMock / jest.unmock /
 *      jest.useRealTimers / jest.advanceTimersByTime / jest.runAllTimers /
 *      jest.resetModules / jest.isolateModules / jest.mocked   ->   vi.<same>
 *
 * 2. Special-case rewrites:
 *      jest.requireActual(x)        ->  await vi.importActual(x)   (caller MUST be async — flagged in report)
 *      jest.requireMock(x)          ->  await vi.importMock(x)
 *      jest.setTimeout(ms)          ->  vi.setConfig({ testTimeout: ms })
 *      jest.retryTimes(n)           ->  vi.retry(n)
 *      jest.disableAutomock()       ->  // removed — vitest doesn't automock
 *
 * 3. Type-position rewrites (drop the `jest.` namespace, rely on the global type shim):
 *      jest.Mock<T>                 ->  Mock<T>
 *      jest.Mocked<T>               ->  Mocked<T>
 *      jest.MockedFunction<T>       ->  MockedFunction<T>
 *      jest.MockedClass<T>          ->  MockedClass<T>
 *      jest.MockedObject<T>         ->  MockedObject<T>
 *      jest.MockInstance<T>         ->  MockInstance<T>
 *
 * 4. Import-source rewrites:
 *      from "jest-mock-extended"    ->  from "vitest-mock-extended"
 *      from "@jest/globals"         ->  from "vitest"
 *
 * Files touched: any file matching the include glob below.
 *
 * Reports back, but does NOT auto-fix:
 *   - require("./...") inside test bodies (vitest needs await import())
 *   - vi.mock(...) NOT at top level (vitest 5 beta.4 enforces top-level)
 *   - jest.requireActual/jest.requireMock callers — must be made async manually
 *   - vi.fn() class-mock factories — surveyed for follow-up
 */

import { Project, SyntaxKind, type Node, type SourceFile } from "ts-morph"
import { writeFileSync } from "node:fs"

import { resolveProjectRoot } from "./lib/projectRoot"
const PROJECT_ROOT = resolveProjectRoot()

const METHOD_DIRECT_RENAME = new Set([
  "fn",
  "mock",
  "spyOn",
  "useFakeTimers",
  "useRealTimers",
  "clearAllMocks",
  "resetAllMocks",
  "restoreAllMocks",
  "doMock",
  "unmock",
  "advanceTimersByTime",
  "advanceTimersByTimeAsync",
  "runAllTimers",
  "runAllTimersAsync",
  "runOnlyPendingTimers",
  "runOnlyPendingTimersAsync",
  "resetModules",
  "isolateModules",
  "isolateModulesAsync",
  "mocked",
  "now",
  "setSystemTime",
  "getRealSystemTime"
])

const TYPE_RENAME_DROP_NAMESPACE = new Set([
  "Mock",
  "Mocked",
  "MockedFunction",
  "MockedClass",
  "MockedObject",
  "MockInstance"
])

const IMPORT_SOURCE_REWRITES: Record<string, string> = {
  "jest-mock-extended": "vitest-mock-extended",
  "@jest/globals": "vitest"
}

interface MigrationReport {
  modifiedFiles: string[]
  requireInTestBody: Array<{ file: string; line: number; text: string }>
  viMockNotTopLevel: Array<{ file: string; line: number; text: string }>
  requireActualCallers: Array<{ file: string; line: number; text: string }>
  classMockFactories: Array<{ file: string; line: number; text: string }>
  errors: Array<{ file: string; error: string }>
}

const report: MigrationReport = {
  modifiedFiles: [],
  requireInTestBody: [],
  viMockNotTopLevel: [],
  requireActualCallers: [],
  classMockFactories: [],
  errors: []
}

const project = new Project({
  tsConfigFilePath: undefined,
  skipAddingFilesFromTsConfig: true,
  compilerOptions: { allowJs: false, target: 99 }
})

const TEST_GLOBS = [
  "client/src/**/*.test.ts",
  "server/src/**/*.test.ts",
  "modules/abapfs/src/**/*.test.ts",
  "modules/abapObject/src/**/*.test.ts"
]

for (const g of TEST_GLOBS) {
  project.addSourceFilesAtPaths(`${PROJECT_ROOT}/${g}`)
}

const allFiles = project.getSourceFiles()
console.error(`scanning ${allFiles.length} test files`)

for (const sf of allFiles) {
  try {
    const changed = transformFile(sf)
    if (changed) {
      sf.saveSync()
      report.modifiedFiles.push(sf.getFilePath().replace(PROJECT_ROOT + "/", ""))
    }
  } catch (e) {
    report.errors.push({
      file: sf.getFilePath(),
      error: e instanceof Error ? e.message : String(e)
    })
  }
}

writeFileSync("/tmp/jest-to-vitest-report.json", JSON.stringify(report, null, 2))

console.error(`
=== MIGRATION SUMMARY ===
modified files:               ${report.modifiedFiles.length}
require() in test body:       ${report.requireInTestBody.length}  (manual fix needed)
vi.mock not at top level:     ${report.viMockNotTopLevel.length}  (vitest 5 beta.4 hoist)
jest.requireActual callers:   ${report.requireActualCallers.length}  (mark async manually)
vi.fn() class-mock factories: ${report.classMockFactories.length}  (need vi.fn(class {}))
errors:                       ${report.errors.length}

Full report: /tmp/jest-to-vitest-report.json
`)

function transformFile(sf: SourceFile): boolean {
  let changed = false
  const filePath = sf.getFilePath().replace(PROJECT_ROOT + "/", "")

  // --- 4. Import-source rewrites ---
  for (const imp of sf.getImportDeclarations()) {
    const src = imp.getModuleSpecifierValue()
    if (src && IMPORT_SOURCE_REWRITES[src]) {
      imp.setModuleSpecifier(IMPORT_SOURCE_REWRITES[src])
      changed = true
    }
  }

  // --- 1, 2, 3. Identifier rewrites & special cases ---
  // Walk every PropertyAccessExpression `jest.X` and rewrite based on which X
  sf.forEachDescendant(node => {
    if (node.getKind() === SyntaxKind.PropertyAccessExpression) {
      const pae = node.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
      const exprText = pae.getExpression().getText()
      if (exprText !== "jest") return
      const name = pae.getName()

      // 3. Type position — drop the namespace (rely on global type shim)
      if (TYPE_RENAME_DROP_NAMESPACE.has(name)) {
        // Used both as type ref and value — disambiguate via parent
        // For TypeReference: replace `jest.Mock` with `Mock`
        // For value access: also replace with `Mock` (because shim provides it as global)
        // SAFE in both cases.
        pae.replaceWithText(name)
        changed = true
        return
      }

      // 2. Special cases
      if (name === "requireActual") {
        // jest.requireActual(x)  ->  vi.importActual(x)
        // The CALL must be awaited — we record but don't auto-add (changes function signature)
        const parent = pae.getParent()
        if (parent && parent.getKind() === SyntaxKind.CallExpression) {
          report.requireActualCallers.push({
            file: filePath,
            line: pae.getStartLineNumber(),
            text: parent.getText().slice(0, 120)
          })
        }
        pae.replaceWithText("vi.importActual")
        changed = true
        return
      }
      if (name === "requireMock") {
        report.requireActualCallers.push({
          file: filePath,
          line: pae.getStartLineNumber(),
          text: pae.getParent()?.getText().slice(0, 120) ?? ""
        })
        pae.replaceWithText("vi.importMock")
        changed = true
        return
      }
      if (name === "setTimeout") {
        // jest.setTimeout(ms) -> vi.setConfig({ testTimeout: ms })
        const call = pae.getParent()
        if (call && call.getKind() === SyntaxKind.CallExpression) {
          const ce = call.asKindOrThrow(SyntaxKind.CallExpression)
          const args = ce.getArguments().map(a => a.getText())
          if (args.length === 1) {
            ce.replaceWithText(`vi.setConfig({ testTimeout: ${args[0]} })`)
            changed = true
            return
          }
        }
      }
      if (name === "retryTimes") {
        const call = pae.getParent()
        if (call && call.getKind() === SyntaxKind.CallExpression) {
          const ce = call.asKindOrThrow(SyntaxKind.CallExpression)
          const args = ce.getArguments().map(a => a.getText())
          if (args.length >= 1) {
            ce.replaceWithText(`vi.retry(${args[0]})`)
            changed = true
            return
          }
        }
      }

      // 1. Direct rename
      if (METHOD_DIRECT_RENAME.has(name)) {
        // Replace just the `jest` identifier with `vi`
        pae.getExpression().replaceWithText("vi")
        changed = true
        return
      }

      // Fallback for any other jest.X — best-effort rename
      pae.getExpression().replaceWithText("vi")
      changed = true
    }
  })

  // --- Surveys (no rewrite, just reporting) ---

  // require("./...") in test bodies (excludes top-of-file external requires)
  sf.forEachDescendant(node => {
    if (node.getKind() === SyntaxKind.CallExpression) {
      const call = node.asKindOrThrow(SyntaxKind.CallExpression)
      if (call.getExpression().getText() === "require") {
        const args = call.getArguments()
        if (args.length === 1 && args[0].getKind() === SyntaxKind.StringLiteral) {
          const argText = args[0].getText()
          // Relative require — these are the problematic ones
          if (
            argText.startsWith('"./') ||
            argText.startsWith("'./") ||
            argText.startsWith('"../') ||
            argText.startsWith("'../")
          ) {
            report.requireInTestBody.push({
              file: filePath,
              line: call.getStartLineNumber(),
              text: call.getText().slice(0, 120)
            })
          }
        }
      }
    }
  })

  // vi.mock(...) not at file top level (sourceFile direct child)
  sf.forEachDescendant(node => {
    if (node.getKind() === SyntaxKind.CallExpression) {
      const call = node.asKindOrThrow(SyntaxKind.CallExpression)
      const callee = call.getExpression()
      if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
        const pae = callee.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
        if (
          pae.getExpression().getText() === "vi" &&
          (pae.getName() === "mock" ||
            pae.getName() === "doMock" ||
            pae.getName() === "hoisted" ||
            pae.getName() === "unmock")
        ) {
          // Walk up to first statement and check its parent
          let stmt: Node | undefined = call
          while (
            stmt &&
            stmt.getParent() &&
            stmt.getParent()!.getKind() !== SyntaxKind.SourceFile
          ) {
            stmt = stmt.getParent()
          }
          if (stmt && stmt.getParent() && stmt.getParent()!.getKind() === SyntaxKind.SourceFile) {
            // OK, top-level
          } else {
            report.viMockNotTopLevel.push({
              file: filePath,
              line: call.getStartLineNumber(),
              text: call.getText().slice(0, 120)
            })
          }
        }
      }
    }
  })

  // vi.mock factories that contain  X: vi.fn()  patterns (suspected class mocks)
  sf.forEachDescendant(node => {
    if (node.getKind() === SyntaxKind.CallExpression) {
      const call = node.asKindOrThrow(SyntaxKind.CallExpression)
      const callee = call.getExpression()
      if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
        const pae = callee.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
        if (pae.getExpression().getText() === "vi" && pae.getName() === "mock") {
          const args = call.getArguments()
          if (args.length >= 2 && args[1].getKind() === SyntaxKind.ArrowFunction) {
            const body = args[1].getText()
            // Heuristic: PascalCase identifier followed by `: vi.fn()` (no args)
            if (/\b[A-Z][A-Za-z0-9_]*\s*:\s*vi\.fn\(\s*\)/.test(body)) {
              report.classMockFactories.push({
                file: filePath,
                line: call.getStartLineNumber(),
                text: call.getText().slice(0, 200).replace(/\s+/g, " ")
              })
            }
          }
        }
      }
    }
  })

  return changed
}
