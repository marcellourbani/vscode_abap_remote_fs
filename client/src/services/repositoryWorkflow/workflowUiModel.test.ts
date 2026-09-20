import { assertWorkflowStepReady, commandSection, REPOSITORY_OBJECT_TYPES } from "./workflowUiModel"
import { initialSteps, RepositoryWorkflow, WORKFLOW_SCHEMA_VERSION } from "./types"

function workflow(): RepositoryWorkflow {
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    workflowId: "wf",
    folderName: "wf",
    name: "Workflow",
    createdAt: "x",
    updatedAt: "x",
    source: { connectionId: "source100", role: "source" },
    target: { connectionId: "target100", role: "target" },
    currentStep: "discovery",
    runState: "idle",
    steps: initialSteps(),
    revision: 1
  }
}

describe("workflow UI model", () => {
  it("blocks every downstream step until its prerequisite is complete", () => {
    const value = workflow()
    value.steps.criteria.status = "complete"
    expect(() => assertWorkflowStepReady(value, "discovery")).not.toThrow()
    expect(() => assertWorkflowStepReady(value, "existenceComparison")).toThrow(
      "Complete repository discovery before existence comparison."
    )
    value.steps.discovery.status = "complete"
    expect(() => assertWorkflowStepReady(value, "existenceComparison")).not.toThrow()
    expect(() => assertWorkflowStepReady(value, "sourceDownload")).toThrow(
      "Complete source selection before source download."
    )
  })

  it("routes command failures to the section that initiated them", () => {
    expect(commandSection("compareExistence")).toBe("existenceComparison")
    expect(commandSection("selectSources")).toBe("sourceComparison")
    expect(commandSection("stageAssistedSource")).toBe("assistedApply")
  })

  it("provides a discoverable object type catalog", () => {
    expect(REPOSITORY_OBJECT_TYPES.length).toBeGreaterThan(20)
    expect(REPOSITORY_OBJECT_TYPES).toContainEqual({
      value: "PROG",
      label: "Programs and includes"
    })
    expect(REPOSITORY_OBJECT_TYPES).toContainEqual({ value: "CLAS", label: "Classes" })
  })
})
