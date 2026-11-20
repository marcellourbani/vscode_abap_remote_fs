import { beforeEach, describe, expect, it, vi } from "vitest"
import { objectPath, session_types } from "abap-adt-api"
vi.mock("abapfs", () => ({
  isAbapFolder: (node: { object?: { type?: string } } | undefined) =>
    node?.object?.type === "DEVC/K"
}))
vi.mock("./query", async original => ({
  ...(await original<typeof import("./query")>()),
  ensureConnected: vi.fn()
}))
vi.mock("../../adt/conections", () => ({
  getOrCreateClient: vi.fn(),
  getOrCreateRoot: vi.fn()
}))
vi.mock("./engine", () => ({ callEngine: vi.fn() }))
vi.mock("./payload", async original => ({
  ...(await original<typeof import("./payload")>()),
  loadPayload: vi.fn()
}))
import {
  checkInstallation,
  deployInstallation,
  provisionServices,
  validateDeployment
} from "./setup"
import { buildSicfReport, SICF_REPORT } from "./sicfReport"
import { ensureConnected } from "./query"
import { getOrCreateRoot } from "../../adt/conections"
import { callEngine } from "./engine"
import { loadPayload, SAP_OBJECTS, ENGINE_VERSION } from "./payload"

const header = `* ABAP FS Customizing ${ENGINE_VERSION}\n`
const input = { connectionId: "example", packageName: "$TMP" }
describe("deployment input", () => {
  it.each([
    [{ ...input, transport: "EXAK900001" }, "Leave transport"],
    [{ ...input, packageName: "$LOCAL", transport: "EXAK900001" }, "Leave transport"],
    [{ ...input, packageName: "ZCFG" }, "Workbench"],
    [{ ...input, connectionId: "" }, "connection"],
    [{ ...input, packageName: "Z';DROP" }, "Invalid"],
    [{ ...input, packageName: "ZCFG", transport: "bad request" }, "Invalid"]
  ])("rejects invalid installation parameters %#", (value, error) =>
    expect(() => validateDeployment(value)).toThrow(error)
  )
  it("accepts a local installation without transport", () =>
    expect(validateDeployment(input).transport).toBeUndefined())
  it("accepts any $-prefixed local package without a Workbench request", () => {
    const result = validateDeployment({ ...input, packageName: "$LOCAL" })
    expect(result.packageName).toBe("$LOCAL")
    expect(result.transport).toBeUndefined()
  })
  it("normalizes explicit transport and package", () =>
    expect(
      validateDeployment({ ...input, packageName: "zcfg", transport: " exak900001 " })
    ).toMatchObject({ packageName: "ZCFG", transport: "EXAK900001" }))
})

