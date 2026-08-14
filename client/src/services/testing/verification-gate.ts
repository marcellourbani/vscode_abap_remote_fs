import * as fs from "fs/promises"
import * as path from "path"
import { parseFrontmatter } from "./runtime/frontmatter"

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map(line => line.replace(/\/\/.*$/, ""))
    .join("\n")
}

export function sqlVerificationNeedsSe16n(caseMarkdown: string): boolean {
  const verification = String(parseFrontmatter(caseMarkdown)?.verification ?? "").toLowerCase()
  return verification === "sql" || verification === "mixed"
}

export function requiredSe16nTables(caseMarkdown: string): string[] {
  const tables = parseFrontmatter(caseMarkdown)?.se16nTables
  if (!Array.isArray(tables)) return []
  return [
    ...new Set(
      tables
        .filter(table => typeof table === "string")
        .map(table => table.trim().toUpperCase())
        .filter(Boolean)
    )
  ]
}

export function specSe16nTables(spec: string): string[] {
  const tables = new Set<string>()
  const source = withoutComments(spec)
  const call = /\bsap\s*\.\s*se16n\s*\(\s*\{[\s\S]*?\btable\s*:\s*["']([^"']+)["'][\s\S]*?\}\s*\)/g
  for (const match of source.matchAll(call)) tables.add(match[1].toUpperCase())
  return [...tables]
}

export function sqlVerificationGateError(
  tcId: string,
  caseMarkdown: string,
  spec: string
): string | undefined {
  if (!sqlVerificationNeedsSe16n(caseMarkdown)) return undefined
  const required = requiredSe16nTables(caseMarkdown)
  if (!required.length) {
    return (
      `${tcId} declares verification: ${parseFrontmatter(caseMarkdown)?.verification} but ` +
      `has no se16nTables frontmatter. List every SQL-verified business table/effect that ` +
      `business users can inspect, for example se16nTables: [EKKO, EKPO].`
    )
  }
  const covered = new Set(specSe16nTables(spec))
  const missing = required.filter(table => !covered.has(table))
  if (!missing.length) return undefined
  return (
    `${tcId} requires SE16N proof for ${required.join(", ")} but its spec is missing ` +
    `${missing.join(", ")}. Add one meaningful sap.se16n() assertion per missing table; ` +
    `SQL remains the authoritative DB check.`
  )
}

export async function findSqlVerificationGateErrors(
  testFolder: string,
  program: string,
  tcIds?: string[]
): Promise<string[]> {
  const scripts = path.resolve(testFolder, "tests", program, "test-scripts")
  const names = tcIds
    ? tcIds.map(tcId => `${tcId}.spec.ts`)
    : (await fs.readdir(scripts)).filter(name => name.endsWith(".spec.ts"))
  const errors: string[] = []
  for (const name of names) {
    const id = name.replace(/\.spec\.ts$/, "")
    const [spec, tc] = await Promise.all([
      fs.readFile(path.join(scripts, name), "utf8").catch(() => null),
      fs
        .readFile(path.resolve(testFolder, "tests", program, "test-cases", `${id}.md`), "utf8")
        .catch(() => null)
    ])
    if (spec === null || tc === null) continue
    const error = sqlVerificationGateError(id, tc, spec)
    if (error) errors.push(error)
  }
  return errors
}
