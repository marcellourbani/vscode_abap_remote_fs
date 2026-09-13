/* eslint-disable */
// Class-mock factory codemod.
//
// In jest, vi.fn().mockImplementation((args) => ({...})) worked when used
// as a constructor because jest's mock function did its own constructor
// detection. In vitest 4+ this throws "X is not a constructor" because
// arrow functions cannot be `new`'d.
//
// Canonical vitest 5 fix: replace the arrow with a `function` expression.
// `function () { return {...} }` IS constructable, and per ECMA if the
// constructor returns a non-primitive object that object becomes the `new`
// instance, so behavior is preserved.
//
// Patterns rewritten (only inside vi.mock(...) factories, only on
// PascalCase property keys to avoid touching genuine method-mock factories):
//
//   1. PROP: vi.fn((args) => ({...}))                  -> vi.fn(function (args) { return ({...}) })
//   2. PROP: vi.fn(() => ({...}))                      -> vi.fn(function () { return ({...}) })
//   3. PROP: vi.fn().mockImplementation((args) => ...) -> vi.fn(function (args) { return ... })
//   4. PROP: vi.fn().mockImplementation(() => ...)     -> vi.fn(function () { return ... })
//   5. PROP: vi.fn()  (PascalCase prop, no impl)       -> vi.fn(class {})

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
  arrowToFunction: 0,
  emptyClassWrap: 0,
  mockImplFlattened: 0
}

function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_]*$/.test(name)
}

function isInsideViMockFactory(node: Node): boolean {
  let cur: Node | undefined = node.getParent()
  while (cur) {
    if (cur.getKind() === SyntaxKind.CallExpression) {
      const ce = cur.asKindOrThrow(SyntaxKind.CallExpression)
      const callee = ce.getExpression()
      if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
        const pae = callee.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
        if (
          pae.getExpression().getText() === "vi" &&
          (pae.getName() === "mock" || pae.getName() === "doMock")
        ) {
          return true
        }
      }
    }
    cur = cur.getParent()
  }
  return false
}

// Returns true when the given expression node is an ObjectLiteral or a
// parenthesized expression around an ObjectLiteral. Identifies the
// jest-style "factory returning shape" pattern that vitest 4+ rejects when
// the result is `new`'d.
function returnsObjectLiteral(arrow: Node): boolean {
  if (arrow.getKind() !== SyntaxKind.ArrowFunction) return false
  const a = arrow.asKindOrThrow(SyntaxKind.ArrowFunction)
  let body: Node = a.getBody()
  // Unwrap parens and `as` expressions: ({...}), ({...} as any), ({...} as Foo)
  for (let i = 0; i < 4; i++) {
    const k = body.getKind()
    if (k === SyntaxKind.ObjectLiteralExpression) return true
    if (k === SyntaxKind.ParenthesizedExpression) {
      body = body.asKindOrThrow(SyntaxKind.ParenthesizedExpression).getExpression()
      continue
    }
    if (k === SyntaxKind.AsExpression) {
      body = body.asKindOrThrow(SyntaxKind.AsExpression).getExpression()
      continue
    }
    break
  }
  return false
}

function arrowToFunctionFromArrowNode(node: Node): string | null {
  if (node.getKind() !== SyntaxKind.ArrowFunction) return null
  const arrow = node.asKindOrThrow(SyntaxKind.ArrowFunction)

  // Preserve `async` modifier: `async (x) => ...` must become
  // `async function (x) ...`. Without this we silently drop await
  // semantics and produce a parse error at any inner `await`.
  const asyncKeyword = arrow.isAsync() ? "async " : ""

  // Build params text from the structured parameter list — preserves all
  // type annotations, including ones containing => themselves
  // (e.g. `(fn: () => void)`).
  const params = arrow.getParameters()
  const paramsText = "(" + params.map(p => p.getText()).join(", ") + ")"

  const returnTypeNode = arrow.getReturnTypeNode()
  const returnAnno = returnTypeNode ? `: ${returnTypeNode.getText()}` : ""

  const body = arrow.getBody()
  const bodyKind = body.getKind()

  if (bodyKind === SyntaxKind.Block) {
    // Already a block — preserve verbatim
    return `${asyncKeyword}function ${paramsText}${returnAnno} ${body.getText()}`
  }
  // Expression body — wrap in `{ return ... }`
  return `${asyncKeyword}function ${paramsText}${returnAnno} { return ${body.getText()} }`
}

