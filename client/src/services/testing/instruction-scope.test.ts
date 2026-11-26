import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "../../..")
const manifest = JSON.parse(readFileSync(resolve(root, "../package.json"), "utf8"))
const read = (file: string) => readFileSync(resolve(root, "media", file), "utf8")

it("keeps caller intent in every testing agent's own input contract", () => {
  const agents = manifest.contributes.chatAgents.filter((agent: { when: string }) =>
    agent.when.includes("abapfs:testingAgentsReady")
  )
  expect(agents).toHaveLength(9)
  for (const agent of agents) {
    const name = agent.path.split("/").at(-1)
    const content = read(`agents/${name}`)
    expect(content, name).toContain("`userIntent`")
    expect(content, name).toMatch(/caller/)
    expect(content, name).not.toContain("If the caller tells you HOW to do your task, ignore it")
    expect(content, name).not.toContain("sap-testing-workflow-policy")
  }
})

it("ships subject-specific scope guidance in the skills, without build injection", () => {
  const names = readdirSync(resolve(root, "media/skills/testing"))
  expect(names).toHaveLength(13)
  for (const name of names) {
    const content = read(`skills/testing/${name}/SKILL.md`)
    expect(content, name).toMatch(/scop/i)
    expect(content, name).not.toContain("sap-testing-workflow-policy")
  }
  const config = readFileSync(resolve(root, "tsdown.config.ts"), "utf8")
  expect(config).not.toContain("injectTestingInstructionPolicy")
})

it("retains folder prerequisites and screenshot defaults for scoped checks", () => {
  const overview = read("skills/testing/sap-testing/SKILL.md")
  expect(overview).toContain("valid configured test folder gates the entire feature")
  const exploration = read("skills/testing/explore-ui/SKILL.md")
  expect(exploration).toContain("User scope cannot waive the folder prerequisite")
  expect(exploration).not.toContain("browser-only")
  for (const name of ["build-scripts", "run-scripts"]) {
    const content = read(`skills/testing/${name}/SKILL.md`)
    expect(content, name).toMatch(/screenshots.*unless.*explicitly/i)
    expect(content, name).not.toContain("or screenshot artifacts")
    expect(content, name).toContain("inline")
    expect(content, name).toContain("user-supplied")
  }
})

it("exposes explicit workflow bypasses without demanding false certifications", () => {
  for (const name of ["abapfs_run_playwright_tests", "abapfs_build_test_index"]) {
    const tool = manifest.contributes.languageModelTools.find(
      (entry: { name: string }) => entry.name === name
    )
    expect(tool.inputSchema.properties.skipWorkflowValidation.default).toBe(false)
    expect(tool.inputSchema.properties.overrideReason.minLength).toBe(1)
    expect(tool.inputSchema.required).not.toContain("prerequisiteConfirmation")
    expect(tool.inputSchema.required).not.toContain("reviewerConfirmation")
  }
})
