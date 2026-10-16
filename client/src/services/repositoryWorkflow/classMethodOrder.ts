import { Statements } from "@abaplint/core"
import type { ADTClient } from "abap-adt-api"
import { parseAbapFile } from "../../lib/functions"

export type ClassMethodElement = Awaited<ReturnType<ADTClient["objectStructureElements"]>>[number]

interface MethodBlock {
  name: string
  start: number
  end: number
}

export function alphabetizeClassMethods(
  source: string,
  className: string,
  sourceUrl: string,
  elements: ClassMethodElement[]
): string {
  const parsed = parseAbapFile(`${className.toLowerCase()}.clas.abap`, source)
  if (!parsed) throw new Error("Cannot parse global class source for method ordering")
  const offsets = [0]
  for (let index = 0; index < source.length; index++)
    if (source[index] === "\n") offsets.push(index + 1)
  const position = (row: number, column: number) => {
    const start = offsets[row - 1]
    const next = offsets[row]
    let end = next === undefined ? source.length : next - 1
    if (source[end - 1] === "\r") end--
    if (
      !Number.isInteger(row) ||
      !Number.isInteger(column) ||
      start === undefined ||
      column < 0 ||
      start + column > end ||
      row < 1
    )
      throw new Error("Invalid ADT method position")
    return start + column
  }
  const blocks: MethodBlock[] = []
  let owner = ""
  let current: Omit<MethodBlock, "end"> | undefined
  for (const statement of parsed.getStatements()) {
    const kind = statement.get()
    if (kind instanceof Statements.ClassImplementation)
      owner = statement.getTokens()[1].getStr().toUpperCase()
    else if (kind instanceof Statements.EndClass) owner = ""
    else if (owner === className.toUpperCase() && kind instanceof Statements.MethodImplementation) {
      if (current) throw new Error("Nested method implementations")
      const token = statement.getFirstToken()
      current = {
        name: statement.getTokens()[1].getStr().toUpperCase(),
        start: position(token.getStart().getRow(), token.getStart().getCol() - 1)
      }
    } else if (owner === className.toUpperCase() && kind instanceof Statements.EndMethod) {
      if (!current) throw new Error("Method end without implementation")
      const token = statement.getLastToken()
      const end = position(token.getEnd().getRow(), token.getEnd().getCol() - 1)
      blocks.push({ ...current, end })
      current = undefined
    }
  }
  if (current) throw new Error("Unterminated method implementation")
  const metadata = new Map<string, MethodBlock>()
  const methodTypes = new Set(["CLAS/OM", "CLAS/OLD", "CLAS/OND", "CLAS/ON", "CLAS/OO"])
  const visit = (nodes: ClassMethodElement[]) => {
    for (const node of nodes) {
      for (const link of node.links.filter(
        link => methodTypes.has(node.type.toUpperCase()) && /\/implementationBlock$/i.test(link.rel)
      )) {
        const base = /^(?:\.\/)*(?:source|includes)\//i.test(link.href)
          ? sourceUrl.replace(/\/source\/main$/i, "/")
          : sourceUrl
        const url = new URL(link.href, `http://sap${base}`)
        if (decodeURIComponent(url.pathname) !== decodeURIComponent(sourceUrl)) continue
        const match = url.hash.match(/(?:#|;)start=(\d+),(\d+);end=(\d+),(\d+)(?:;|$)/)
        if (!match) throw new Error("ADT implementation block has no complete range")
        const name = node.name.toUpperCase()
        if (metadata.has(name)) throw new Error(`Duplicate ADT method ${name}`)
        metadata.set(name, {
          name,
          start: position(Number(match[1]), Number(match[2])),
          end: position(Number(match[3]), Number(match[4]))
        })
      }
      visit(node.children)
    }
  }
  visit(elements)
  if (metadata.size !== blocks.length)
    throw new Error("ADT method inventory does not match downloaded global class source")
  const names = new Set<string>()
  for (const block of blocks) {
    if (names.has(block.name)) throw new Error(`Duplicate implementation ${block.name}`)
    names.add(block.name)
    const range = metadata.get(block.name)
    const matchingEnd =
      range &&
      (range.end === block.end || (range.end === block.end - 1 && source[range.end] === "."))
    if (!range || range.start !== block.start || !matchingEnd)
      throw new Error(`ADT range does not match downloaded method ${block.name}`)
    const lineEnd = source.indexOf("\n", block.end)
    let suffixEnd = lineEnd < 0 ? source.length : lineEnd
    if (source[suffixEnd - 1] === "\r") suffixEnd--
    if (/^[ \t\r]*"[^\n]*$/.test(source.slice(block.end, suffixEnd))) block.end = suffixEnd
  }
  const ordered = [...blocks].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  )
  let result = ""
  let cursor = 0
  for (const [index, block] of blocks.entries()) {
    if (block.start < cursor || block.end < block.start)
      throw new Error("Overlapping ADT implementation ranges")
    const replacement = ordered[index]
    result += source.slice(cursor, block.start)
    result += source.slice(replacement.start, replacement.end)
    cursor = block.end
  }
  return result + source.slice(cursor)
}
