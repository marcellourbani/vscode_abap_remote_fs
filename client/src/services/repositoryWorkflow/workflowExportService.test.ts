jest.mock(
  "vscode",
  () => ({
    window: { showOpenDialog: jest.fn(), showSaveDialog: jest.fn() },
    workspace: { fs: { writeFile: jest.fn() } },
    Uri: { file: jest.fn((value: string) => ({ fsPath: value })) }
  }),
  { virtual: true }
)

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import * as ExcelJS from "exceljs"
import * as vscode from "vscode"
import {
  WorkflowExportService,
  workflowExportFileName,
  workflowExportRow
} from "./workflowExportService"

describe("workflowExportFileName", () => {
  const workflow = {
    name: "Demo: Source / Target",
    source: { connectionId: "geq300" },
    target: { connectionId: "ged100" }
  } as any
  const timestamp = new Date(2026, 8, 23, 19, 20, 5)

  it("includes a safe workflow name, relevant systems, and timestamp", () => {
    expect(workflowExportFileName(workflow, "sourceDiscovery", "xlsx", timestamp)).toBe(
      "Demo_Source_Target_src-inv_GEQ300_20260923-1920.xlsx"
    )
    expect(workflowExportFileName(workflow, "targetDiscovery", "xlsx", timestamp)).toBe(
      "Demo_Source_Target_tgt-inv_GED100_20260923-1920.xlsx"
    )
    expect(workflowExportFileName(workflow, "sourceComparison", "csv", timestamp)).toBe(
      "Demo_Source_Target_src-compare_GEQ300-GED100_20260923-1920.csv"
    )
    expect(
      workflowExportFileName(
        { ...workflow, name: "GEQ300_GED100_DEMO" },
        "sourceComparison",
        "xlsx",
        timestamp
      )
    ).toBe("GEQ300_GED100_DEMO_src-compare_20260923-1920.xlsx")
    expect(
      workflowExportFileName(
        { ...workflow, name: "GEQ300_GED100_DEMO" },
        "sourceDiscovery",
        "xlsx",
        timestamp
      )
    ).toBe("GEQ300_GED100_DEMO_src-inv_GEQ300_20260923-1920.xlsx")
  })
})

describe("WorkflowExportService export location", () => {
  it("uses and remembers the user-selected directory instead of artifact storage", async () => {
    const lastDirectory = path.join(os.tmpdir(), "workflow-exports")
    const chosenPath = path.join(lastDirectory, "chosen.xlsx")
    ;(vscode.window.showSaveDialog as jest.Mock).mockResolvedValue({
      fsPath: chosenPath
    })
    const globalState = {
      get: jest.fn(() => lastDirectory),
      update: jest.fn(async () => undefined)
    }
    const store = {
      artifactPath: jest.fn(() => "internal-artifact.jsonl"),
      readJsonLines: jest.fn(async function* () {})
    }
    const workflow = {
      name: "Workflow",
      source: { connectionId: "source" },
      target: { connectionId: "target" }
    } as any

    await new WorkflowExportService(store as any, globalState as any).export(
      workflow,
      "sourceDiscovery",
      "xlsx"
    )

    const defaultPath = (vscode.window.showSaveDialog as jest.Mock).mock.calls.at(-1)[0].defaultUri
      .fsPath
    expect(path.dirname(defaultPath)).toBe(lastDirectory)
    expect(path.basename(defaultPath)).toMatch(/^Workflow_src-inv_SOURCE_\d{8}-\d{4}\.xlsx$/)
    expect(store.artifactPath).not.toHaveBeenCalledWith(workflow, "exports", expect.any(String))
    expect(globalState.update).toHaveBeenCalledWith(
      "abapfs.repositoryWorkflows.lastExportDirectory",
      lastDirectory
    )
  })
})

