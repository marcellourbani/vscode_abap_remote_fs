/**
 * Shared YAML-frontmatter extraction — used by test-data.ts (to read `.data.md`
 * requirements) and by the deterministic maintenance scripts under scripts/ (to read
 * `TC-*.md` case metadata). One real YAML parser (`yaml`), one implementation,
 * so every consumer agrees on what a frontmatter block means.
 */
import { parse as yamlParse } from "yaml"

/**
 * Parse the YAML frontmatter block (between the leading `---` / `---` markers) of a
 * markdown file's contents. Returns null if there is no frontmatter block, or if it
 * doesn't parse to an object.
 */
export function parseFrontmatter(markdown: string): Record<string, any> | null {
  const m = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return null
  const parsed = yamlParse(m[1], { merge: true, customTags: ["timestamp"] })
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, any>) : null
}
