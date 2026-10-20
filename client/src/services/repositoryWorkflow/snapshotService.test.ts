import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { createHash } from "crypto"
import { vi } from "vitest"

const {
  root,
  download,
  logInfo,
  searchObjects,
  findByAdtUri,
  getNodeAsync,
  objectStructure,
  objectStructureElements,
  workerFormat,
  workerDispose
} = vi.hoisted(() => ({
  root: { value: "" },
  download: vi.fn(),
  logInfo: vi.fn(),
  searchObjects: vi.fn(),
  findByAdtUri: vi.fn(),
  getNodeAsync: vi.fn(),
  objectStructure: vi.fn(),
  objectStructureElements: vi.fn(),
  workerFormat: vi.fn(),
  workerDispose: vi.fn()
}))

vi.mock("./formatWorker", () => ({
  RepositoryFormatWorkerPool: vi.fn(function () {
    return { format: workerFormat, dispose: workerDispose }
  })
}))

vi.mock("../abapResourceDownloadService", () => ({
  AbapResourceDownloadService: vi.fn(function () {
    return { download }
  }),
  runPool: vi.fn(async (items: unknown[], limit: number, worker: Function) => {
    let nextIndex = 0
    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (nextIndex < items.length) {
          const index = nextIndex++
          await worker(items[index], index)
        }
      })
    )
  })
}))

vi.mock("../../lib/logger", () => ({
  log: { info: logInfo }
}))

vi.mock("../abapSearchService", () => ({
  getSearchService: vi.fn(() => ({ searchObjects }))
}))

vi.mock("../../adt/conections", () => ({
  getOrCreateRoot: vi.fn(async () => ({ findByAdtUri, getNodeAsync })),
  getClient: vi.fn(() => ({ statelessClone: { objectStructureElements } }))
}))

vi.mock("abapfs", () => ({
  isAbapFile: (node: { kind?: string }) => node?.kind === "file",
  isAbapFolder: (node: { kind?: string }) => node?.kind === "folder"
}))

import { WorkflowStore } from "./workflowStore"
import {
  WorkflowSnapshotService,
  normalizeTextForComparison,
  objectFolderId
} from "./snapshotService"
import type { ObjectSnapshotManifest, RepositoryObjectRecord } from "./types"
import { formatRepositoryAbap, REPOSITORY_ABAP_FORMAT_VERSION } from "./abapSourceFormatter"
import { type ClassMethodElement } from "./classMethodOrder"
import { alphabetizeClassMethods } from "./classMethodOrder"
import type { FormatWorkerRequest } from "./formatWorker"
import { getClient } from "../../adt/conections"

