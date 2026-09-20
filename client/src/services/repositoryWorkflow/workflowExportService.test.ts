jest.mock(
  "vscode",
  () => ({
    window: {},
    workspace: { fs: {} },
    Uri: { file: jest.fn() }
  }),
  { virtual: true }
)

import { workflowExportRow } from "./workflowExportService"

describe("workflowExportRow", () => {
  it("flattens inventory comparison records into useful scalar columns", () => {
    const row = workflowExportRow("existenceComparison", {
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
    })

    expect(row).toMatchObject({
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
