import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { vi } from "vitest"
import type { RepositoryObjectRecord, RepositoryWorkflow } from "./types"

const mocks = vi.hoisted(() => ({
  searchObject: vi.fn(),
  getClient: vi.fn(),
  logInfo: vi.fn()
}))

vi.mock("../../adt/conections", () => ({
  getClient: mocks.getClient
}))

vi.mock("../../lib/logger", () => ({
  log: { info: mocks.logInfo }
}))

import {
  RepositoryUriPreparationService,
  repositoryUriMapKey,
  repositoryWildcardPattern
} from "./repositoryUriPreparationService"

const workflow = {
  workflowId: "wf",
  source: { connectionId: "source100" },
  target: { connectionId: "target100" }
} as RepositoryWorkflow

function record(objectName: string, objectType = "CLAS"): RepositoryObjectRecord {
  return {
    pgmid: "R3TR",
    objectType,
    objectName,
    packageName: "ZPKG",
    originalSystem: "SRC",
    author: "USER",
    component: "",
    generated: false,
    deleted: false,
    classification: "custom",
    classificationReason: "Custom object"
  }
}

function result(name: string, type = "CLAS/OC", uri = `/sap/bc/adt/${name.toLowerCase()}`) {
  return {
    "adtcore:name": name,
    "adtcore:type": type,
    "adtcore:uri": uri
  }
}