vi.mock("vscode", () => ({
  Uri: {
    file: (value: string) => ({ fsPath: value, path: value, scheme: "file" }),
    parse: (value: string) => {
      const uri = new URL(value)
      return { scheme: uri.protocol.slice(0, -1), authority: uri.hostname, path: uri.pathname }
    }
  },
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

// Real temp-folder I/O is slowed down a lot by parallel test workers and antivirus scans on Windows
describe("WorkflowSnapshotService", { timeout: 20_000 }, () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    workerFormat.mockImplementation(async ({ fileName, source, methodMap }: FormatWorkerRequest) =>
      formatRepositoryAbap(
        fileName,
        methodMap
          ? alphabetizeClassMethods(
              source,
              methodMap.className,
              methodMap.sourceUrl,
              methodMap.elements
            )
          : source
      )
    )
    workerDispose.mockResolvedValue(undefined)
    root.value = await fs.mkdtemp(path.join(os.tmpdir(), "snapshot-"))
    searchObjects.mockResolvedValue([
      { name: "ZTEST", type: "PROG/P", uri: "/sap/bc/adt/programs/ztest" }
    ])
    findByAdtUri.mockImplementation(async (uri: string) => ({ path: `/workspace${uri}` }))
  })
  afterEach(async () =>
    fs.rm(root.value, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  )

  it("reports raw difference but normalized equality for line endings and trailing spaces", async () => {
    const store = new WorkflowStore({} as any)
    const workflow = await store.create({
      name: "Compare",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    const id = objectFolderId("R3TR:PROG:ZTEST")
    const write = async (side: "source" | "target", content: string) => {
      const rawRoot = store.artifactPath(workflow, "sources", side, "objects", id, "raw")
      const formattedRoot = store.artifactPath(
        workflow,
        "sources",
        side,
        "objects",
        id,
        "formatted"
      )
      await fs.mkdir(rawRoot, { recursive: true })
      await fs.mkdir(formattedRoot, { recursive: true })
      const bytes = Buffer.from(content)
      const sha256 = createHash("sha256").update(bytes).digest("hex")
      const normalizedBytes = Buffer.from(content.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, ""))
      const normalizedSha256 = createHash("sha256").update(normalizedBytes).digest("hex")
      const formattedBytes = Buffer.from(formatRepositoryAbap("resource.abap", content))
      const formattedSha256 = createHash("sha256").update(formattedBytes).digest("hex")
      await fs.writeFile(path.join(rawRoot, "resource.abap"), bytes)
      await fs.writeFile(path.join(formattedRoot, "resource.abap"), formattedBytes)
      const manifest: ObjectSnapshotManifest = {
        schemaVersion: 2,
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
        formattedFiles: [
          {
            path: "resource.abap",
            bytes: formattedBytes.length,
            sha256: formattedSha256,
            normalizedSha256: formattedSha256,
            text: true
          }
        ],
        formattedAggregateHash: formattedSha256,
        formatterVersion: REPOSITORY_ABAP_FORMAT_VERSION,
        formattingFailures: [],
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
    expect(comparison.formattedIdentical).toBe(true)
    expect(comparison.sourceLines).toBe(1)
    expect(comparison.targetLines).toBe(1)
    expect(comparison.linesChanged).toBe(1)
    expect(comparison.linesAdded).toBe(0)
    expect(comparison.linesRemoved).toBe(0)
    expect(onProgress).toHaveBeenCalledWith(1, 1)
  })

  it("ignores trailing blank lines and missing final newline when normalizing text", () => {
    expect(normalizeTextForComparison("a\n     \r\n")).toBe(normalizeTextForComparison("a\n     "))
    expect(normalizeTextForComparison("a\n")).toBe("a")
  })

  it("ignores blank lines throughout text while preserving indentation and content", () => {
    expect(normalizeTextForComparison("\r\n \t\r\na  \r\n\r\n \t\r\n  b c\t\r\n\r\n")).toBe(
      "a\n  b c"
    )
    expect(normalizeTextForComparison("\n \t\r\n\n")).toBe("")
    expect(normalizeTextForComparison("")).toBe("")
  })

  it("uses a prepared URI before downloading an unresolved record", async () => {
    const store = new WorkflowStore({} as any)
    const workflow = await store.create({
      name: "Prepared URI",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    download.mockResolvedValue({
      sourceUri: "adt://source100/workspace/ztest",
      targetPath: "",
      files: 0,
      folders: 0,
      skipped: 0,
      failures: [],
      cancelled: false
    })

    await new WorkflowSnapshotService(store).downloadPending(
      workflow.workflowId,
      "source",
      [record],
      1,
      0,
      1,
      { isCancellationRequested: false } as any,
      vi.fn(async () => {}),
      new Map([
        [
          "PROG:ZTEST",
          {
            objectType: "PROG",
            objectName: "ZTEST",
            adtType: "PROG/P",
            adtUri: "/sap/bc/adt/programs/ztest"
          }
        ]
      ])
    )

    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "adt://source100/workspace/sap/bc/adt/programs/ztest",
        objectType: "PROG"
      })
    )
    expect(searchObjects).not.toHaveBeenCalled()
    const manifest = JSON.parse(
      await fs.readFile(
        store.artifactPath(
          workflow,
          "sources",
          "source",
          "objects",
          objectFolderId("R3TR:PROG:ZTEST"),
          "manifest.json"
        ),
        "utf8"
      )
    )
    expect(manifest.record).toMatchObject({
      adtUri: "adt://source100/workspace/ztest",
      adtType: "PROG/P"
    })
    expect(logInfo).toHaveBeenCalledWith(
      expect.stringContaining("0 of 1 source download worker resorted to direct object search")
    )
  })

  it("logs workers that use direct search when no prepared URI exists", async () => {
    const store = new WorkflowStore({} as any)
    const workflow = await store.create({
      name: "Direct URI search",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    download.mockResolvedValue({
      sourceUri: "adt://source100/workspace/ztest",
      targetPath: "",
      files: 0,
      folders: 0,
      skipped: 0,
      failures: [],
      cancelled: false
    })

    await new WorkflowSnapshotService(store).downloadPending(
      workflow.workflowId,
      "source",
      [record],
      1,
      0,
      1,
      { isCancellationRequested: false } as any,
      vi.fn(async () => {})
    )

    expect(searchObjects).toHaveBeenCalledWith("ZTEST", ["PROG"], 5)
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "adt://source100/workspace/sap/bc/adt/programs/ztest"
      })
    )
    expect(logInfo).toHaveBeenCalledWith(
      expect.stringContaining("1 of 1 source download worker resorted to direct object search")
    )
  })

  it.each([
    [
      "an approximate result",
      [{ name: "ZTEST_OTHER", type: "PROG/P", uri: "/other" }],
      "not found"
    ],
    [
      "ambiguous exact results",
      [
        { name: "ZTEST", type: "PROG/P", uri: "/first" },
        { name: "ZTEST", type: "PROG/P", uri: "/second" }
      ],
      "resolved ambiguously"
    ]
  ])("rejects %s inside the repository workflow", async (_label, results, expectedError) => {
    const store = new WorkflowStore({} as any)
    const workflow = await store.create({
      name: "Strict repository resolution",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    searchObjects.mockResolvedValue(results)

    const summary = await new WorkflowSnapshotService(store).downloadPending(
      workflow.workflowId,
      "source",
      [record],
      1,
      0,
      1,
      { isCancellationRequested: false } as any,
      vi.fn(async () => {})
    )

    expect(download).not.toHaveBeenCalled()
    expect(summary.failed).toBe(1)
    const manifest = JSON.parse(
      await fs.readFile(
        store.artifactPath(
          workflow,
          "sources",
          "source",
          "objects",
          objectFolderId("R3TR:PROG:ZTEST"),
          "manifest.json"
        ),
        "utf8"
      )
    )
    expect(manifest.failures.join(" ")).toContain(expectedError)
  })

  it("falls back to the normal object-name search when a prepared URI cannot resolve", async () => {
    const store = new WorkflowStore({} as any)
    const workflow = await store.create({
      name: "Prepared URI fallback",
      sourceConnectionId: "source100",
      targetConnectionId: "target100"
    })
    download.mockRejectedValueOnce(new Error("prepared URI is stale")).mockResolvedValueOnce({
      sourceUri: "adt://source100/workspace/ztest",
      targetPath: "",
      files: 0,
      folders: 0,
      skipped: 0,
      failures: [],
      cancelled: false
    })

    await new WorkflowSnapshotService(store).downloadPending(
      workflow.workflowId,
      "source",
      [record],
      1,
      0,
      1,
      { isCancellationRequested: false } as any,
      vi.fn(async () => {}),
      new Map([
        [
          "PROG:ZTEST",
          {
            objectType: "PROG",
            objectName: "ZTEST",
            adtType: "PROG/P",
            adtUri: "/stale"
          }
        ]
      ])
    )

    expect(download).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ source: "adt://source100/workspace/stale" })
    )
    expect(download).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        source: "adt://source100/workspace/sap/bc/adt/programs/ztest"
      })
    )
    expect(logInfo).toHaveBeenCalledWith(
      expect.stringContaining("1 of 1 source download worker resorted to direct object search")
    )
  })

  describe("global class formatted snapshots", () => {
    const classRecord = { ...record, objectType: "CLAS", objectName: "ZCL_TEST" }
    const key = "R3TR:CLAS:ZCL_TEST"
    const mainFile = "ZCL_TEST.clas.abap"
    const sourceUrl = "/sap/bc/adt/oo/classes/zcl_test/source/main"
    const header =
      "CLASS zcl_test DEFINITION. PUBLIC SECTION. METHODS: zebra, alpha. ENDCLASS.\nCLASS zcl_test IMPLEMENTATION.\n"
    const zebra = "METHOD zebra.\n WRITE 'Z'.\nENDMETHOD."
    const alpha = "METHOD alpha.\n WRITE 'A'.\nENDMETHOD."
    const source = header + zebra + "\n\n" + alpha + "\nENDCLASS.\n"
    const target = header + alpha + "\n\n" + zebra + "\nENDCLASS.\n"
    let contents: Record<string, string>
    let auxiliaryContents: Record<string, string>
    let version: "active" | "inactive"

    function metadata(text: string): ClassMethodElement[] {
      const point = (offset: number) => {
        const prefix = text.slice(0, offset).split("\n")
        return `${prefix.length},${prefix[prefix.length - 1].length}`
      }
      return [...text.matchAll(/METHOD (\w+)\.[\s\S]*?ENDMETHOD\./g)].map(match => ({
        name: match[1],
        type: "CLAS/OM",
        children: [],
        constructor: false,
        links: [
          {
            rel: "http://www.sap.com/adt/relations/source/implementationBlock",
            href: `./source/main#start=${point(match.index!)};end=${point(match.index! + match[0].length - 1)}`
          }
        ]
      }))
    }

    beforeEach(() => {
      contents = { source100: source, target100: target }
      const auxiliary =
        "CLASS ltc_test DEFINITION FOR TESTING. ENDCLASS.\nCLASS ltc_test IMPLEMENTATION. ENDCLASS.\n"
      auxiliaryContents = { source100: auxiliary, target100: auxiliary }
      version = "active"
      searchObjects.mockResolvedValue([
        { name: "ZCL_TEST", type: "CLAS/OC", uri: "/sap/bc/adt/oo/classes/zcl_test" }
      ])
      getNodeAsync.mockImplementation(async () => {
        throw new Error("class method maps must not walk the package tree")
      })
      objectStructure.mockImplementation(async () => ({
        metaData: { "adtcore:version": version }
      }))
      download.mockImplementation(
        async (options: { source: string; target: { fsPath: string } }) => {
          const connectionId = new URL(options.source).hostname
          await fs.mkdir(options.target.fsPath, { recursive: true })
          await fs.writeFile(path.join(options.target.fsPath, mainFile), contents[connectionId])
          await fs.writeFile(
            path.join(options.target.fsPath, "testclasses.abap"),
            auxiliaryContents[connectionId]
          )
          return {
            sourceUri: options.source,
            targetPath: options.target.fsPath,
            files: 2,
            folders: 1,
            skipped: 0,
            failures: [],
            cancelled: false
          }
        }
      )
      vi.mocked(getClient).mockImplementation(
        (connectionId: string) =>
          ({
            statelessClone: {
              objectStructure,
              objectStructureElements: (...args: unknown[]) =>
                objectStructureElements(connectionId, ...args)
            }
          }) as unknown as ReturnType<typeof getClient>
      )
      objectStructureElements.mockImplementation(async (connectionId: string) =>
        metadata(contents[connectionId])
      )
    })

    async function snapshot(
      side: "source" | "target" = "source",
      selected = classRecord,
      format = true
    ) {
      const store = new WorkflowStore({} as any)
      const workflow = await store.create({
        name: "Class order",
        sourceConnectionId: "source100",
        targetConnectionId: "target100"
      })
      const service = new WorkflowSnapshotService(store)
      await service.downloadPending(
        workflow.workflowId,
        side,
        [selected],
        1,
        0,
        1,
        { isCancellationRequested: false } as any,
        vi.fn(async () => {})
      )
      const selectedKey = `${selected.pgmid}:${selected.objectType}:${selected.objectName}`
      if (format) {
        await service.downloadPending(
          workflow.workflowId,
          side === "source" ? "target" : "source",
          [selected],
          1,
          0,
          1,
          { isCancellationRequested: false } as any,
          vi.fn(async () => {})
        )
        await service.compare(workflow.workflowId, [selectedKey])
      }
      const objectRoot = store.artifactPath(
        workflow,
        "sources",
        side,
        "objects",
        objectFolderId(selectedKey)
      )
      const manifest = JSON.parse(
        await fs.readFile(path.join(objectRoot, "manifest.json"), "utf8")
      ) as ObjectSnapshotManifest
      return { store, workflow, service, objectRoot, manifest }
    }

    it("preserves raw order while formatted hashes and counts ignore reordered methods", async () => {
      const { workflow, service, objectRoot, manifest } = await snapshot()
      expect(manifest.adtUrl).toBe("/sap/bc/adt/oo/classes/zcl_test")
      expect(manifest.classMethodMap?.sourceUrl).toBe(sourceUrl)
      expect(await fs.readFile(path.join(objectRoot, `raw/resource/${mainFile}`), "utf8")).toBe(
        source
      )
      expect(
        await fs.readFile(path.join(objectRoot, `formatted/resource/${mainFile}`), "utf8")
      ).toBe(normalizeTextForComparison(formatRepositoryAbap(mainFile, target)))
      const [comparison] = await service.compare(workflow.workflowId, [key])
      expect(comparison.rawIdentical).toBe(false)
      expect(comparison.formattedIdentical).toBe(true)
      expect(comparison.formattedChanged).toEqual([])
      expect(comparison.formattedLinesChanged).toBe(0)
      expect(comparison.formattedLinesAdded).toBe(0)
      expect(comparison.formattedLinesRemoved).toBe(0)
      expect(getClient).toHaveBeenCalledWith("source100")
      expect(getClient).toHaveBeenCalledWith("target100")
      expect(objectStructureElements).toHaveBeenCalledTimes(2)
    })

    it("prefetches structures at per-side limits and formats five snapshots concurrently", async () => {
      const { store, workflow, service } = await snapshot("source", classRecord, false)
      await service.downloadPending(
        workflow.workflowId,
        "target",
        [classRecord],
        1,
        0,
        1,
        { isCancellationRequested: false } as any,
        vi.fn(async () => {})
      )
      const keys = [key, `${key}_COPY1`, `${key}_COPY2`]
      for (const side of ["source", "target"] as const) {
        const original = store.artifactPath(
          workflow,
          "sources",
          side,
          "objects",
          objectFolderId(key)
        )
        for (const copyKey of keys.slice(1))
          await fs.cp(
            original,
            store.artifactPath(workflow, "sources", side, "objects", objectFolderId(copyKey)),
            { recursive: true }
          )
      }
      const active = { source100: 0, target100: 0 }
      const peak = { source100: 0, target100: 0 }
      objectStructureElements.mockImplementation(async (connection: keyof typeof active) => {
        active[connection]++
        peak[connection] = Math.max(peak[connection], active[connection])
        await new Promise(resolve => setTimeout(resolve, 10))
        active[connection]--
        return metadata(contents[connection])
      })
      let formattingActive = 0
      let formattingPeak = 0
      let releaseFormatting!: () => void
      const formattingGate = new Promise<void>(resolve => (releaseFormatting = resolve))
      workerFormat.mockImplementation(async (request: FormatWorkerRequest) => {
        expect(objectStructureElements).toHaveBeenCalledTimes(6)
        expect(active).toEqual({ source100: 0, target100: 0 })
        for (const side of ["source", "target"] as const) {
          const manifestPath = store.artifactPath(
            workflow,
            "sources",
            side,
            "objects",
            objectFolderId(key),
            "manifest.json"
          )
          const saved = JSON.parse(await fs.readFile(manifestPath, "utf8"))
          expect(saved.classMethodMap.rawHash).toBe(saved.aggregateHash)
        }
        formattingActive++
        formattingPeak = Math.max(formattingPeak, formattingActive)
        if (formattingActive === 5) releaseFormatting()
        await formattingGate
        formattingActive--
        return request.source
      })
      const onPhase = vi.fn(async () => {})
      const results = await service.compare(workflow.workflowId, keys, undefined, undefined, {
        sourceConcurrency: 2,
        targetConcurrency: 1,
        onPhase
      })
      expect(peak).toEqual({ source100: 2, target100: 1 })
      expect(formattingPeak).toBe(5)
      expect(results.map(result => result.key)).toEqual(keys)
      expect(onPhase).toHaveBeenCalledWith("scanning snapshots", 0, 3)
      expect(onPhase).toHaveBeenCalledWith("scanning snapshots", 3, 3)
      expect(onPhase).toHaveBeenCalledWith("getting object structures", 6, 6)
      expect(onPhase).toHaveBeenCalledWith("formatting", 6, 6)
      expect(onPhase).toHaveBeenCalledWith("comparing", 0, 3)
    })

    it("persists fetched maps on pause and resumes without refetching structures", async () => {
      const { store, workflow, service, objectRoot } = await snapshot("source", classRecord, false)
      await service.downloadPending(
        workflow.workflowId,
        "target",
        [classRecord],
        1,
        0,
        1,
        { isCancellationRequested: false } as any,
        vi.fn(async () => {})
      )
      const token = { isCancellationRequested: false }
      await service.compare(workflow.workflowId, [key], undefined, token as any, {
        onPhase: async (phase, completed, total) => {
          if (phase === "getting object structures" && completed === total)
            token.isCancellationRequested = true
        }
      })
      expect(workerFormat).not.toHaveBeenCalled()
      const saved = JSON.parse(await fs.readFile(path.join(objectRoot, "manifest.json"), "utf8"))
      expect(saved.classMethodMap.rawHash).toBe(saved.aggregateHash)
      expect(saved.formattingState).toBe("pending")
      expect(saved.formattedFiles).toEqual([])
      const [comparison] = await service.compare(workflow.workflowId, [key])
      expect(comparison.formattedIdentical).toBe(true)
      expect(objectStructureElements).toHaveBeenCalledTimes(2)
      expect(download).toHaveBeenCalledTimes(2)
    })

    it("drains in-flight formatting before disposing the pool on a local write failure", async () => {
      const { store, workflow, service } = await snapshot("source", classRecord, false)
      await service.downloadPending(
        workflow.workflowId,
        "target",
        [classRecord],
        1,
        0,
        1,
        { isCancellationRequested: false } as any,
        vi.fn(async () => {})
      )
      let releaseTarget = () => {}
      let reportFailure = () => {}
      const targetAllowed = new Promise<void>(resolve => {
        releaseTarget = resolve
      })
      const writeFailed = new Promise<void>(resolve => {
        reportFailure = resolve
      })
      workerFormat.mockImplementation(async (request: FormatWorkerRequest) => {
        if (request.source === target) await targetAllowed
        return request.source
      })
      const writeJson = store.writeJson.bind(store)
      vi.spyOn(store, "writeJson").mockImplementation(async (filePath, value) => {
        const manifest = value as ObjectSnapshotManifest
        if (manifest.connectionId === "source100" && manifest.formattingState === "complete") {
          reportFailure()
          throw new Error("snapshot write failed")
        }
        await writeJson(filePath, value)
      })
      const comparison = service.compare(workflow.workflowId, [key])
      const rejected = expect(comparison).rejects.toThrow("snapshot write failed")
      await writeFailed
      const disposedBeforeDrain = workerDispose.mock.calls.length
      releaseTarget()
      await rejected
      expect(disposedBeforeDrain).toBe(0)
      expect(workerDispose).toHaveBeenCalledTimes(1)
      const targetRoot = store.artifactPath(
        workflow,
        "sources",
        "target",
        "objects",
        objectFolderId(key)
      )
      const saved = JSON.parse(await fs.readFile(path.join(targetRoot, "manifest.json"), "utf8"))
      expect(saved.formattingState).toBe("complete")
    })

    it("downloads and verifies raw snapshots without formatting or fetching method metadata", async () => {
      const { workflow, service, manifest } = await snapshot("source", classRecord, false)
      expect(manifest.formattingState).toBe("pending")
      expect(manifest.formattedFiles).toEqual([])
      expect(workerFormat).not.toHaveBeenCalled()
      expect(objectStructureElements).not.toHaveBeenCalled()
      await service.verifySide(
        workflow.workflowId,
        "source",
        [classRecord],
        32,
        { isCancellationRequested: false } as any,
        vi.fn(async () => {})
      )
      expect(workerFormat).not.toHaveBeenCalled()
      expect(objectStructureElements).not.toHaveBeenCalled()
      expect(download).toHaveBeenCalledTimes(1)
    })

    it("skips ADT structure and all ABAPLint work for complete raw-identical pairs", async () => {
      contents.target100 = source
      const { workflow, service, manifest } = await snapshot()
      const [comparison] = await service.compare(workflow.workflowId, [key])
      expect(comparison.status).toBe("identical")
      expect(comparison.formattedIdentical).toBe(true)
      expect(comparison.formattedError).toBeUndefined()
      expect(comparison.formattedLinesChanged).toBe(0)
      expect(manifest.formattedAggregateHash).toBeUndefined()
      expect(workerFormat).not.toHaveBeenCalled()
      expect(objectStructureElements).not.toHaveBeenCalled()
      expect(objectStructure).not.toHaveBeenCalled()
    })

    it("does not reuse failed formatted results for a raw-identical pair", async () => {
      contents.target100 = source
      const { workflow, service, manifest, store, objectRoot } = await snapshot()
      manifest.formattingFailures = ["old formatting failure"]
      manifest.formatterVersion = "old"
      await store.writeJson(path.join(objectRoot, "manifest.json"), manifest)
      const [comparison] = await service.compare(workflow.workflowId, [key])
      expect(comparison.formattedIdentical).toBe(true)
      expect(comparison.formattedError).toBeUndefined()
      expect(workerFormat).not.toHaveBeenCalled()
      expect(objectStructureElements).not.toHaveBeenCalled()
    })

    it.each(["active", "inactive"] as const)(
      "requests matching %s structure",
      async selectedVersion => {
        version = selectedVersion
        const { manifest } = await snapshot()
        expect(objectStructureElements).toHaveBeenCalledWith(
          "source100",
          "/sap/bc/adt/oo/classes/zcl_test",
          selectedVersion
        )
        expect(manifest.formattingFailures).toEqual([])
      }
    )

    it.each([
      ["method body", () => target.replace("'A'", "'CHANGED'")],
      ["declaration", () => target.replace("PUBLIC SECTION", "PROTECTED SECTION")],
      [
        "added method",
        () => target.replace("\nENDCLASS.", "\nMETHOD extra. ENDMETHOD.\nENDCLASS.")
      ],
      ["removed method", () => target.replace(alpha, "")],
      ["method comment", () => target.replace(" WRITE 'A'.", "\" changed comment\n WRITE 'A'.")]
    ])("still detects a changed %s", async (_label, change) => {
      contents.target100 = (change as () => string)()
      const { workflow, service } = await snapshot()
      await service.downloadPending(
        workflow.workflowId,
        "target",
        [classRecord],
        1,
        0,
        1,
        { isCancellationRequested: false } as any,
        vi.fn(async () => {})
      )
      const [comparison] = await service.compare(workflow.workflowId, [key])
      expect(comparison.formattedIdentical).toBe(false)
      expect(comparison.formattedChanged).toEqual([`resource/${mainFile}`])
      expect(comparison.formattedError).toBeUndefined()
    })

    it("retains raw data and fails formatted comparison when metadata is unavailable", async () => {
      objectStructureElements.mockResolvedValue([])
      const { manifest, objectRoot } = await snapshot()
      expect(manifest.status).toBe("complete")
      expect(manifest.formattedAggregateHash).toBeUndefined()
      expect(manifest.formattingFailures.join(" ")).toContain("inventory")
      expect(await fs.readFile(path.join(objectRoot, `raw/resource/${mainFile}`), "utf8")).toBe(
        source
      )
    })

    it("reports structure request failures without losing raw download", async () => {
      objectStructureElements.mockRejectedValue(new Error("ADT unavailable"))
      const { manifest } = await snapshot()
      expect(manifest.status).toBe("complete")
      expect(manifest.formattingFailures.join(" ")).toContain("ADT unavailable")
      expect(manifest.formattedAggregateHash).toBeUndefined()
    })

    it("rejects stale ranges without reordering the raw snapshot", async () => {
      objectStructureElements.mockResolvedValue(metadata("\n" + source))
      const { manifest } = await snapshot()
      expect(manifest.formattingFailures.join(" ")).toMatch(
        /does not match|Invalid ADT method position/
      )
      expect(manifest.formattedAggregateHash).toBeUndefined()
    })

    it("handles empty classes without method ranges", async () => {
      contents.source100 =
        "CLASS zcl_test DEFINITION. ENDCLASS.\nCLASS zcl_test IMPLEMENTATION. ENDCLASS.\n"
      const { manifest } = await snapshot()
      expect(manifest.formattingFailures).toEqual([])
      expect(manifest.formattedAggregateHash).toBeDefined()
    })

    it("does not request metadata or reorder reports with local classes", async () => {
      searchObjects.mockResolvedValue([{ name: "ZTEST", type: "PROG/P", uri: "/program" }])
      const { manifest, objectRoot } = await snapshot("source", record)
      expect(objectStructureElements).not.toHaveBeenCalled()
      expect(objectStructure).not.toHaveBeenCalled()
      expect(manifest.formattingFailures).toEqual([])
      expect(
        await fs.readFile(path.join(objectRoot, `formatted/resource/${mainFile}`), "utf8")
      ).toBe(normalizeTextForComparison(formatRepositoryAbap(mainFile, source)))
    })

    it("regenerates formatted snapshots from cached raw source and metadata after a version change", async () => {
      const { store, workflow, service, manifest, objectRoot } = await snapshot()
      manifest.formatterVersion = "abaplint-upper-token-space-class-method-order-v3"
      await store.writeJson(path.join(objectRoot, "manifest.json"), manifest)
      await fs.writeFile(
        path.join(objectRoot, `formatted/resource/${mainFile}`),
        "obsolete formatted output"
      )
      const verification = await service.verifySide(
        workflow.workflowId,
        "source",
        [classRecord],
        1,
        { isCancellationRequested: false } as any,
        vi.fn(async () => {})
      )
      expect(verification.pending).toEqual([])
      expect(verification.completed).toBe(1)
      await service.compare(workflow.workflowId, [key])
      expect(download).toHaveBeenCalledTimes(2)
      expect(objectStructureElements).toHaveBeenCalledTimes(2)
      expect(await fs.readFile(path.join(objectRoot, `raw/resource/${mainFile}`), "utf8")).toBe(
        source
      )
      expect(
        await fs.readFile(path.join(objectRoot, `formatted/resource/${mainFile}`), "utf8")
      ).toBe(normalizeTextForComparison(formatRepositoryAbap(mainFile, target)))
      const updated = JSON.parse(await fs.readFile(path.join(objectRoot, "manifest.json"), "utf8"))
      expect(updated.formatterVersion).toBe(REPOSITORY_ABAP_FORMAT_VERSION)
      expect(updated.aggregateHash).toBe(manifest.aggregateHash)
      expect(updated.classMethodMap).toEqual(manifest.classMethodMap)
    })

    it.each(["missing", "rawHash", "connectionId", "sourceUri", "className"])(
      "preserves raw snapshots and fails closed for a %s cached method map",
      async defect => {
        const { store, workflow, service, manifest, objectRoot } = await snapshot()
        manifest.formatterVersion = "abaplint-upper-token-space-class-method-order-v3"
        if (defect === "missing") delete manifest.classMethodMap
        else Object.assign(manifest.classMethodMap!, { [defect]: "incompatible" })
        await store.writeJson(path.join(objectRoot, "manifest.json"), manifest)
        const verification = await service.verifySide(
          workflow.workflowId,
          "source",
          [classRecord],
          1,
          { isCancellationRequested: false } as any,
          vi.fn(async () => {})
        )
        expect(verification.pending).toEqual([])
        expect(verification.completed).toBe(1)
        await service.compare(workflow.workflowId, [key])
        expect(download).toHaveBeenCalledTimes(2)
        expect(objectStructureElements).toHaveBeenCalledTimes(2)
        expect(await fs.readFile(path.join(objectRoot, `raw/resource/${mainFile}`), "utf8")).toBe(
          source
        )
        const updated = JSON.parse(
          await fs.readFile(path.join(objectRoot, "manifest.json"), "utf8")
        )
        expect(updated.formattingFailures.join(" ")).toContain("explicitly refresh source")
        expect(updated.formattedAggregateHash).toBeUndefined()
        expect(updated.aggregateHash).toBe(manifest.aggregateHash)
      }
    )

    it.each(["missing", "corrupt"])(
      "repairs %s formatted files without downloading raw source",
      async defect => {
        const { workflow, service, objectRoot } = await snapshot()
        const formattedPath = path.join(objectRoot, `formatted/resource/${mainFile}`)
        if (defect === "missing")
          await fs.rm(path.join(objectRoot, "formatted"), { recursive: true })
        else await fs.writeFile(formattedPath, "corrupt")
        const verification = await service.verifySide(
          workflow.workflowId,
          "source",
          [classRecord],
          1,
          { isCancellationRequested: false } as any,
          vi.fn(async () => {})
        )
        expect(verification.pending).toEqual([])
        await service.compare(workflow.workflowId, [key])
        expect(await fs.readFile(formattedPath, "utf8")).toBe(
          normalizeTextForComparison(formatRepositoryAbap(mainFile, target))
        )
        expect(download).toHaveBeenCalledTimes(2)
        expect(objectStructureElements).toHaveBeenCalledTimes(2)
      }
    )

    it("retries old formatting failures from cached source and method map", async () => {
      const { store, workflow, service, manifest, objectRoot } = await snapshot()
      manifest.formatterVersion = "abaplint-upper-token-space-class-method-order-v3"
      manifest.formattingFailures = [
        "ADT method inventory does not match downloaded global class source"
      ]
      delete manifest.formattedAggregateHash
      await store.writeJson(path.join(objectRoot, "manifest.json"), manifest)
      await service.verifySide(
        workflow.workflowId,
        "source",
        [classRecord],
        1,
        { isCancellationRequested: false } as any,
        vi.fn(async () => {})
      )
      await service.compare(workflow.workflowId, [key])
      const updated = JSON.parse(await fs.readFile(path.join(objectRoot, "manifest.json"), "utf8"))
      expect(updated.formattingFailures).toEqual([])
      expect(updated.formattedAggregateHash).toBeDefined()
      expect(download).toHaveBeenCalledTimes(2)
      expect(objectStructureElements).toHaveBeenCalledTimes(2)
    })

    it("regenerates report formatting without class metadata or SAP requests", async () => {
      searchObjects.mockResolvedValue([{ name: "ZTEST", type: "PROG/P", uri: "/program" }])
      const { store, workflow, service, manifest, objectRoot } = await snapshot("source", record)
      manifest.formatterVersion = "obsolete"
      await store.writeJson(path.join(objectRoot, "manifest.json"), manifest)
      await fs.rm(path.join(objectRoot, "formatted"), { recursive: true })
      const verification = await service.verifySide(
        workflow.workflowId,
        "source",
        [record],
        1,
        { isCancellationRequested: false } as any,
        vi.fn(async () => {})
      )
      expect(verification.pending).toEqual([])
      await service.compare(workflow.workflowId, ["R3TR:PROG:ZTEST"])
      expect(
        await fs.readFile(path.join(objectRoot, `formatted/resource/${mainFile}`), "utf8")
      ).toBe(normalizeTextForComparison(formatRepositoryAbap(mainFile, source)))
      expect(objectStructureElements).not.toHaveBeenCalled()
      expect(download).toHaveBeenCalledTimes(2)
    })

    it.each(["corrupt raw", "explicit refresh", "incompatible schema"])(
      "requires a source download for %s",
      async reason => {
        const { store, workflow, service, manifest, objectRoot } = await snapshot()
        if (reason === "corrupt raw")
          await fs.writeFile(path.join(objectRoot, `raw/resource/${mainFile}`), "corrupt")
        if (reason === "incompatible schema") {
          manifest.schemaVersion = -1
          await store.writeJson(path.join(objectRoot, "manifest.json"), manifest)
        }
        const verification = await service.verifySide(
          workflow.workflowId,
          "source",
          [classRecord],
          1,
          { isCancellationRequested: false } as any,
          vi.fn(async () => {}),
          reason === "explicit refresh"
        )
        expect(verification.pending).toEqual([classRecord])
        expect(verification.completed).toBe(0)
      }
    )

    it("reuses verified canonical snapshots without another ADT request", async () => {
      const { workflow, service } = await snapshot()
      const verification = await service.verifySide(
        workflow.workflowId,
        "source",
        [classRecord],
        1,
        { isCancellationRequested: false } as any,
        vi.fn(async () => {})
      )
      expect(verification.completed).toBe(1)
      expect(verification.pending).toEqual([])
      const calls = workerFormat.mock.calls.length
      await service.compare(workflow.workflowId, [key])
      expect(workerFormat).toHaveBeenCalledTimes(calls)
      expect(objectStructureElements).toHaveBeenCalledTimes(2)
    })

    it("supports snapshots downloaded directly from the main source file", async () => {
      download.mockImplementation(
        async (options: { source: string; target: { fsPath: string } }) => {
          const connectionId = new URL(options.source).hostname
          const uri = `adt://${connectionId}/workspace/zcl_test.clas.abap`
          await fs.mkdir(path.dirname(options.target.fsPath), { recursive: true })
          await fs.writeFile(options.target.fsPath, contents[connectionId])
          return {
            sourceUri: uri,
            files: 1,
            folders: 0,
            skipped: 0,
            failures: [],
            cancelled: false
          }
        }
      )
      const { manifest, objectRoot } = await snapshot()
      expect(manifest.formattingFailures).toEqual([])
      expect(await fs.readFile(path.join(objectRoot, "raw/resource"), "utf8")).toBe(source)
      expect(await fs.readFile(path.join(objectRoot, "formatted/resource"), "utf8")).toBe(
        normalizeTextForComparison(formatRepositoryAbap("zcl_test.clas.abap", target))
      )
    })

    it("does not format partial snapshots even when raw hashes match", async () => {
      contents.target100 = source
      const { workflow, service, manifest, store, objectRoot } = await snapshot()
      manifest.status = "partial"
      manifest.failures = ["download interrupted"]
      await store.writeJson(path.join(objectRoot, "manifest.json"), manifest)
      const [comparison] = await service.compare(workflow.workflowId, [key])
      expect(comparison.status).toBe("partial")
      expect(comparison.formattedIdentical).toBeUndefined()
      expect(workerFormat).not.toHaveBeenCalled()
      expect(objectStructureElements).not.toHaveBeenCalled()
    })

    it("keeps deferred raw snapshots resumable when cancellation occurs during formatting", async () => {
      const { workflow, service, store, objectRoot } = await snapshot("source", classRecord, false)
      await service.downloadPending(
        workflow.workflowId,
        "target",
        [classRecord],
        1,
        0,
        1,
        { isCancellationRequested: false } as any,
        vi.fn(async () => {})
      )
      const token = { isCancellationRequested: false }
      workerFormat.mockImplementationOnce(async () => {
        token.isCancellationRequested = true
        throw new Error("Formatting cancelled")
      })
      expect(await service.compare(workflow.workflowId, [key], undefined, token as any)).toEqual([])
      expect(workerDispose).toHaveBeenCalled()
      const manifest = JSON.parse(await fs.readFile(path.join(objectRoot, "manifest.json"), "utf8"))
      expect(manifest.status).toBe("complete")
      expect(manifest.formattingState).toBe("pending")
      expect(await fs.readFile(path.join(objectRoot, `raw/resource/${mainFile}`), "utf8")).toBe(
        source
      )
      const [comparison] = await service.compare(workflow.workflowId, [key])
      expect(comparison.formattedIdentical).toBe(true)
      expect(download).toHaveBeenCalledTimes(2)
      expect(store).toBeDefined()
    })

    it("preserves other class resource contents and detects their changes", async () => {
      const { workflow, service, objectRoot } = await snapshot()
      const testSource = await fs.readFile(
        path.join(objectRoot, "raw/resource/testclasses.abap"),
        "utf8"
      )
      expect(
        await fs.readFile(path.join(objectRoot, "formatted/resource/testclasses.abap"), "utf8")
      ).toBe(normalizeTextForComparison(formatRepositoryAbap("testclasses.abap", testSource)))
      auxiliaryContents.target100 = '" Different auxiliary source\n' + testSource
      await service.downloadPending(
        workflow.workflowId,
        "target",
        [classRecord],
        1,
        0,
        1,
        { isCancellationRequested: false } as any,
        vi.fn(async () => {})
      )
      const [comparison] = await service.compare(workflow.workflowId, [key])
      expect(comparison.formattedIdentical).toBe(false)
      expect(comparison.formattedChanged).toEqual(["resource/testclasses.abap"])
    })

    it("fails formatting when a class snapshot has no recorded ADT URL", async () => {
      const { store, workflow, service, manifest, objectRoot } = await snapshot(
        "source",
        classRecord,
        false
      )
      await service.downloadPending(
        workflow.workflowId,
        "target",
        [classRecord],
        1,
        0,
        1,
        { isCancellationRequested: false } as any,
        vi.fn(async () => {})
      )
      delete manifest.adtUrl
      await store.writeJson(path.join(objectRoot, "manifest.json"), manifest)
      await service.compare(workflow.workflowId, [key])
      const updated = JSON.parse(await fs.readFile(path.join(objectRoot, "manifest.json"), "utf8"))
      expect(updated.formattingFailures.join(" ")).toContain("no recorded ADT URL")
      expect(updated.formattedAggregateHash).toBeUndefined()
      expect(objectStructureElements).toHaveBeenCalledTimes(1)
    })

    it("records the prepared ADT URL and uses it for the class structure", async () => {
      const store = new WorkflowStore({} as any)
      const workflow = await store.create({
        name: "Prepared class URL",
        sourceConnectionId: "source100",
        targetConnectionId: "target100"
      })
      const service = new WorkflowSnapshotService(store)
      const prepared = new Map([
        [
          "CLAS:ZCL_TEST",
          {
            objectType: "CLAS",
            objectName: "ZCL_TEST",
            adtType: "CLAS/OC",
            adtUri: "/sap/bc/adt/oo/classes/zcl_test"
          }
        ]
      ])
      for (const side of ["source", "target"] as const)
        await service.downloadPending(
          workflow.workflowId,
          side,
          [classRecord],
          1,
          0,
          1,
          { isCancellationRequested: false } as any,
          vi.fn(async () => {}),
          prepared
        )
      await service.compare(workflow.workflowId, [key])
      expect(searchObjects).not.toHaveBeenCalled()
      expect(objectStructure).toHaveBeenCalledWith("/sap/bc/adt/oo/classes/zcl_test")
      expect(objectStructureElements).toHaveBeenCalledWith(
        "source100",
        "/sap/bc/adt/oo/classes/zcl_test",
        "active"
      )
    })

    it("fails formatting if the main class resource is absent from the download", async () => {
      download.mockImplementation(
        async (options: { source: string; target: { fsPath: string } }) => {
          const connectionId = new URL(options.source).hostname
          await fs.mkdir(options.target.fsPath, { recursive: true })
          await fs.writeFile(
            path.join(options.target.fsPath, "ZCL_TEST.clas.testclasses.abap"),
            contents[connectionId]
          )
          return {
            sourceUri: options.source,
            targetPath: options.target.fsPath,
            files: 1,
            folders: 1,
            skipped: 0,
            failures: [],
            cancelled: false
          }
        }
      )
      const { manifest } = await snapshot()
      expect(manifest.formattingFailures.join(" ")).toContain("missing from the raw snapshot")
      expect(objectStructureElements).not.toHaveBeenCalled()
    })
  })
})
