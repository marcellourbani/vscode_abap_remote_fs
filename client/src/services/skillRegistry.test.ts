import {
  DEFAULT_ENABLED_SKILLS,
  GENERAL_SKILL_REGISTRY,
  getSkillSettings,
  skillContextKey
} from "./skillRegistry"
import { vi } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const { get } = vi.hoisted(() => ({ get: vi.fn().mockReturnValue({}) }))

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({ get }))
  },
  commands: {
    executeCommand: vi.fn()
  }
}))

describe("GENERAL_SKILL_REGISTRY", () => {
  test("contains only general skills with unique IDs and packaged paths", () => {
    expect(GENERAL_SKILL_REGISTRY.length).toBe(13)
    expect(new Set(GENERAL_SKILL_REGISTRY.map(skill => skill.id)).size).toBe(
      GENERAL_SKILL_REGISTRY.length
    )
    for (const skill of GENERAL_SKILL_REGISTRY) {
      expect(skill.displayName).toBeTruthy()
      expect(skill.description).toBeTruthy()
      expect(skill.path).toMatch(/^skills\/.+\/SKILL\.md$/)
    }
    expect(GENERAL_SKILL_REGISTRY.map(skill => skill.id)).toEqual(
      expect.arrayContaining(["repository-workflow", "repository-assisted-apply"])
    )
  })

  test("uses default-on settings for skills without an explicit value", () => {
    expect(getSkillSettings().enabledSkills).toEqual(DEFAULT_ENABLED_SKILLS)
    expect(Object.values(DEFAULT_ENABLED_SKILLS).every(Boolean)).toBe(true)
    expect(skillContextKey("clean-abap")).toBe("abapfs:skill.clean-abap.enabled")
  })

  test("keeps Customizing as one entry skill with three on-demand guides", () => {
    const root = new URL("../../media/skills/sap-customizing/", import.meta.url)
    const entry = readFileSync(new URL("SKILL.md", root), "utf8")
    const description = entry.match(/^description:\s*(.+)$/m)![1]
    expect(description).toContain("SAP Customizing and SPRO/IMG")
    expect(description).toContain("setup, updates and troubleshooting")
    expect(description).not.toMatch(/readiness|companion|read only the relevant|first check/i)
    const references = [...entry.matchAll(/\]\(\.\/([^)]+\.md)\)/g)].map(match => match[1])
    expect([...new Set(references)].sort()).toEqual(["legacy.md", "setup.md", "tools.md"])
    expect(entry).toContain("abapfs_check_customizing_setup")
    expect(entry).toContain("ready: true")
    expect(entry).toContain("A dry run is mandatory")
    expect(entry).toMatch(/user does not want setup/)
    expect(entry).toContain("First Read This Entry Only")
    expect(entry).toContain("Read its result before deciding which guide to open")
    expect(entry).toContain("Explain to the user that setup is optional")
    expect(entry).toContain("This method is read-only")
    expect(entry).toContain("increases cost")
    expect(entry).toContain("higher model cost")
    expect(entry).toContain("not an equally efficient alternative")
    expect(entry).toContain("do not guarantee that complete reverse path")
    expect(entry).toContain("Do not read it just in case")
    expect(entry.indexOf("Call `abapfs_check_customizing_setup`")).toBeLessThan(
      entry.indexOf("](./tools.md)")
    )
    expect(entry).not.toContain("## Metadata Tables")
    for (const reference of new Set(references)) {
      expect(existsSync(fileURLToPath(new URL(reference, root)))).toBe(true)
      expect(readFileSync(new URL(reference, root), "utf8")).not.toMatch(/^---\r?\n/)
    }
    expect(GENERAL_SKILL_REGISTRY.filter(skill => skill.id === "sap-customizing")).toHaveLength(1)
    const legacy = readFileSync(new URL("legacy.md", root), "utf8")
    for (const topic of ["CUS_ACTOBJ", "VCLSTRUC", "DD26S", "TNODEIMGR", "Lookup Procedures"])
      expect(legacy).toContain(topic)
    expect(legacy).not.toContain("get_object_lines")
    expect(legacy).toContain("abapfs_get_object_source")
    const manifest = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8")
    )
    const registered = new Set(
      manifest.contributes.languageModelTools.map((tool: { name: string }) => tool.name)
    )
    for (const reference of new Set(references))
      for (const match of readFileSync(new URL(reference, root), "utf8").matchAll(
        /\babapfs_[a-z_]+\b/g
      ))
        expect(
          registered.has(match[0]),
          `${reference} references an unknown tool ${match[0]}`
        ).toBe(true)
    const tools = readFileSync(new URL("tools.md", root), "utf8")
    expect(tools).toContain("A dry run is mandatory before every change")
    expect(tools).toContain("Do not submit the change again")
    expect(tools).toContain("current SAP logon language")
    const setup = readFileSync(new URL("setup.md", root), "utf8")
    expect(setup).toContain("The user performs the installation")
    expect(setup).toContain("Ask the user to open")
    expect(setup).toContain("guide the user to use the same installation method")
    expect(setup).not.toContain("Do not downgrade")
  })
})
