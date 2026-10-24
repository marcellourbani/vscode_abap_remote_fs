import { readFileSync } from "node:fs"
import * as path from "node:path"
import { AGENT_PRESETS, unconfiguredPresets } from "./agentPresets"

const manifest = JSON.parse(
  readFileSync(path.join(__dirname, "../../../../../package.json"), "utf8")
)

function agentsSetting() {
  const sections = manifest.contributes.configuration
  const list = Array.isArray(sections) ? sections : [sections]
  return list.find((s: any) => s.properties?.["abapfs.acp.agents"]).properties["abapfs.acp.agents"]
}

describe("agent presets", () => {
  it("runs every preset through npx without an install prompt", () => {
    for (const preset of Object.values(AGENT_PRESETS)) {
      expect(preset.command).toBe("npx")
      expect(preset.args?.[0]).toBe("-y")
      expect(preset.args?.[1]).toMatch(/@latest$/)
    }
  })

  it("offers one settings snippet per preset with the same entry", () => {
    const snippets = agentsSetting().defaultSnippets.map((s: any) => s.body)
    expect(snippets).toEqual(
      Object.entries(AGENT_PRESETS).map(([name, entry]) => ({ [name]: entry }))
    )
  })

  it("skips presets whose name is already configured", () => {
    const names = unconfiguredPresets(["Claude Code"]).map(([name]) => name)
    expect(names).not.toContain("Claude Code")
    expect(names).toContain("Codex CLI")
  })
})
