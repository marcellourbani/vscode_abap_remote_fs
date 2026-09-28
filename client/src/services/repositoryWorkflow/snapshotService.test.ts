import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { createHash } from "crypto"
import { vi } from "vitest"

const { root } = vi.hoisted(() => ({ root: { value: "" } }))

vi.mock("../abapResourceDownloadService", () => ({
  AbapResourceDownloadService: vi.fn(function () {
    return {}
  }),
  runPool: vi.fn()
}))

import { WorkflowStore } from "./workflowStore"
import { WorkflowSnapshotService, objectFolderId } from "./snapshotService"
import type { ObjectSnapshotManifest, RepositoryObjectRecord } from "./types"

vi.mock("vscode", () => ({
  Uri: { file: (value: string) => ({ fsPath: value, path: value, scheme: "file" }) },
  workspace: {
    fs: {},
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, fallback: unknown) => root.value || fallback)
    }))
  }
}))

const record: RepositoryObjectRecord = {
  pgmid: "R3TR",
  objectType: "PROG",
  objectName: "ZTEST",
  packageName: "ZPKG",
  originalSystem: "SRC",
  author: "USER",
  component: "",
  generated: false,
  deleted: false,
  classification: "custom",
  classificationReason: "Z/Y object name"
}

describe("WorkflowSnapshotService", () => {
  beforeEach(async () => {
    root.value = await fs.mkdtemp(path.join(os.tmpdir(), "snapshot-"))
  })
  afterEach(async () => fs.rm(root.value, { recursive: true, force: true }))

  it("reports raw difference but normalized equality for line endings and trailing spaces", async () => {
    const store = new WorkflowStore({} as any)
    const workflow = await store.create({
      name: "Compare",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    const id = objectFolderId("R3TR:PROG:ZTEST")
    const write = async (side: "source" | "target", content: string) => {
      const contentRoot = store.artifactPath(workflow, "sources", side, "objects", id, "content")
      await fs.mkdir(contentRoot, { recursive: true })
      const bytes = Buffer.from(content)
      const sha256 = createHash("sha256").update(bytes).digest("hex")
      const normalizedBytes = Buffer.from(content.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, ""))
      const normalizedSha256 = createHash("sha256").update(normalizedBytes).digest("hex")
      await fs.writeFile(path.join(contentRoot, "resource.abap"), bytes)
      const manifest: ObjectSnapshotManifest = {
        schemaVersion: 1,
        key: "R3TR:PROG:ZTEST",
        side,
        connectionId: `${side}100`,
        record,
        status: "complete",
        startedAt: "x",
        completedAt: "x",
        files: [
          { path: "resource.abap", bytes: bytes.length, sha256, normalizedSha256, text: true }
        ],
        aggregateHash: sha256,
        normalizedAggregateHash: normalizedSha256,
        failures: []
      }
      await store.writeJson(
        store.artifactPath(workflow, "sources", side, "objects", id, "manifest.json"),
        manifest
      )
    }
    await write("source", "WRITE: / 'A'.  \r\n")
    await write("target", "WRITE: / 'A'.\n")
    const onProgress = vi.fn(async () => {})
    const [comparison] = await new WorkflowSnapshotService(store).compare(
      workflow.workflowId,
      ["R3TR:PROG:ZTEST"],
      onProgress
    )
    expect(comparison.status).toBe("different")
    expect(comparison.normalizedIdentical).toBe(true)
    expect(comparison.linesChanged).toBe(1)
    expect(comparison.linesAdded).toBe(0)
    expect(comparison.linesRemoved).toBe(0)
    expect(onProgress).toHaveBeenCalledWith(1, 1)
  })
})
