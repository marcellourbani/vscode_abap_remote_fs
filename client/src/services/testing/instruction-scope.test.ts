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

it("teaches published helper contracts and safe concurrency, not private implementation", () => {
  const helpers = read("skills/testing/helpers-reference/SKILL.md")
  const scripts = read("skills/testing/build-scripts/SKILL.md")
  const runs = read("skills/testing/run-scripts/SKILL.md")
  for (const content of [helpers, scripts]) {
    expect(content).toContain("expectBusinessError")
    expect(content).not.toContain("guarded(")
    expect(content).not.toContain("settle(")
    expect(content).not.toContain("System messages, Multiple Logon")
  }
  expect(scripts).not.toContain("await sap.expectAlert(/required/i)")
  expect(helpers).toContain("actual output order")
  expect(runs).toContain("per runner process")
  expect(runs).toContain("local CPU/memory")
  expect(runs).toContain("runInParallel: false")
  for (const content of [helpers, scripts, runs]) {
    expect(content).not.toContain("after one authentication setup")
    expect(content).not.toContain("shared storage state")
  }
  const runner = manifest.contributes.languageModelTools.find(
    (entry: { name: string }) => entry.name === "abapfs_run_playwright_tests"
  )
  expect(runner.modelDescription).toContain("not across the invocation")
  expect(runner.inputSchema.properties.keepArtifacts.description).toContain("not hard bounds")
})

it("lets the generic helper execute caller-authorized bounded scripts", () => {
  const helper = read("agents/sap-task-helper.agent.md")
  expect(helper).toContain("running an explicitly selected set of Playwright specs")
  expect(helper).toContain("authorization")
  expect(helper).not.toContain("read-only SAP actions")
  expect(helper).not.toContain("Never perform Save")
  expect(helper).not.toContain("role's read-only rule")
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
