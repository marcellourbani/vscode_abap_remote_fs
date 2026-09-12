// Diagnostic-driven ESM fixer (dev tool, not shipped).
// Diagnostics come from the REPO's typescript (authoritative for this project's
// exact version/settings); ts-morph is used only to apply edits at those positions.
// Fixes: TS1484 (import type), TS2834/TS2835 (NodeNext relative extension),
//        TS4112 (remove wrong `override`), TS4114 (add missing `override`).
//
// Usage: node scripts/esm-fix.mjs <tsconfig-path> [--max=15]
import ts from "typescript"
import { Project, SyntaxKind, Node } from "ts-morph"
import { existsSync } from "node:fs"
import { dirname, resolve as resolvePath } from "node:path"

const tsconfig = process.argv[2]
if (!tsconfig) {
  console.error("usage: node scripts/esm-fix.mjs <tsconfig-path>")
  process.exit(2)
}
const maxPasses = Number((process.argv.find(a => a.startsWith("--max=")) || "--max=15").slice(6))
const TARGET_CODES = new Set([1484, 2834, 2835, 4112, 4114])

const withJsExtension = (spec, fromFile) => {
  if (!spec.startsWith(".")) return undefined
  const abs = resolvePath(dirname(fromFile), spec)
  if (existsSync(abs + ".ts") || existsSync(abs + ".tsx")) return spec + ".js"
  if (existsSync(abs + ".mts")) return spec + ".mjs"
  if (existsSync(abs + ".cts")) return spec + ".cjs"
  if (existsSync(resolvePath(abs, "index.ts")) || existsSync(resolvePath(abs, "index.tsx")))
    return spec.replace(/\/$/, "") + "/index.js"
  if (existsSync(abs + ".json")) return spec + ".json"
  return undefined // no concrete file target: leave for manual review, don't guess
}

// Authoritative diagnostics from the repo's own TypeScript.
const getDiags = () => {
  const configFile = ts.readConfigFile(tsconfig, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    resolvePath(dirname(tsconfig))
  )
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  return ts
    .getPreEmitDiagnostics(program)
    .filter(d => d.file && d.start != null && TARGET_CODES.has(d.code))
    .map(d => ({ file: d.file.fileName, start: d.start, code: d.code }))
}

const totals = { 1484: 0, ext: 0, 4112: 0, 4114: 0 }

for (let pass = 1; pass <= maxPasses; pass++) {
  const diags = getDiags()
  if (diags.length === 0) {
    console.error(`pass ${pass}: no target diagnostics left`)
    break
  }
  const byFile = new Map()
  for (const d of diags) {
    if (!byFile.has(d.file)) byFile.set(d.file, [])
    byFile.get(d.file).push(d)
  }

  const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: false })
  let applied = 0
  for (const [filePath, fileDiags] of byFile) {
    const sf = project.addSourceFileAtPath(filePath)
    fileDiags.sort((a, b) => b.start - a.start) // descending: earlier edits don't shift earlier targets
    for (const d of fileDiags) {
      const node = sf.getDescendantAtPos(d.start)
      if (!node) continue
      try {
        if (d.code === 1484) {
          const spec = node.getFirstAncestorByKind(SyntaxKind.ImportSpecifier)
          if (spec) {
            spec.setIsTypeOnly(true)
            ;(applied++, totals[1484]++)
            continue
          }
          const decl = node.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)
          if (decl && !decl.isTypeOnly()) {
            decl.setIsTypeOnly(true)
            ;(applied++, totals[1484]++)
          }
        } else if (d.code === 2834 || d.code === 2835) {
          const lit =
            node.asKind(SyntaxKind.StringLiteral) ||
            node.getFirstAncestorByKind(SyntaxKind.StringLiteral)
          if (lit) {
            const next = withJsExtension(lit.getLiteralValue(), filePath)
            if (next) {
              lit.setLiteralValue(next)
              ;(applied++, totals.ext++)
            }
          }
        } else if (d.code === 4112 || d.code === 4114) {
          const member = node.getFirstAncestor(
            a =>
              Node.isMethodDeclaration(a) ||
              Node.isPropertyDeclaration(a) ||
              Node.isGetAccessorDeclaration(a) ||
              Node.isSetAccessorDeclaration(a)
          )
          if (member && typeof member.toggleModifier === "function") {
            member.toggleModifier("override", d.code === 4114)
            ;(applied++, totals[d.code]++)
          }
        }
      } catch {
        // Node forgotten by a sibling edit; next pass re-resolves it.
      }
    }
  }
  project.saveSync()
  console.error(`pass ${pass}: applied ${applied} (${diags.length} target diagnostics)`)
  if (applied === 0) break
}

console.error(
  `DONE ${tsconfig}: type-imports ${totals[1484]}, ext ${totals.ext}, +override ${totals[4114]}, -override ${totals[4112]}`
)
