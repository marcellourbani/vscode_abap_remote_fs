/* eslint-disable */
/**
 * Drop the 3rd argument from vi.mock(...) calls — vitest doesn't support
 * { virtual: true } the way jest did. The `vscode` alias in vitest.config.ts
 * (pointing at src/tests/vscode-stub.ts) replaces virtual: true for the
 * vscode module specifically; for other "virtual" modules, the test code's
 * factory is sufficient because vitest uses the factory directly without
 * trying to resolve the original.
 */

import { Project, SyntaxKind, type CallExpression } from "ts-morph"

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

let filesChanged = 0
let argsRemoved = 0

for (const sf of project.getSourceFiles()) {
  let changed = false

  // Collect call expressions to mutate, walking deepest-first to preserve ranges
  const targets: CallExpression[] = []
  sf.forEachDescendant(node => {
    if (node.getKind() !== SyntaxKind.CallExpression) return
    const call = node.asKindOrThrow(SyntaxKind.CallExpression)
    const callee = call.getExpression()
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) return
    const pae = callee.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
    if (pae.getExpression().getText() !== "vi") return
    if (pae.getName() !== "mock") return
    if (call.getArguments().length === 3) {
      // The 3rd arg should be an ObjectLiteralExpression containing virtual: true
      const arg3 = call.getArguments()[2]
      const arg3Text = arg3.getText()
      if (/virtual\s*:\s*true/.test(arg3Text)) {
        targets.push(call)
      }
    }
  })

  for (const call of targets) {
    if (call.wasForgotten()) continue
    call.removeArgument(2)
    argsRemoved++
    changed = true
  }

  if (changed) {
    sf.saveSync()
    filesChanged++
  }
}

console.error(`vi.mock 3rd-arg removal: filesChanged=${filesChanged} argsRemoved=${argsRemoved}`)
