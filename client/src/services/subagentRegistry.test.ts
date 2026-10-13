import { readFileSync } from "node:fs"
import { AGENT_REGISTRY, type AgentMeta } from "./subagentRegistry"

// subagentRegistry imports vscode but only uses it for types in other exported items.
// AGENT_REGISTRY is a plain array, so we mock vscode to allow the import.
vi.mock("vscode", () => ({}))
vi.mock("./testing/config", () => ({
  isTestFolderValid: vi.fn().mockResolvedValue(false)
}))

const assistedApplyAgent = readFileSync(
  new URL("../../media/agents/abap-repository-assisted-apply.agent.md", import.meta.url),
  "utf8"
)
const assistedApplySkill = readFileSync(
  new URL("../../media/skills/repository-assisted-apply/SKILL.md", import.meta.url),
  "utf8"
)
const repositoryWorkflowSkill = readFileSync(
  new URL("../../media/skills/repository-workflow/SKILL.md", import.meta.url),
  "utf8"
)

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
    expect(ids).toContain("abap-repository-assisted-apply")
  })

  test("repository assisted apply agent has read plus only its five workflow tools", () => {
    const agent = AGENT_REGISTRY.find(a => a.id === "abap-repository-assisted-apply")

    expect(agent).toMatchObject({
      tier: 2,
      templateFile: "abap-repository-assisted-apply.agent.md"
    })
    expect(agent?.tools).toEqual([
      "read",
      "abapfs_get_repository_workflow",
      "abapfs_get_object_transport_status",
      "abapfs_apply_repository_workflow_object",
      "abapfs_activate_object",
      "abapfs_record_repository_workflow_object_activation"
    ])
  })

  test("repository assisted apply agent fails closed without its mandatory skill", () => {
    expect(assistedApplyAgent).toContain("tools: ['read'")
    expect(assistedApplyAgent).toContain("stop immediately and return `SKILL_UNAVAILABLE`")
    expect(assistedApplyAgent).toContain("not a substitute for reading it")
  })

  test("repository assisted apply activation requires exact applied resource URIs", () => {
    expect(assistedApplyAgent).toContain("every exact `resourceResults[].objectUri`")
    expect(assistedApplyAgent).toContain("returned `workspaceUri` exactly equals")
    expect(assistedApplySkill).toContain("every exact `resourceResults[].objectUri`")
    expect(assistedApplySkill).toContain(
      "never prove membership without exact workspace-URI equality"
    )
  })

  test("repository workflow skill defines bounded one-object subagent waves", () => {
    expect(repositoryWorkflowSkill).toContain("You are the orchestrator and owner")
    expect(repositoryWorkflowSkill).toContain("A wave contains at most 10 objects")
    expect(repositoryWorkflowSkill).toContain(
      "one fresh `abap-repository-assisted-apply` subagent per object"
    )
    expect(repositoryWorkflowSkill).toContain("Stop after the wave")
  })

  test("defaultModel is empty for all agents", () => {
    for (const agent of AGENT_REGISTRY) {
      expect(agent.defaultModel).toBe("")
    }
  })
})