for (const sf of project.getSourceFiles()) {
  stats.filesScanned++
  let changed = false

  // Strategy: walk every ArrowFunction. If it's the sole argument to either
  // `vi.fn(...)`, `X.mockImplementation(...)`, or `X.mockImplementationOnce(...)`,
  // rewrite it to a `function` expression. Function expressions are always
  // constructable; arrows are not. Vitest 4+ enforces this when the mock is
  // invoked with `new`.
  const arrowTargets: Array<{ arrow: Node; replacement: string }> = []
  const emptyViFnTargets: Array<{ call: Node }> = []

  sf.forEachDescendant(node => {
    if (node.getKind() !== SyntaxKind.ArrowFunction) return
    const parent = node.getParent()
    if (!parent || parent.getKind() !== SyntaxKind.CallExpression) return
    const call = parent.asKindOrThrow(SyntaxKind.CallExpression)
    if (call.getArguments().length !== 1) return
    if (call.getArguments()[0] !== node) return
    const callee = call.getExpression()
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) return
    const pae = callee.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
    const fnName = pae.getName()
    const calleeRoot = pae.getExpression().getText()

    const isViFn = calleeRoot === "vi" && fnName === "fn"
    const isMockImpl = fnName === "mockImplementation" || fnName === "mockImplementationOnce"
    if (!isViFn && !isMockImpl) return

    const fnText = arrowToFunctionFromArrowNode(node)
    if (fnText) arrowTargets.push({ arrow: node, replacement: fnText })
  })

  // Also catch empty `Foo: vi.fn()` (PascalCase prop, no impl) inside vi.mock
  // factories — those need `vi.fn(class {})` so `new Foo()` works.
  sf.forEachDescendant(node => {
    if (node.getKind() !== SyntaxKind.PropertyAssignment) return
    const pa = node.asKindOrThrow(SyntaxKind.PropertyAssignment)
    const name = pa.getName()
    if (!isPascalCase(name)) return
    if (!isInsideViMockFactory(pa)) return
    const init = pa.getInitializer()
    if (!init || init.getKind() !== SyntaxKind.CallExpression) return
    const call = init.asKindOrThrow(SyntaxKind.CallExpression)
    const callee = call.getExpression()
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) return
    const pae = callee.asKindOrThrow(SyntaxKind.PropertyAccessExpression)
    if (
      pae.getExpression().getText() === "vi" &&
      pae.getName() === "fn" &&
      call.getArguments().length === 0
    ) {
      emptyViFnTargets.push({ call })
    }
  })

  // Apply in order: arrow rewrites first (they're individual node
  // replacements, no surrounding-call mutation), then empty class wraps.
  for (const { arrow, replacement } of arrowTargets) {
    if (arrow.wasForgotten()) continue
    arrow.replaceWithText(replacement)
    stats.arrowToFunction++
    changed = true
  }
  for (const { call } of emptyViFnTargets) {
    if (call.wasForgotten()) continue
    call.replaceWithText("vi.fn(class {})")
    stats.emptyClassWrap++
    changed = true
  }

  if (changed) {
    sf.saveSync()
    stats.filesChanged++
  }
}

writeFileSync("/tmp/class-mock-fix-report.json", JSON.stringify(stats, null, 2))

console.error(
  `\n=== CLASS-MOCK FIX ===\nfiles scanned: ${stats.filesScanned}\nfiles changed: ${stats.filesChanged}\narrow -> function: ${stats.arrowToFunction}\nempty vi.fn() -> class: ${stats.emptyClassWrap}\nvi.fn().mockImpl flat: ${stats.mockImplFlattened}\n`
)
