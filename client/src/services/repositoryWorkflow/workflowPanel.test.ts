jest.mock(
  "vscode",
  () => ({
    Uri: {
      joinPath: jest.fn((base: any, ...parts: string[]) => ({
        ...base,
        path: [base.path.replace(/\/$/, ""), ...parts].join("/")
      }))
    }
  }),
  { virtual: true }
)

jest.mock("../../config", () => ({ connectedRoots: jest.fn(() => new Map()) }))
jest.mock("./workflowExportService", () => ({ WorkflowExportService: jest.fn() }))
jest.mock("./workflowEngine", () => ({ RepositoryWorkflowEngine: jest.fn() }))
jest.mock("./runtime", () => ({ RepositoryWorkflowRuntime: { get: jest.fn() } }))
jest.mock("./assistedApplyService", () => ({
  assistedApplySafety: jest.fn(() => ({
    safe: true,
    autoSave: "off",
    chatSaveBeforeSend: false
  }))
}))
jest.mock("./snapshotService", () => ({ objectFolderId: jest.fn(() => "id") }))

import {
  readExistencePreview,
  readInventoryPreview,
  readSourceComparisonPreview,
  repositoryWorkflowRefreshMode,
  repositoryWorkflowAsset,
  repositoryWorkflowAssetRoot
} from "./workflowPanel"
import * as fs from "fs"
import * as path from "path"

const extensionUri = { path: "/extension" } as any

describe("repositoryWorkflowRefreshMode", () => {
  it("keeps progress and phase changes lightweight during a panel operation", () => {
    expect(
      repositoryWorkflowRefreshMode(
        { workflowId: "workflow", focus: false, progress: true },
        "workflow",
        1
      )
    ).toBe("progress")
    expect(
      repositoryWorkflowRefreshMode({ workflowId: "workflow", focus: false }, "workflow", 1)
    ).toBe("workflow")
    expect(
      repositoryWorkflowRefreshMode(
        { workflowId: "workflow", focus: false, workflowOnly: true },
        "workflow",
        0
      )
    ).toBe("workflow")
  })

  it("uses full state outside a panel operation and ignores unrelated progress", () => {
    expect(
      repositoryWorkflowRefreshMode({ workflowId: "workflow", focus: false }, "workflow", 0)
    ).toBe("state")
    expect(
      repositoryWorkflowRefreshMode(
        { workflowId: "other", focus: false, progress: true },
        "workflow",
        1
      )
    ).toBe("ignore")
  })
})