describe("workflowExportRow", () => {
  it("flattens inventory comparison records into useful scalar columns", () => {
    const row = workflowExportRow(
      "existenceComparison",
      {
        key: "R3TR:PROG:ZTEST",
        status: "both",
        source: {
          objectName: "ZTEST",
          objectType: "PROG",
          packageName: "ZSOURCE",
          originalSystem: "SRC",
          author: "SOURCE_USER"
        },
        target: {
          objectName: "ZTEST",
          objectType: "PROG",
          packageName: "ZTARGET",
          originalSystem: "TGT",
          author: "TARGET_USER"
        }
      },
      new Set(["R3TR:PROG:ZTEST"])
    )

    expect(row).toMatchObject({
      selected: "X",
      repositoryKey: "R3TR:PROG:ZTEST",
      result: "Present on both",
      objectName: "ZTEST",
      sourcePackage: "ZSOURCE",
      targetPackage: "ZTARGET",
      sourceAuthor: "SOURCE_USER",
      targetAuthor: "TARGET_USER"
    })
    expect(row).not.toHaveProperty("source")
    expect(row).not.toHaveProperty("target")
    expect(Object.keys(row)[0]).toBe("selected")
  })

  it("imports only marked, current, source-comparable repository keys", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-selection-"))
    const filePath = path.join(root, "selection.xlsx")
    try {
      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet("Inventory comparison")
      sheet.addRow(["Selected", "Repository Key"])
      sheet.addRow(["X", "R3TR:PROG:ZKEEP"])
      sheet.addRow(["true", "R3TR:PROG:ZKEEP"])
      sheet.addRow(["1", "R3TR:PROG:ZSOURCE"])
      sheet.addRow(["yes", "R3TR:DEVC:ZPACKAGE"])
      sheet.addRow(["X", "R3TR:PROG:ZUNKNOWN"])
      sheet.addRow(["", "R3TR:PROG:ZBLANK"])
      await workbook.xlsx.writeFile(filePath)
      ;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: filePath }])
      const store = {
        artifactPath: jest.fn(() => "existence.jsonl"),
        readJsonLines: jest.fn(async function* () {
          yield {
            key: "R3TR:PROG:ZKEEP",
            status: "both",
            source: { objectType: "PROG" }
          }
          yield {
            key: "R3TR:PROG:ZSOURCE",
            status: "source-only",
            source: { objectType: "PROG" }
          }
          yield {
            key: "R3TR:DEVC:ZPACKAGE",
            status: "both",
            source: { objectType: "DEVC" }
          }
          yield {
            key: "R3TR:PROG:ZBLANK",
            status: "both",
            source: { objectType: "PROG" }
          }
        })
      }

      const imported = await new WorkflowExportService(store as any).importSourceSelection(
        {} as any
      )

      expect(imported).toMatchObject({
        fileName: "selection.xlsx",
        keys: ["R3TR:PROG:ZKEEP"],
        requested: 4,
        duplicates: 1,
        unselectable: 2,
        unknown: 1
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("exports source file lists as readable multiline values with counts", () => {
    const row = workflowExportRow("sourceComparison", {
      key: "R3TR:CLAS:ZCL_TEST",
      status: "different",
      added: ["new.abap"],
      removed: [],
      changed: ["main.abap", "testclasses.abap"],
      linesAdded: 4,
      linesRemoved: 2,
      linesChanged: 3
    })

    expect(row).toMatchObject({
      objectName: "ZCL_TEST",
      objectType: "CLAS",
      filesAddedCount: 1,
      filesRemovedCount: 0,
      filesChangedCount: 2,
      addedFiles: "new.abap",
      changedFiles: "main.abap\ntestclasses.abap"
    })
  })

  it("flattens assisted-apply records and blocking reasons", () => {
    const row = workflowExportRow("assistedApplyPlan", {
      key: "R3TR:PROG:ZTEST",
      eligible: false,
      blockingReasons: ["Generated object", "Snapshot incomplete"],
      sourceRecord: { objectName: "ZTEST", objectType: "PROG", packageName: "ZSRC" },
      targetRecord: { objectName: "ZTEST", objectType: "PROG", packageName: "ZTGT" }
    })

    expect(row).toMatchObject({
      objectName: "ZTEST",
      sourcePackage: "ZSRC",
      targetPackage: "ZTGT",
      decision: "Blocked",
      blockingReasons: "Generated object\nSnapshot incomplete"
    })
    expect(row).not.toHaveProperty("sourceRecord")
    expect(row).not.toHaveProperty("targetRecord")
  })
})
