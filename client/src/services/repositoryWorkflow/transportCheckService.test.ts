import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn()
}))

vi.mock("../objectTransportStatusService", () => ({
  getAbapObjectTransportStatus: mocks.getStatus
}))

vi.mock("../abapResourceDownloadService", () => ({
  runPool: vi.fn(async (items: unknown[], _limit: number, worker: Function) => {
    for (let index = 0; index < items.length; index++) await worker(items[index], index)
  })
}))

vi.mock("./snapshotService", () => ({
  objectFolderId: vi.fn((key: string) => key.split(":").pop()?.toLowerCase())
}))

import { WorkflowTransportCheckService } from "./transportCheckService"

describe("WorkflowTransportCheckService", () => {
  let root = ""

  beforeEach(async () => {
    vi.clearAllMocks()
    root = await fs.mkdtemp(path.join(os.tmpdir(), "transport-check-"))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it("checks only selected eligible target objects and persists each result", async () => {
    const workflow = {
      workflowId: "wf",
      target: { connectionId: "target100" }
    }
    const artifactPath = vi.fn((_workflow: unknown, ...parts: string[]) =>
      path.join(root, ...parts)
    )
    const writeJson = vi.fn(async (filePath: string, value: unknown) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, JSON.stringify(value), "utf8")
    })
    const store = {
      get: vi.fn().mockResolvedValue(workflow),
      artifactPath,
      writeJson
    }
    const planPath = artifactPath(workflow, "assisted-apply", "plan.json")
    await fs.mkdir(path.dirname(planPath), { recursive: true })
    await fs.writeFile(
      planPath,
      JSON.stringify({
        items: [
          {
            key: "R3TR:PROG:ZLOCKED",
            eligible: true,
            targetRecord: {
              objectName: "ZLOCKED",
              objectType: "PROG",
              packageName: "ZPKG"
            }
          },
          {
            key: "R3TR:PROG:ZOTHER",
            eligible: true,
            targetRecord: {
              objectName: "ZOTHER",
              objectType: "PROG",
              packageName: "ZPKG"
            }
          }
        ]
      }),
      "utf8"
    )
    const manifestPath = artifactPath(
      workflow,
      "sources",
      "target",
      "objects",
      "zlocked",
      "manifest.json"
    )
    await fs.mkdir(path.dirname(manifestPath), { recursive: true })
    await fs.writeFile(
      manifestPath,
      JSON.stringify({ sourceUri: "adt://target100/workspace/zlocked" }),
      "utf8"
    )
    mocks.getStatus.mockResolvedValue({
      status: "locked",
      transportRequest: "DEVK900123",
      transportDescription: "Apply",
      checkedAt: "2026-10-09T12:00:00.000Z"
    })
    const progress = vi.fn()

    const result = await new WorkflowTransportCheckService(store as any).determine(
      "wf",
      ["R3TR:PROG:ZLOCKED"],
      3,
      { isCancellationRequested: false } as any,
      progress
    )

    expect(mocks.getStatus).toHaveBeenCalledTimes(1)
    expect(mocks.getStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "target100",
        source: "adt://target100/workspace/zlocked"
      })
    )
    expect(result).toMatchObject({ total: 1, completed: 1, failed: 0 })
    expect(progress).toHaveBeenCalledWith(1, 1)
    const saved = JSON.parse(await fs.readFile(planPath, "utf8"))
    expect(saved.items[0]).toMatchObject({
      transportCheckStatus: "locked",
      transportRequest: "DEVK900123"
    })
    expect(saved.items[1].transportCheckStatus).toBeUndefined()
  })
})
