import { templates } from "./initialtemplates"

describe("initialtemplates", () => {
  test("templates array is not empty", () => {
    expect(templates.length).toBeGreaterThan(0)
  })

  test("each template has name and content", () => {
    for (const t of templates) {
      expect(t.name).toBeTruthy()
      expect(t.content).toBeTruthy()
      expect(typeof t.name).toBe("string")
      expect(typeof t.content).toBe("string")
    }
  })

  test("includes AGENTS.md template", () => {
    const agents = templates.find(t => t.name === "AGENTS.md")
    expect(agents).toBeDefined()
    expect(agents!.content).toContain("ABAP FS extension")
    expect(agents!.content).toContain("CRITICAL")
  })

  test("includes abaplint.jsonc template", () => {
    const lint = templates.find(t => t.name === "abaplint.jsonc")
    expect(lint).toBeDefined()
    expect(lint!.content).toContain("syntax")
    expect(lint!.content).toContain("rules")
  })

  test("abaplint template is valid JSONC", () => {
    const lint = templates.find(t => t.name === "abaplint.jsonc")!
    // Strip trailing commas for JSON.parse (JSONC allows them)
    const cleaned = lint.content.replace(/,(\s*[}\]])/g, "$1")
    expect(() => JSON.parse(cleaned)).not.toThrow()
  })

  test("abaplint template has error namespace pattern", () => {
    const lint = templates.find(t => t.name === "abaplint.jsonc")!
    expect(lint.content).toContain("errorNamespace")
    expect(lint.content).toContain("^(Z|Y|")
  })
})