describe("installation inspection and deployment", () => {
  const client = {
    stateful: session_types.stateless,
    httpClient: { request: vi.fn() },
    searchObject: vi.fn(),
    getObjectSource: vi.fn(),
    objectStructure: vi.fn(),
    inactiveObjects: vi.fn(),
    createObject: vi.fn(),
    lock: vi.fn(),
    unLock: vi.fn(),
    setObjectSource: vi.fn(),
    activate: vi.fn(),
    transportInfo: vi.fn(),
    unitTestRun: vi.fn(),
    unitTestEvaluation: vi.fn()
  }
  const refreshPackage = vi.fn()
  const findPackage = vi.fn()
  const getTmpPackage = vi.fn()
  beforeEach(() => {
    vi.resetAllMocks()
    client.stateful = session_types.stateless
    vi.mocked(ensureConnected).mockResolvedValue(client as never)
    refreshPackage.mockResolvedValue(undefined)
    findPackage.mockImplementation(async (path: string) => {
      const packageName = decodeURIComponent(path.split("/").pop()!).toUpperCase()
      return {
        path: `/${packageName}`,
        file: { object: { type: "DEVC/K", name: packageName }, refresh: refreshPackage }
      }
    })
    getTmpPackage.mockResolvedValue({
      object: { type: "DEVC/K", name: "$TMP" },
      refresh: refreshPackage
    })
    findPackage.mockClear()
    vi.mocked(getOrCreateRoot).mockResolvedValue({
      findByAdtUri: findPackage,
      getNodeAsync: vi.fn((path: string) => (path === "/$TMP" ? getTmpPackage() : undefined))
    } as never)
    client.searchObject.mockImplementation(async (name: string, type: string) => [
      { "adtcore:name": name, "adtcore:type": type, "adtcore:uri": "" }
    ])
    client.getObjectSource.mockResolvedValue(header)
    client.objectStructure.mockResolvedValue({})
    client.inactiveObjects.mockResolvedValue([])
    client.transportInfo.mockResolvedValue({ DEVCLASS: "$TMP" })
    client.lock.mockResolvedValue({ LOCK_HANDLE: "example-lock" })
    client.httpClient.request.mockResolvedValue({ body: "" })
    client.unitTestRun.mockResolvedValue([
      {
        "adtcore:name": "LTC_SETUP",
        alerts: [],
        testmethods: [{ "adtcore:name": "RUN_SETUP", alerts: [] }]
      }
    ])
    client.unitTestEvaluation.mockResolvedValue([])
    client.setObjectSource.mockImplementation(async (_path: string, source: string) => {
      client.getObjectSource.mockResolvedValueOnce(source)
    })
    vi.mocked(callEngine).mockResolvedValue({ STATUS: "ok", VERSION: ENGINE_VERSION })
    vi.mocked(loadPayload).mockReturnValue(
      SAP_OBJECTS.map(object => ({ ...object, source: header }))
    )
  })
  it("reports readiness only when every source and endpoint matches", async () => {
    expect((await checkInstallation("example")).ready).toBe(true)
    client.getObjectSource.mockResolvedValue("* ABAP FS Customizing 0.1.0\n")
    expect((await checkInstallation("example")).ready).toBe(false)
  })
  it("checks class versions inside the version method", async () => {
    const classSource = `CLASS z DEFINITION.\nPRIVATE SECTION.\nMETHODS version.\nENDCLASS.\nCLASS z IMPLEMENTATION.\nMETHOD version.\n${header}ENDMETHOD.\nENDCLASS.`
    client.getObjectSource
      .mockResolvedValueOnce(classSource)
      .mockResolvedValueOnce(classSource)
      .mockResolvedValueOnce(header)
    expect((await checkInstallation("example")).ready).toBe(true)
  })
  it("distinguishes missing, unversioned and forbidden objects", async () => {
    client.searchObject.mockResolvedValueOnce([])
    client.getObjectSource
      .mockResolvedValueOnce("CLASS z DEFINITION.")
      .mockRejectedValueOnce({ status: 403 })
    const result = await checkInstallation("example")
    expect(result.objects.map(object => object.status)).toEqual(["missing", "unversioned", "error"])
    expect(result.ready).toBe(false)
  })
  it("reports an object as missing when exact-name search returns no result", async () => {
    client.searchObject.mockResolvedValueOnce([])
    const result = await checkInstallation("example")
    expect(result.objects[0]).toMatchObject({
      status: "missing",
      error: expect.stringContaining("ABAP class is not installed")
    })
  })
  it("requires exact name and type when interpreting search results", async () => {
    client.searchObject
      .mockResolvedValueOnce([
        { "adtcore:name": `${SAP_OBJECTS[0].name}_OTHER`, "adtcore:type": SAP_OBJECTS[0].type }
      ])
      .mockResolvedValueOnce([{ "adtcore:name": SAP_OBJECTS[1].name, "adtcore:type": "PROG/P" }])
      .mockResolvedValueOnce([])
    const result = await checkInstallation("example")
    expect(result.objects.map(object => object.status)).toEqual(["missing", "missing", "missing"])
    expect(client.getObjectSource).not.toHaveBeenCalled()
  })
  it("reports search failures as errors rather than missing objects", async () => {
    client.searchObject.mockRejectedValueOnce(new Error("Search unavailable"))
    const result = await checkInstallation("example")
    expect(result.objects[0]).toMatchObject({ status: "error", detail: "Search unavailable" })
    expect(client.getObjectSource).toHaveBeenCalledTimes(2)
  })
  it("creates an absent report based on exact search", async () => {
    client.searchObject.mockImplementation(async (name: string, type: string) =>
      name === SAP_OBJECTS[2].name
        ? []
        : [{ "adtcore:name": name, "adtcore:type": type, "adtcore:uri": "" }]
    )
    await deployInstallation(input, "assets")
    expect(client.searchObject).toHaveBeenCalledWith(SAP_OBJECTS[2].name, SAP_OBJECTS[2].type, 100)
    expect(client.createObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: SAP_OBJECTS[2].name })
    )
    expect(getOrCreateRoot).toHaveBeenCalledWith("example")
    expect(findPackage).not.toHaveBeenCalled()
    expect(getTmpPackage).toHaveBeenCalledExactlyOnceWith()
    expect(refreshPackage).toHaveBeenCalledTimes(1)
    expect(client.objectStructure).not.toHaveBeenCalled()
    expect(client.httpClient.request.mock.invocationCallOrder[0]).toBeLessThan(
      refreshPackage.mock.invocationCallOrder[0]
    )
    expect(client.unitTestRun.mock.invocationCallOrder[0]).toBeLessThan(
      refreshPackage.mock.invocationCallOrder[0]
    )
  })
  it("falls back to active source for an existing report with no inactive version", async () => {
    client.getObjectSource
      .mockResolvedValueOnce(header)
      .mockResolvedValueOnce(header)
      .mockRejectedValueOnce(new Error("ZABAPFS_CUST_WRITE does not have any inactive version"))
    await deployInstallation(input, "assets")
    expect(client.getObjectSource).toHaveBeenCalledWith(`${SAP_OBJECTS[2].path}/source/main`, {
      version: "active"
    })
    expect(client.createObject).not.toHaveBeenCalled()
  })
  it("still refuses a foreign report after falling back to active source", async () => {
    client.getObjectSource
      .mockResolvedValueOnce(header)
      .mockResolvedValueOnce(header)
      .mockRejectedValueOnce(new Error("ZABAPFS_CUST_WRITE does not have any inactive version"))
      .mockResolvedValueOnce("REPORT foreign.")
    await expect(deployInstallation(input, "assets")).rejects.toThrow("unversioned")
    expect(client.setObjectSource).not.toHaveBeenCalled()
  })
  it.each([403, 500])(
    "does not create a report when its existence check fails with %s",
    async status => {
      client.getObjectSource
        .mockResolvedValueOnce(header)
        .mockResolvedValueOnce(header)
        .mockRejectedValueOnce(new Error("ZABAPFS_CUST_WRITE does not have any inactive version"))
      client.objectStructure.mockRejectedValueOnce({ status })
      await expect(deployInstallation(input, "assets")).rejects.toThrow()
      expect(client.createObject).not.toHaveBeenCalled()
      expect(client.setObjectSource).not.toHaveBeenCalled()
    }
  )
  it("shows an absent report as not installed after exact search", async () => {
    client.searchObject.mockImplementation(async (name: string, type: string) =>
      name === SAP_OBJECTS[2].name
        ? []
        : [{ "adtcore:name": name, "adtcore:type": type, "adtcore:uri": "" }]
    )
    const result = await checkInstallation("example")
    expect(result.objects[2]).toMatchObject({
      status: "missing",
      error: expect.stringContaining("ABAP report is not installed")
    })
  })
  it("creates an absent SICF installer based on exact search", async () => {
    client.searchObject.mockImplementation(async (name: string, type: string) =>
      name === SICF_REPORT.name
        ? []
        : [{ "adtcore:name": name, "adtcore:type": type, "adtcore:uri": "" }]
    )
    await provisionServices(input, "assets")
    expect(client.createObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: SICF_REPORT.name })
    )
    expect(findPackage).not.toHaveBeenCalled()
    expect(getTmpPackage).toHaveBeenCalledExactlyOnceWith()
    expect(refreshPackage).toHaveBeenCalledTimes(1)
    expect(client.objectStructure).not.toHaveBeenCalled()
    expect(client.httpClient.request.mock.invocationCallOrder[0]).toBeLessThan(
      refreshPackage.mock.invocationCallOrder[0]
    )
    expect(client.unitTestRun.mock.invocationCallOrder[0]).toBeLessThan(
      refreshPackage.mock.invocationCallOrder[0]
    )
  })
  it("keeps service errors separate from source availability", async () => {
    vi.mocked(callEngine).mockRejectedValue(new Error("HTTP 403"))
    const result = await checkInstallation("example")
    expect(result.objects.every(object => object.status === "current")).toBe(true)
    expect(
      result.services.every(
        service =>
          !service.reachable &&
          service.detail === "HTTP 403" &&
          service.error?.includes("authenticated access")
      )
    ).toBe(true)
    expect(result.ready).toBe(false)
  })
  it("preflights all objects before any writes and refuses foreign collisions", async () => {
    client.getObjectSource.mockResolvedValueOnce(header).mockResolvedValueOnce("CLASS foreign.")
    await expect(deployInstallation(input, "assets")).rejects.toThrow("unversioned")
    expect(client.setObjectSource).not.toHaveBeenCalled()
    expect(client.createObject).not.toHaveBeenCalled()
  })
  it("does not interpret an authorization failure as permission to create", async () => {
    client.getObjectSource.mockRejectedValue({ status: 403 })
    await expect(deployInstallation(input, "assets")).rejects.toThrow()
    expect(client.createObject).not.toHaveBeenCalled()
  })
  it("does not create objects when the existence search fails", async () => {
    client.searchObject.mockRejectedValueOnce(new Error("Search unavailable"))
    await expect(deployInstallation(input, "assets")).rejects.toThrow("Search unavailable")
    expect(client.createObject).not.toHaveBeenCalled()
    expect(client.setObjectSource).not.toHaveBeenCalled()
  })
  it("refuses existing inactive changes", async () => {
    client.inactiveObjects.mockResolvedValue([{ object: { "adtcore:uri": SAP_OBJECTS[0].path } }])
    await expect(deployInstallation(input, "assets")).rejects.toThrow("inactive changes")
    expect(client.lock).not.toHaveBeenCalled()
  })
  it("saves and verifies all sources before batch activation", async () => {
    const statefulModesAtLock: unknown[] = []
    client.lock.mockImplementation(async () => {
      statefulModesAtLock.push(client.stateful)
      return { LOCK_HANDLE: "example-lock" }
    })
    const result = await deployInstallation(input, "assets")
    expect(ensureConnected).toHaveBeenCalledWith("example", false)
    expect(statefulModesAtLock).toHaveLength(4)
    expect(statefulModesAtLock.every(mode => mode === session_types.stateful)).toBe(true)
    expect(client.stateful).toBe(session_types.stateless)
    expect(result.completed).toEqual(SAP_OBJECTS.map(object => object.name))
    expect(client.setObjectSource).toHaveBeenCalledTimes(4)
    expect(client.unLock).toHaveBeenCalledTimes(4)
    expect(client.httpClient.request).toHaveBeenCalledTimes(2)
    const payloadActivation = client.httpClient.request.mock.calls[0]
    expect(payloadActivation[0]).toBe("/sap/bc/adt/activation")
    expect(payloadActivation[1].body).toContain("ZCL_ABAPFS_DIAG")
    expect(payloadActivation[1].body).not.toContain('adtcore:parentUri=""')
    for (let index = 0; index < 4; index++) {
      const path = [...SAP_OBJECTS, SICF_REPORT][index].path
      expect(client.unLock.mock.calls[index]).toEqual([path, "example-lock"])
      expect(client.setObjectSource.mock.invocationCallOrder[index]).toBeLessThan(
        client.unLock.mock.invocationCallOrder[index]
      )
      const readbacks = client.getObjectSource.mock.calls
        .map((args, readIndex) => ({
          args,
          order: client.getObjectSource.mock.invocationCallOrder[readIndex]
        }))
        .filter(
          read =>
            read.args[0] === `${path}/source/main` &&
            read.order > client.unLock.mock.invocationCallOrder[index]
        )
      expect(readbacks.length).toBeGreaterThan(0)
      expect(readbacks[0].order).toBeLessThan(
        client.httpClient.request.mock.invocationCallOrder[index < 3 ? 0 : 1]
      )
    }
  })
  it("does not activate when releasing a saved object's lock fails", async () => {
    client.unLock.mockRejectedValueOnce(new Error("Unlock failed"))
    await expect(deployInstallation(input, "assets")).rejects.toThrow("Unlock failed")
    expect(client.setObjectSource).toHaveBeenCalledTimes(1)
    expect(client.activate).not.toHaveBeenCalled()
    expect(client.stateful).toBe(session_types.stateless)
  })
  it("releases locks after failed source saves and does not activate", async () => {
    client.setObjectSource.mockRejectedValue(new Error("save failed"))
    await expect(deployInstallation(input, "assets")).rejects.toThrow("save failed")
    expect(client.unLock).toHaveBeenCalledTimes(1)
    expect(client.activate).not.toHaveBeenCalled()
  })
  it("reports an object created before a stateful source lock fails", async () => {
    client.searchObject.mockResolvedValue([])
    client.lock.mockRejectedValue(
      new Error("This operation can only be performed in stateful mode")
    )
    await expect(deployInstallation(input, "assets")).rejects.toThrow(
      `Saved objects: none. Created objects: ${SAP_OBJECTS[0].name}. This operation can only be performed in stateful mode`
    )
    expect(client.createObject).toHaveBeenCalledTimes(1)
    expect(client.stateful).toBe(session_types.stateless)
  })
  it("detects mismatched saved source", async () => {
    let writeStarted = false
    client.setObjectSource.mockImplementation(async () => {
      writeStarted = true
    })
    client.getObjectSource.mockImplementation(async () => (writeStarted ? "different\n" : header))
    vi.useFakeTimers()
    try {
      const expectedFailure = expect(deployInstallation(input, "assets")).rejects.toThrow(
        "does not match"
      )
      await vi.runAllTimersAsync()
      await expectedFailure
      expect(client.unLock).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
  it("surfaces activation errors and saved objects", async () => {
    client.httpClient.request.mockRejectedValueOnce(new Error("Activation condition failed"))
    await expect(deployInstallation(input, "assets")).rejects.toThrow("Activation condition failed")
    expect(refreshPackage).not.toHaveBeenCalled()
  })
  it("supports cancellation before saving", async () => {
    await expect(deployInstallation(input, "assets", () => true)).rejects.toThrow("cancelled")
    expect(client.setObjectSource).not.toHaveBeenCalled()
  })
  it.each([undefined, "old"])("is not ready for service version %s", async VERSION => {
    vi.mocked(callEngine).mockResolvedValue({ STATUS: "ok", VERSION })
    expect((await checkInstallation("example")).ready).toBe(false)
  })
  it("retries only services that are not ready", async () => {
    vi.useFakeTimers()
    const attempts = new Map<string, number>()
    let releaseSecondService!: () => void
    const secondServiceStarted = new Promise<void>(resolve => {
      releaseSecondService = resolve
    })
    vi.mocked(callEngine).mockImplementation(async (_connectionId, _request, service) => {
      const path = service ?? ""
      const count = (attempts.get(path) ?? 0) + 1
      attempts.set(path, count)
      if (path === SAP_OBJECTS[0].service) return { STATUS: "ok", VERSION: ENGINE_VERSION }
      if (count === 1) {
        releaseSecondService()
        throw new Error("Service is starting")
      }
      return { STATUS: "ok", VERSION: ENGINE_VERSION }
    })
    const progress: string[] = []
    try {
      const setup = provisionServices(
        input,
        "assets",
        () => false,
        text => progress.push(text)
      )
      await secondServiceStarted
      await vi.advanceTimersByTimeAsync(5_000)
      await expect(setup).resolves.toMatchObject({ installation: { ready: true } })
      expect(attempts.get(SAP_OBJECTS[0].service!)).toBe(1)
      expect(attempts.get(SAP_OBJECTS[1].service!)).toBe(2)
      expect(progress).toContain(`SICF service ${SAP_OBJECTS[0].service} is available`)
    } finally {
      vi.useRealTimers()
    }
  })
  it.each([undefined, "old"])(
    "retries a responding service until version %s becomes current",
    async VERSION => {
      vi.useFakeTimers()
      const attempts = new Map<string, number>()
      let releaseStaleService!: () => void
      const staleServiceStarted = new Promise<void>(resolve => {
        releaseStaleService = resolve
      })
      vi.mocked(callEngine).mockImplementation(async (_connectionId, _request, service) => {
        const path = service ?? ""
        const count = (attempts.get(path) ?? 0) + 1
        attempts.set(path, count)
        if (path === SAP_OBJECTS[0].service && count === 1) {
          releaseStaleService()
          return { STATUS: "ok", VERSION }
        }
        return { STATUS: "ok", VERSION: ENGINE_VERSION }
      })
      const progress: string[] = []
      try {
        const setup = provisionServices(
          input,
          "assets",
          () => false,
          text => progress.push(text)
        )
        await staleServiceStarted
        await vi.advanceTimersByTimeAsync(5_000)
        await expect(setup).resolves.toMatchObject({ installation: { ready: true } })
        expect(attempts.get(SAP_OBJECTS[0].service!)).toBe(2)
        expect(attempts.get(SAP_OBJECTS[1].service!)).toBe(1)
        expect(progress).toContain(
          `SICF service ${SAP_OBJECTS[0].service} reports version ${VERSION ?? "not reported"}; waiting for ${ENGINE_VERSION}`
        )
      } finally {
        vi.useRealTimers()
      }
    }
  )
  it("keeps retrying a stale service until the two-minute deadline", async () => {
    vi.useFakeTimers()
    let releaseStaleService!: () => void
    const staleServiceStarted = new Promise<void>(resolve => {
      releaseStaleService = resolve
    })
    vi.mocked(callEngine).mockImplementation(async (_connectionId, _request, service) => {
      if (service === SAP_OBJECTS[0].service) {
        releaseStaleService()
        return { STATUS: "ok", VERSION: "old" }
      }
      return { STATUS: "ok", VERSION: ENGINE_VERSION }
    })
    try {
      const setup = provisionServices(input, "assets")
      await staleServiceStarted
      await vi.advanceTimersByTimeAsync(120_000)
      await expect(setup).resolves.toMatchObject({
        installation: {
          ready: false,
          services: expect.arrayContaining([
            expect.objectContaining({
              path: SAP_OBJECTS[0].service,
              reachable: true,
              version: "old",
              expectedVersion: ENGINE_VERSION,
              error: expect.stringContaining("within 2 minutes")
            })
          ])
        }
      })
      expect(
        vi.mocked(callEngine).mock.calls.filter(call => call[2] === SAP_OBJECTS[0].service)
      ).toHaveLength(25)
      expect(
        vi.mocked(callEngine).mock.calls.filter(call => call[2] === SAP_OBJECTS[1].service)
      ).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
  it("reports application-level service errors", async () => {
    vi.mocked(callEngine).mockResolvedValue({
      STATUS: "error",
      MESSAGES: ["Forbidden", "Check role"]
    })
    const result = await checkInstallation("example")
    expect(result.services.every(service => service.error === "Forbidden; Check role")).toBe(true)
    expect(result.ready).toBe(false)
  })
  it("refuses accidental package moves", async () => {
    client.transportInfo.mockResolvedValue({ TADIRDEVC: "ZOTHER", DEVCLASS: "$TMP" })
    await expect(deployInstallation(input, "assets")).rejects.toThrow("package moves")
    expect(client.lock).not.toHaveBeenCalled()
  })
  it("refuses objects assigned to another request", async () => {
    client.transportInfo.mockResolvedValue({
      DEVCLASS: "ZCFG",
      LOCKS: { HEADER: { TRKORR: "EXAK900002" }, TASKS: [] }
    })
    await expect(
      deployInstallation({ ...input, packageName: "ZCFG", transport: "EXAK900001" }, "assets")
    ).rejects.toThrow("assigned to EXAK900002")
    expect(client.setObjectSource).not.toHaveBeenCalled()
  })

  it.each(["EXAK900001", "EXAK900002"])(
    "accepts the assigned request or its task %s",
    async transport => {
      client.transportInfo.mockResolvedValue({
        DEVCLASS: "ZCFG",
        LOCKS: { HEADER: { TRKORR: "EXAK900001" }, TASKS: [{ TRKORR: "EXAK900002" }] }
      })
      client.transportInfo.mockImplementation(async (path: string) =>
        path.startsWith(SICF_REPORT.path)
          ? { DEVCLASS: "$TMP" }
          : {
              DEVCLASS: "ZCFG",
              LOCKS: { HEADER: { TRKORR: "EXAK900001" }, TASKS: [{ TRKORR: "EXAK900002" }] }
            }
      )
      await deployInstallation({ ...input, packageName: "ZCFG", transport }, "assets")
      expect(
        client.setObjectSource.mock.calls.slice(0, 3).every(call => call[3] === transport)
      ).toBe(true)
      expect(client.setObjectSource.mock.calls[3][3]).toBeUndefined()
      expect(findPackage.mock.calls.map(([path]) => path)).toEqual([objectPath("DEVC/K", "ZCFG")])
      expect(getTmpPackage).toHaveBeenCalledExactlyOnceWith()
      expect(refreshPackage).toHaveBeenCalledTimes(2)
      expect(client.httpClient.request.mock.invocationCallOrder[1]).toBeLessThan(
        refreshPackage.mock.invocationCallOrder[0]
      )
    }
  )
  it("creates absent objects sequentially before saving each source", async () => {
    client.searchObject.mockImplementation(async (name: string, type: string) =>
      name === SICF_REPORT.name
        ? [{ "adtcore:name": name, "adtcore:type": type, "adtcore:uri": "" }]
        : []
    )
    await deployInstallation(input, "assets")
    expect(client.createObject).toHaveBeenCalledTimes(3)
    expect(refreshPackage).toHaveBeenCalledTimes(1)
    expect(client.httpClient.request.mock.invocationCallOrder[1]).toBeLessThan(
      refreshPackage.mock.invocationCallOrder[0]
    )
    expect(client.objectStructure).not.toHaveBeenCalled()
    for (let index = 0; index < 3; index++) {
      expect(client.createObject.mock.calls[index][0]).toMatchObject({
        name: SAP_OBJECTS[index].name,
        parentName: "$TMP",
        transport: undefined
      })
      expect(client.createObject.mock.invocationCallOrder[index]).toBeLessThan(
        client.lock.mock.invocationCallOrder[index]
      )
      if (index < 2)
        expect(client.unLock.mock.invocationCallOrder[index]).toBeLessThan(
          client.createObject.mock.invocationCallOrder[index + 1]
        )
    }
  })
  it("does not activate unrelated inactive objects", async () => {
    client.inactiveObjects.mockResolvedValue([
      { object: { "adtcore:uri": "/sap/bc/adt/oo/classes/zunrelated" } }
    ])
    await deployInstallation(input, "assets")
    for (const object of SAP_OBJECTS)
      expect(client.httpClient.request.mock.calls[0][1].body).toContain(object.path)
  })
  it("reports partial saves and skips activation on later failure", async () => {
    client.setObjectSource
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Second save failed"))
    await expect(deployInstallation(input, "assets")).rejects.toThrow(
      `Saved objects: ${SAP_OBJECTS[0].name}`
    )
    expect(client.unLock).toHaveBeenCalledTimes(2)
    expect(client.activate).not.toHaveBeenCalled()
  })
  it("does not attempt unlock if acquiring the lock fails", async () => {
    client.lock.mockRejectedValue(new Error("Locked by another editor"))
    await expect(deployInstallation(input, "assets")).rejects.toThrow("Locked by another editor")
    expect(client.unLock).not.toHaveBeenCalled()
    expect(client.setObjectSource).not.toHaveBeenCalled()
  })
  it("serializes deployments to the same system", async () => {
    let release!: (value: never[]) => void
    client.inactiveObjects.mockReturnValueOnce(
      new Promise<never[]>(resolve => {
        release = resolve
      })
    )
    const first = deployInstallation(input, "assets")
    await vi.waitFor(() => expect(client.inactiveObjects).toHaveBeenCalled())
    await expect(deployInstallation(input, "assets")).rejects.toThrow("already running")
    release([])
    await first
  })
  it("configures services independently without redeploying imported handlers", async () => {
    let statefulModeAtLock: unknown
    client.lock.mockImplementation(async () => {
      statefulModeAtLock = client.stateful
      return { LOCK_HANDLE: "example-lock" }
    })
    await provisionServices(input, "assets")
    expect(ensureConnected).toHaveBeenCalledWith("example", false)
    expect(statefulModeAtLock).toBe(session_types.stateful)
    expect(client.stateful).toBe(session_types.stateless)
    expect(loadPayload).not.toHaveBeenCalled()
    expect(client.setObjectSource).toHaveBeenCalledExactlyOnceWith(
      `${SICF_REPORT.path}/source/main`,
      buildSicfReport("$TMP"),
      "example-lock",
      undefined
    )
    expect(client.unitTestRun).toHaveBeenCalledWith(
      `${SICF_REPORT.path}/source/main`,
      expect.objectContaining({ dangerous: false, harmless: true })
    )
  })
  it("refuses service provisioning with mismatched active handlers", async () => {
    client.getObjectSource.mockResolvedValueOnce("* ABAP FS Customizing old\n")
    await expect(provisionServices(input, "assets")).rejects.toThrow("Install and activate")
    expect(client.createObject).not.toHaveBeenCalled()
    expect(client.unitTestRun).not.toHaveBeenCalled()
  })
  it("does not overwrite a foreign installer report", async () => {
    client.getObjectSource
      .mockResolvedValueOnce(header)
      .mockResolvedValueOnce(header)
      .mockResolvedValueOnce("REPORT foreign.")
    await expect(provisionServices(input, "assets")).rejects.toThrow("unversioned")
    expect(client.setObjectSource).not.toHaveBeenCalled()
  })
  it("creates the local installer when absent", async () => {
    client.searchObject.mockImplementation(async (name: string, type: string) =>
      name === SICF_REPORT.name
        ? []
        : [{ "adtcore:name": name, "adtcore:type": type, "adtcore:uri": "" }]
    )
    await provisionServices(input, "assets")
    expect(client.createObject).toHaveBeenCalledWith(
      expect.objectContaining({ name: SICF_REPORT.name, parentName: "$TMP" })
    )
  })
  it.each([
    { result: [] },
    { result: [{ "adtcore:name": "LTC_SETUP", alerts: [], testmethods: [] }] }
  ])("rejects skipped installer execution %#", async ({ result }) => {
    client.unitTestRun.mockResolvedValue(result)
    await expect(provisionServices(input, "assets")).rejects.toThrow("did not execute")
  })
  it("surfaces execution failures without pretending they rolled back", async () => {
    client.unitTestRun.mockResolvedValueOnce([
      {
        "adtcore:name": "LTC_SETUP",
        alerts: [],
        testmethods: [
          {
            "adtcore:name": "RUN_SETUP",
            alerts: [{ kind: "failedAssertion", title: "No authorization", details: [] }]
          }
        ]
      }
    ])
    await expect(provisionServices(input, "assets")).rejects.toThrow(
      "Changes may already have been committed"
    )
  })
  it("cancels before provisioning without writes", async () => {
    await expect(provisionServices(input, "assets", () => true)).rejects.toThrow("cancelled")
    expect(client.setObjectSource).not.toHaveBeenCalled()
  })
  it("does not run the installer after activation failure", async () => {
    client.httpClient.request.mockRejectedValueOnce(new Error("Activation condition failed"))
    await expect(provisionServices(input, "assets")).rejects.toThrow("Activation condition failed")
    expect(client.unitTestRun).not.toHaveBeenCalled()
    expect(refreshPackage).not.toHaveBeenCalled()
  })
  it("refuses inactive installer changes", async () => {
    client.inactiveObjects.mockResolvedValue([{ object: { "adtcore:uri": SICF_REPORT.path } }])
    await expect(provisionServices(input, "assets")).rejects.toThrow("inactive changes")
    expect(client.setObjectSource).not.toHaveBeenCalled()
  })
  it("clears the deployment lock after failure", async () => {
    await expect(deployInstallation(input, "assets", () => true)).rejects.toThrow()
    await expect(deployInstallation(input, "assets")).resolves.toHaveProperty("completed")
  })
})