describe("RepositoryUriPreparationService", () => {
  let root = ""
  let store: {
    get: ReturnType<typeof vi.fn>
    artifactPath: (workflow: RepositoryWorkflow, ...parts: string[]) => string
    writeJson: (filePath: string, value: unknown) => Promise<void>
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    root = await fs.mkdtemp(path.join(os.tmpdir(), "repository-uri-preparation-"))
    mocks.getClient.mockReturnValue({ searchObject: mocks.searchObject })
    store = {
      get: vi.fn().mockResolvedValue(workflow),
      artifactPath: (_workflow, ...parts) => path.join(root, ...parts),
      writeJson: async (filePath, value) => {
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        await fs.writeFile(filePath, JSON.stringify(value), "utf8")
      }
    }
  })

  afterEach(async () => fs.rm(root, { recursive: true, force: true }))

  it("uses the agreed suffix lengths and removes patterns with three or fewer prefix characters", () => {
    expect(repositoryWildcardPattern("ZCL_VERY_LONG_CLASS")).toBe("ZCL_VERY_LONG_*")
    expect(repositoryWildcardPattern("ZPROGRAM")).toBe("ZPROG*")
    expect(repositoryWildcardPattern("ABCDEFG")).toBe("ABCD*")
    expect(repositoryWildcardPattern("ABCDEF")).toBeUndefined()
    expect(repositoryWildcardPattern("ZABC")).toBeUndefined()
    expect(repositoryWildcardPattern("ABC")).toBeUndefined()
  })

  it("deduplicates wildcard calls by type and stores exact compatible matches", async () => {
    const records = [record("ZCL_COMMON_ALPHA"), record("ZCL_COMMON_BRAVO")]
    mocks.searchObject.mockResolvedValue([
      result("ZCL_COMMON_ALPHA", "CLAS/OC", "/alpha"),
      result("ZCL_COMMON_BRAVO", "CLAS/OC", "/bravo"),
      result("ZCL_COMMON_OTHER", "CLAS/OC", "/other")
    ])

    const prepared = await new RepositoryUriPreparationService(store as any).prepare(
      "wf",
      "source",
      records,
      4,
      { isCancellationRequested: false } as any
    )

    expect(mocks.searchObject).toHaveBeenCalledTimes(1)
    expect(mocks.searchObject).toHaveBeenCalledWith("ZCL_COMMON_*", "CLAS", 200)
    expect(prepared.get(repositoryUriMapKey(records[0]))).toMatchObject({
      adtUri: "/alpha",
      adtType: "CLAS/OC"
    })
    expect(prepared.get(repositoryUriMapKey(records[1]))).toMatchObject({
      adtUri: "/bravo",
      adtType: "CLAS/OC"
    })
    expect([...prepared.values()]).toHaveLength(2)
    expect(mocks.logInfo).toHaveBeenCalledWith(
      expect.stringContaining("Resolved 2 source object URIs for workflow wf")
    )
  })

  it("reuses a broader prefix result to skip a narrower search", async () => {
    const broadMatch = "ZMD_ART_COMPABCDE"
    const narrowMatch = "ZMD_ART_COMPARISABCDE"
    const records = [record(narrowMatch), record(broadMatch)]
    mocks.searchObject.mockResolvedValue([
      result(broadMatch, "CLAS/OC", "/broad-match"),
      result(narrowMatch, "CLAS/OC", "/narrow-match")
    ])

    const prepared = await new RepositoryUriPreparationService(store as any).prepare(
      "wf",
      "source",
      records,
      4,
      { isCancellationRequested: false } as any
    )

    expect(mocks.searchObject).toHaveBeenCalledTimes(1)
    expect(mocks.searchObject).toHaveBeenCalledWith("ZMD_ART_COMP*", "CLAS", 200)
    expect(prepared.get(repositoryUriMapKey(records[0]))?.adtUri).toBe("/narrow-match")
    expect(prepared.get(repositoryUriMapKey(records[1]))?.adtUri).toBe("/broad-match")
    expect(mocks.logInfo).toHaveBeenCalledWith(
      expect.stringContaining("(1 wildcard searches, 1 skipped, 0 capped, 0 failed)")
    )
  })

  it("uses the configured download concurrency for independent patterns", async () => {
    const records = [
      "ZAAA_OBJECT00001",
      "ZBBB_OBJECT00002",
      "ZCCC_OBJECT00003",
      "ZDDD_OBJECT00004",
      "ZEEE_OBJECT00005",
      "ZFFF_OBJECT00006"
    ].map(name => record(name))
    let active = 0
    let peak = 0
    const releases: (() => void)[] = []
    mocks.searchObject.mockImplementation((pattern: string) => {
      active++
      peak = Math.max(peak, active)
      const selected = records.find(item => repositoryWildcardPattern(item.objectName) === pattern)!
      return new Promise(resolve => {
        releases.push(() => {
          active--
          resolve([result(selected.objectName)])
        })
      })
    })

    const preparing = new RepositoryUriPreparationService(store as any).prepare(
      "wf",
      "source",
      records,
      6,
      { isCancellationRequested: false } as any
    )
    await vi.waitFor(() => expect(mocks.searchObject).toHaveBeenCalledTimes(6))
    expect(peak).toBe(6)
    for (const release of releases) release()
    expect((await preparing).size).toBe(6)
  })

  it("does not split capped responses and leaves absent objects unresolved", async () => {
    const records = [record("ZCL_COMMON_ALPHA"), record("ZCL_COMMON_BRAVO")]
    mocks.searchObject.mockResolvedValue([
      result("ZCL_COMMON_ALPHA", "CLAS/OC", "/alpha"),
      ...Array.from({ length: 199 }, (_, index) =>
        result(`ZCL_UNRELATED_${index}`, "CLAS/OC", `/unrelated/${index}`)
      )
    ])

    const prepared = await new RepositoryUriPreparationService(store as any).prepare(
      "wf",
      "source",
      records,
      4,
      { isCancellationRequested: false } as any
    )

    expect(mocks.searchObject).toHaveBeenCalledTimes(1)
    expect(prepared.has(repositoryUriMapKey(records[0]))).toBe(true)
    expect(prepared.has(repositoryUriMapKey(records[1]))).toBe(false)
  })

  it("treats wildcard failures as non-blocking cache misses", async () => {
    mocks.searchObject.mockRejectedValue(new Error("search failed"))

    const prepared = await new RepositoryUriPreparationService(store as any).prepare(
      "wf",
      "source",
      [record("ZCL_COMMON_ALPHA")],
      4,
      { isCancellationRequested: false } as any
    )

    expect(prepared.size).toBe(0)
  })

  it("reuses persisted exact matches without another SAP search", async () => {
    const records = [record("ZCL_COMMON_ALPHA")]
    mocks.searchObject.mockResolvedValue([result("ZCL_COMMON_ALPHA", "CLAS/OC", "/alpha")])
    const service = new RepositoryUriPreparationService(store as any)
    await service.prepare("wf", "source", records, 4, { isCancellationRequested: false } as any)
    mocks.searchObject.mockClear()

    const prepared = await service.prepare("wf", "source", records, 4, {
      isCancellationRequested: false
    } as any)

    expect(mocks.searchObject).not.toHaveBeenCalled()
    expect(prepared.get(repositoryUriMapKey(records[0]))?.adtUri).toBe("/alpha")
  })

  it("does not prepare unrestricted or incompatible matches", async () => {
    mocks.searchObject.mockResolvedValue([
      result("ABCDEFG", "PROG/P", "/wrong-type"),
      result("SOMETHING_ELSE", "CLAS/OC", "/wrong-name")
    ])
    const records = [record("ABC"), record("ABCDEFG")]

    const prepared = await new RepositoryUriPreparationService(store as any).prepare(
      "wf",
      "source",
      records,
      4,
      { isCancellationRequested: false } as any
    )

    expect(mocks.searchObject).toHaveBeenCalledTimes(1)
    expect(mocks.searchObject).toHaveBeenCalledWith("ABCD*", "CLAS", 200)
    expect(prepared.size).toBe(0)
  })

  it("does not cache an exact name that resolves to distinct URIs", async () => {
    mocks.searchObject.mockResolvedValue([
      result("ZCL_COMMON_ALPHA", "CLAS/OC", "/first"),
      result("ZCL_COMMON_ALPHA", "CLAS/OC", "/second")
    ])
    const selected = record("ZCL_COMMON_ALPHA")

    const prepared = await new RepositoryUriPreparationService(store as any).prepare(
      "wf",
      "source",
      [selected],
      4,
      { isCancellationRequested: false } as any
    )

    expect(prepared.has(repositoryUriMapKey(selected))).toBe(false)
  })
})
