import { AGENT_REGISTRY, AgentMeta } from "./subagentRegistry"

// subagentRegistry imports vscode but only uses it for types in other exported items.
// AGENT_REGISTRY is a plain array, so we mock vscode to allow the import.
jest.mock("vscode", () => ({}), { virtual: true })

describe("AGENT_REGISTRY", () => {
  test("is a non-empty array", () => {
    expect(Array.isArray(AGENT_REGISTRY)).toBe(true)
    expect(AGENT_REGISTRY.length).toBeGreaterThan(0)
  })

  test("all agents have required fields", () => {
    for (const agent of AGENT_REGISTRY) {
      expect(agent.id).toBeTruthy()
      expect(agent.name).toBeTruthy()
      expect(agent.description).toBeTruthy()
      expect([1, 2, 3]).toContain(agent.tier)
      expect(agent.templateFile).toBeTruthy()
      expect(agent.templateFile).toMatch(/\.agent\.md$/)
    }
  })

  test("all agent IDs are unique", () => {
    const ids = AGENT_REGISTRY.map(a => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("all agent IDs follow naming convention", () => {
    for (const agent of AGENT_REGISTRY) {
      expect(agent.id).toMatch(/^abap-[a-z-]+$/)
    }
  })

  test("tier 1 agents have restricted tool lists", () => {
    const tier1 = AGENT_REGISTRY.filter(a => a.tier === 1)
    expect(tier1.length).toBeGreaterThan(0)
    for (const agent of tier1) {
      expect(agent.tools).not.toBeNull()
      expect(Array.isArray(agent.tools)).toBe(true)
    }
  })

  test("tier 3 agents have unrestricted tools (null)", () => {
    const tier3 = AGENT_REGISTRY.filter(a => a.tier === 3)
    expect(tier3.length).toBeGreaterThan(0)
    for (const agent of tier3) {
      expect(agent.tools).toBeNull()
    }
  })

  test("known agents exist", () => {
    const ids = AGENT_REGISTRY.map(a => a.id)
    expect(ids).toContain("abap-orchestrator")
    expect(ids).toContain("abap-discoverer")
    expect(ids).toContain("abap-reader")
    expect(ids).toContain("abap-debugger")
  })

  test("defaultModel is empty for all agents", () => {
    for (const agent of AGENT_REGISTRY) {
      expect(agent.defaultModel).toBe("")
    }
  })
})
