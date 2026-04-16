import { MERMAID_DOCUMENTATION, DiagramTypeInfo } from "./MermaidDocumentation"

describe("MERMAID_DOCUMENTATION", () => {
  test("is a non-empty object", () => {
    const keys = Object.keys(MERMAID_DOCUMENTATION)
    expect(keys.length).toBeGreaterThan(0)
  })

  test("contains common diagram types", () => {
    expect(MERMAID_DOCUMENTATION).toHaveProperty("flowchart")
    expect(MERMAID_DOCUMENTATION).toHaveProperty("sequence")
    expect(MERMAID_DOCUMENTATION).toHaveProperty("class")
    expect(MERMAID_DOCUMENTATION).toHaveProperty("state")
  })

  test("all entries have required fields", () => {
    for (const [key, info] of Object.entries(MERMAID_DOCUMENTATION)) {
      expect(info.name).toBeTruthy()
      expect(info.description).toBeTruthy()
      expect(Array.isArray(info.keywords)).toBe(true)
      expect(info.keywords.length).toBeGreaterThan(0)
      expect(info.syntax).toBeTruthy()
      expect(info.example).toBeTruthy()
      expect(Array.isArray(info.commonElements)).toBe(true)
      expect(info.commonElements.length).toBeGreaterThan(0)
    }
  })

  test("flowchart has direction keywords", () => {
    const fc = MERMAID_DOCUMENTATION.flowchart
    expect(fc.keywords).toContain("flowchart")
    expect(fc.keywords.some(k => ["TD", "LR", "TB", "RL"].includes(k))).toBe(true)
  })

  test("sequence diagram has participant keyword", () => {
    const seq = MERMAID_DOCUMENTATION.sequence
    expect(seq.keywords).toContain("sequenceDiagram")
  })

  test("class diagram has class keyword", () => {
    const cls = MERMAID_DOCUMENTATION.class
    expect(cls.keywords).toContain("classDiagram")
  })
})