describe("repository workflow packaged assets", () => {
  it("resolves the copied client/dist/media directory", () => {
    expect(repositoryWorkflowAssetRoot(extensionUri).path).toBe(
      "/extension/client/dist/media/repositoryWorkflow"
    )
    expect(repositoryWorkflowAsset(extensionUri, "main.js").path).toBe(
      "/extension/client/dist/media/repositoryWorkflow/main.js"
    )
  })

  it("ships CSP-safe, understandable discovery UI", () => {
    const script = fs.readFileSync(
      path.join(__dirname, "../../../media/repositoryWorkflow/main.js"),
      "utf8"
    )
    const panelSource = fs.readFileSync(path.join(__dirname, "workflowPanel.ts"), "utf8")
    const stylesheet = fs.readFileSync(
      path.join(__dirname, "../../../media/repositoryWorkflow/main.css"),
      "utf8"
    )
    expect(script).not.toContain("style=")
    expect(script).not.toContain("confirm(")
    expect(script).not.toContain("prompt(")
    expect(script).toContain("Scanning ${side} inventory on ${connection}")
    expect(script).toContain("Source inventory")
    expect(script).toContain("Target inventory")
    expect(script).toContain("new Tabulator")
    expect(script).toContain('layout: "fitColumns"')
    expect(script).toContain('renderVertical: "virtual"')
    expect(script).toContain("table.getSorters()")
    expect(script).toContain("column: sorter.field")
    expect(script).toContain("column: sorter.column || sorter.field")
    expect(script).toContain("table.getHeaderFilters()")
    expect(script).toContain("tableOptions.initialSort")
    expect(script).toContain("tableOptions.initialHeaderFilter")
    expect(script).not.toContain("savedState.scrollTop")
    expect(script).not.toContain("savedState.scrollLeft")
    expect(script).toContain('data-table-view="${id}"')
    expect(script).toContain('data-clear-table="${id}"')
    expect(script).toContain("Ready to stage")
    expect(script).toContain("Incomplete or failed")
    expect(script).toContain("Selected comparable")
    expect(script).toContain("All object types")
    expect(script).toContain('${extraActions}<span id="table-count-${id}"')
    expect(script).toContain("${existenceResults}${actions}${progress}${sourceResults}")
    expect(script).toContain("source-comparison-head")
    expect(script).toContain("headerSort: true")
    expect(script).toContain('headerFilter: "input"')
    expect(script).toContain('headerFilterPlaceholder: "Filter"')
    expect(script).toContain(
      "Type a prefix. Add a trailing space for an exact match. * and ? are supported."
    )
    expect(script).toContain("startsWith(filter.toLocaleLowerCase())")
    expect(script).toContain("objects must match both")
    expect(script).toContain("packages excluded from source comparison")
    expect(script).not.toContain("container objects excluded from source comparison")
    expect(script).toContain("files.autoSave")
    expect(script).toContain("chat.saveBeforeSend")
    expect(script).toContain("Stage in target editor")
    expect(script).not.toContain("executeAssistedApply")
    expect(script).not.toContain("bulkApplyTargets")
    expect(script).toContain("Resume discovery")
    expect(script).toContain("Resume source comparison")
    expect(script).toContain("Verifying current state before resuming")
    expect(script).toContain("Downloading source and target snapshots")
    expect(script).toContain("Comparing downloaded source snapshots")
    expect(script).toContain("Preparing source comparison…")
    expect(script).toContain("clearSourceResultViews()")
    expect(script).toContain("Closing this panel pauses the active workflow")
    expect(script).toContain('state.workflow?.runState === "running"')
    expect(script).toContain("busy || pendingTransition || workflowRunning")
    expect(script).toContain('"paused", "interrupted", "failed"')
    expect(script).toContain('state.workflow.steps.sourceComparison.status === "partial"')
    expect(script).toContain('event.data.command === "progress"')
    expect(script).toContain('event.data.command === "workflow"')
    expect(script).toContain("updateWorkflowChrome")
    expect(script).toContain('data-step-actions="${id}"')
    expect(script).toContain('data-run-policy="${id}"')
    expect(script).toContain("updateProgressDisplay")
    expect(script).toContain("updateElapsedCounters")
    expect(script).toContain("pendingTransition = true")
    expect(script).toContain('["sourceDownload", "Download"]')
    expect(script).toContain('"compareSourceCode" : "resumeSourceComparison"')
    expect(script).toContain('row.status === "both"')
    expect(script).toContain("keys: [...(sourceSelections[workflow.workflowId] || [])]")
    expect(script).toContain("Import selection")
    expect(script).toContain("Apply changed selection and resume")
    expect(script).toContain("Retry incomplete objects")
    expect(script).toContain('reviewable("sourceComparison")')
    expect(script).toContain('send("importSourceSelection")')
    expect(script).toContain("state.previews.sourceSelection?.keys")
    expect(panelSource).toContain("Read and follow the repository-workflow skill first.")
    expect(panelSource).toContain("artifactRefreshDepth")
    expect(panelSource).toContain("sendWorkflowState")
    expect(panelSource).not.toContain("onDidChangeViewState")
    expect(stylesheet).toContain("width: 100%; max-width: none")
  })

  it("returns every inventory comparison as a compact preview row", async () => {
    const store = {
      artifactPath: jest.fn(() => "existence.jsonl"),
      readJsonLines: jest.fn(async function* () {
        for (let index = 0; index < 600; index++) {
          yield {
            key: `R3TR:PROG:Z${index}`,
            status: "both",
            source: {
              objectName: `Z${index}`,
              objectType: "PROG",
              packageName: "ZPKG",
              ignored: "large metadata"
            }
          }
        }
      })
    }

    const rows = await readExistencePreview(store as any, {} as any)

    expect(rows).toHaveLength(600)
    expect(rows[599]).toEqual({
      key: "R3TR:PROG:Z599",
      status: "both",
      objectName: "Z599",
      objectType: "PROG",
      packageName: "ZPKG"
    })
  })

  it("returns every discovery row without carrying unused metadata", async () => {
    const store = {
      artifactPath: jest.fn(() => "tadir.jsonl"),
      readJsonLines: jest.fn(async function* () {
        for (let index = 0; index < 600; index++)
          yield {
            objectName: `Z${index}`,
            objectType: "PROG",
            packageName: "ZPKG",
            classification: "custom",
            classificationReason: "Customer object",
            ignored: "large metadata"
          }
      })
    }

    const rows = await readInventoryPreview(store as any, {} as any, "source")

    expect(rows).toHaveLength(600)
    expect(rows[599]).toEqual({
      objectName: "Z599",
      objectType: "PROG",
      packageName: "ZPKG",
      classification: "custom",
      classificationReason: "Customer object"
    })
  })

  it("returns every source comparison as a compact preview row", async () => {
    const store = {
      artifactPath: jest.fn(() => "source.jsonl"),
      readJsonLines: jest.fn(async function* () {
        for (let index = 0; index < 600; index++)
          yield {
            key: `R3TR:PROG:Z${index}`,
            status: "different",
            added: ["new"],
            removed: ["old"],
            changed: ["main"],
            linesAdded: 1,
            linesRemoved: 2,
            linesChanged: 3,
            error: "Target snapshot failed"
          }
      })
    }

    const rows = await readSourceComparisonPreview(store as any, {} as any)

    expect(rows).toHaveLength(600)
    expect(rows[599]).toMatchObject({
      key: "R3TR:PROG:Z599",
      filesChanged: 3,
      linesAdded: 1,
      linesRemoved: 2,
      linesChanged: 3,
      error: "Target snapshot failed"
    })
  })
})
