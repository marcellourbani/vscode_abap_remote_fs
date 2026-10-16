const mocks = vi.hoisted(() => ({
  textDocuments: [] as any[]
}))

vi.mock("vscode", () => ({
  EventEmitter: vi.fn().mockImplementation(function () {
    return {
      event: "mockEvent",
      fire: vi.fn()
    }
  }),
  QuickPickItemKind: { Separator: -1 },
  workspace: {
    get textDocuments() {
      return mocks.textDocuments
    }
  },
  Uri: {
    parse: vi.fn(function (s: string) {
      return {
        scheme: "adt",
        authority: "conn",
        path: s,
        toString: () => s
      }
    }),
    from: vi.fn(function (parts: { scheme: string; authority: string; path: string }) {
      return {
        ...parts,
        toString: () => `${parts.scheme}://${parts.authority}${parts.path}`
      }
    })
  }
}))

vi.mock("../conections", () => ({
  ADTSCHEME: "adt",
  getClient: vi.fn(),
  getRoot: vi.fn()
}))

vi.mock("abapfs", () => ({
  isAbapFile: vi.fn(function (file: any) {
    return !!file?.object
  }),
  isAbapStat: vi.fn(function (file: any) {
    return !!file?.object
  })
}))

vi.mock("../includes", () => ({
  IncludeService: {
    get: vi.fn().mockReturnValue({
      needMain: vi.fn().mockReturnValue(false),
      current: vi.fn().mockReturnValue(null),
      candidates: vi.fn().mockResolvedValue(undefined)
    })
  },
  IncludeProvider: {
    get: vi.fn().mockReturnValue({
      switchIncludeIfMissing: vi.fn().mockResolvedValue(null)
    })
  }
}))

vi.mock("../../lib", () => ({
  isDefined: vi.fn(function (x: any) {
    return x !== undefined && x !== null
  }),
  caughtToString: vi.fn(function (e: any) {
    return `${e?.message || e}`
  }),
  createMutex: function () {
    const pending = new Map<string, Promise<unknown>>()
    return (key: string, cb: () => Promise<unknown>) => {
      const result = (pending.get(key) || Promise.resolve()).then(cb)
      pending.set(
        key,
        result.catch(() => undefined)
      )
      return result
    }
  },
  channel: { appendLine: vi.fn() }
}))

vi.mock("abap-adt-api", () => ({
  isAdtError: vi.fn(),
  session_types: { stateful: "stateful" }
}))

vi.mock("../../services/funMessenger", () => ({
  funWindow: {
    showQuickPick: vi.fn(),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    withProgress: vi.fn()
  }
}))

vi.mock("abapobject", () => ({}))

import { AdtObjectActivator } from "./AdtObjectActivator"
import { getClient, getRoot } from "../conections"
import { IncludeProvider, IncludeService } from "../includes"
import { funWindow } from "../../services/funMessenger"
import type { Mock } from "vitest"

const mockGetClient = getClient as Mock
const mockGetRoot = getRoot as Mock
const mockShowQuickPick = funWindow.showQuickPick as unknown as Mock

const programUri = "/sap/bc/adt/programs/programs/ztest"
const includeUri = "/sap/bc/adt/programs/includes/ztest_i01"
const classUri = "/sap/bc/adt/oo/classes/zcl_test"
const success = { success: true, messages: [], inactive: [] }
const failure = (text: string, inactive: any[] = []) => ({
  success: false,
  messages: [{ type: "E", shortText: text, href: "", objDescr: "" }],
  inactive
})

const inactiveObject = {
  "adtcore:name": "ZTEST_I01",
  "adtcore:type": "PROG/I",
  "adtcore:uri": includeUri,
  "adtcore:parentUri": programUri,
  user: "DEVELOPER",
  deleted: false
}

const inactive = (name: string, type: string, uri: string, parentUri: string) => ({
  "adtcore:name": name,
  "adtcore:type": type,
  "adtcore:uri": uri,
  "adtcore:parentUri": parentUri,
  user: "DEVELOPER",
  deleted: false
})

const abapObject = (fields: { name: string; type: string; path: string }, lockObject?: any) => {
  const object: any = {
    ...fields,
    structure: undefined,
    loadStructure: vi.fn(async function () {
      object.structure = { metaData: { "adtcore:version": "active" } }
      return object.structure
    })
  }
  object.lockObject = lockObject || object
  return object
}

const vsUri = (path: string) => ({ scheme: "adt", authority: "conn", path }) as any

const pickFirstObject = () =>
  mockShowQuickPick.mockImplementation(async (items: any[]) =>
    items.filter(item => "object" in item).slice(0, 1)
  )

describe("AdtObjectActivator", () => {
  let mockStatelessClient: any
  let mockClient: any
  let mockRoot: any
  let includeService: any

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.textDocuments = []
    AdtObjectActivator["instances"].clear()

    mockStatelessClient = {
      activate: vi.fn(),
      inactiveObjects: vi.fn().mockResolvedValue([]),
      statelessClone: {
        nodeContents: vi.fn().mockResolvedValue({ nodes: [] }),
        login: vi.fn()
      },
      nodeContents: vi.fn().mockResolvedValue({ nodes: [] }),
      httpClient: {
        request: vi.fn().mockResolvedValue({ body: "" })
      }
    }
    mockClient = {
      ...mockStatelessClient,
      statelessClone: mockStatelessClient
    }
    mockGetClient.mockReturnValue(mockClient)
    mockRoot = {
      findByAdtUri: vi.fn().mockResolvedValue(undefined),
      getNode: vi.fn(),
      service: { invalidateStructCache: vi.fn() }
    }
    mockGetRoot.mockReturnValue(mockRoot)
    includeService = IncludeService.get("testconn") as any
    includeService.needMain.mockReturnValue(false)
    includeService.current.mockReturnValue(null)
    ;(IncludeProvider.get() as any).switchIncludeIfMissing.mockResolvedValue(null)
    mockShowQuickPick.mockResolvedValue(undefined)
  })

  it("creates an instance via get()", () => {
    const instance = AdtObjectActivator.get("testconn")
    expect(instance).toBeDefined()
    expect(instance).toBeInstanceOf(AdtObjectActivator)
  })

  it("get() returns the same instance for same connId", () => {
    const a = AdtObjectActivator.get("conn1")
    const b = AdtObjectActivator.get("conn1")
    expect(a).toBe(b)
  })

  it("get() returns different instances for different connIds", () => {
    const a = AdtObjectActivator.get("conn1")
    const b = AdtObjectActivator.get("conn2")
    expect(a).not.toBe(b)
  })

  it("onActivate returns an event", () => {
    const instance = AdtObjectActivator.get("conn3")
    expect(instance.onActivate).toBeDefined()
  })

  it("uses the main client of the connection", () => {
    AdtObjectActivator.get("conn4")
    expect(mockGetClient).toHaveBeenCalledWith("conn4", false)
  })

  describe("inactive objects", () => {
    it("parses object references from the raw XML fallback", async () => {
      mockClient.inactiveObjects.mockResolvedValueOnce([])
      mockClient.httpClient.request.mockResolvedValueOnce({
        body: `<?xml version="1.0" encoding="utf-8"?>
          <adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
            <adtcore:objectReference
              adtcore:uri="/sap/bc/adt/programs/includes/ztest_i01"
              adtcore:type="PROG/I"
              adtcore:name="ZTEST_I01"/>
          </adtcore:objectReferences>`
      })
      const activator = AdtObjectActivator.get("conn5")

      const result = await activator.getInactiveObjects()

      expect(mockClient.httpClient.request).toHaveBeenCalledWith(
        "/sap/bc/adt/activation/inactiveobjects",
        { headers: { Accept: "application/xml" } }
      )
      expect(result).toEqual([
        {
          "adtcore:uri": "/sap/bc/adt/programs/includes/ztest_i01",
          "adtcore:type": "PROG/I",
          "adtcore:name": "ZTEST_I01",
          "adtcore:parentUri": "",
          user: "",
          deleted: false
        }
      ])
    })

    it("does not fall back when the library returns inactive objects", async () => {
      mockClient.inactiveObjects.mockResolvedValueOnce([{ object: inactiveObject }])
      const activator = AdtObjectActivator.get("conn5")

      expect(await activator.getInactiveObjects()).toEqual([inactiveObject])
      expect(mockClient.httpClient.request).not.toHaveBeenCalled()
    })
  })

  describe("activateMultiple", () => {
    it("omits an empty parent URI when activating fallback object references", async () => {
      const inactiveXml = `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
        <adtcore:objectReference
          adtcore:uri="/sap/bc/adt/programs/programs/ztest"
          adtcore:type="PROG/P"
          adtcore:name="ZTEST"/>
      </adtcore:objectReferences>`
      mockClient.inactiveObjects.mockResolvedValue([])
      mockClient.httpClient.request
        .mockResolvedValueOnce({ body: inactiveXml })
        .mockResolvedValueOnce({ body: "" })
        .mockResolvedValueOnce({
          body: `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"/>`
        })
      const activator = AdtObjectActivator.get("conn5")

      const result = await activator.activateMultiple(false, [
        "/sap/bc/adt/programs/programs/ztest"
      ])

      const activationRequest = mockClient.httpClient.request.mock.calls[1]
      expect(activationRequest[0]).toBe("/sap/bc/adt/activation")
      expect(activationRequest[1].body).not.toContain("adtcore:parentUri")
      expect(result.ok).toBe(true)
    })

    it("reuses main-program resolution when activating a fallback include", async () => {
      const mainUri = "/sap/bc/adt/programs/programs/ztest"
      const inactiveXml = `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
        <adtcore:objectReference
          adtcore:uri="${includeUri}"
          adtcore:type="PROG/I"
          adtcore:name="ZTEST_I01"/>
      </adtcore:objectReferences>`
      mockClient.inactiveObjects.mockResolvedValue([])
      mockClient.httpClient.request
        .mockResolvedValueOnce({ body: inactiveXml })
        .mockResolvedValueOnce({ body: "" })
        .mockResolvedValueOnce({
          body: `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"/>`
        })
      const includeObject = { type: "PROG/I" }
      mockRoot.findByAdtUri.mockResolvedValue({
        path: "/$TMP/Source Library/Includes/ZTEST_I01.prog.abap",
        file: { object: includeObject }
      })
      includeService.needMain.mockReturnValue(true)
      includeService.current.mockReturnValue({ "adtcore:uri": mainUri })
      const activator = AdtObjectActivator.get("conn5")

      await activator.activateMultiple(false, [includeUri])

      const activationRequest = mockClient.httpClient.request.mock.calls[1]
      expect(activationRequest[1].body).toContain(
        `${includeUri}?context=${encodeURIComponent(mainUri)}`
      )
    })

    describe("include activated together with its main program", () => {
      const emptyList = `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"/>`
      const mainContext = `${includeUri}?context=${encodeURIComponent(`${programUri}/source/main`)}`

      beforeEach(() => {
        mockClient.inactiveObjects.mockResolvedValue([])
        mockRoot.findByAdtUri.mockResolvedValue({
          path: "/$TMP/Source Library/Includes/ZTEST_I01.prog.abap",
          file: { object: { type: "PROG/I" } }
        })
        includeService.needMain.mockReturnValue(true)
        includeService.current.mockReturnValue({ "adtcore:uri": `${programUri}/source/main` })
      })

      const inactiveXml = `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
        <adtcore:objectReference adtcore:uri="${programUri}" adtcore:type="PROG/P" adtcore:name="ZTEST"/>
        <adtcore:objectReference adtcore:uri="${includeUri}" adtcore:type="PROG/I" adtcore:name="ZTEST_I01"/>
      </adtcore:objectReferences>`

      it("keeps the context a never activated program needs", async () => {
        mockClient.httpClient.request
          .mockResolvedValueOnce({ body: inactiveXml })
          .mockResolvedValueOnce({ body: "" })
          .mockResolvedValueOnce({ body: emptyList })
        const activator = AdtObjectActivator.get("conn5")

        const result = await activator.activateMultiple(false, [programUri, includeUri])

        expect(result.ok).toBe(true)
        expect(mockClient.httpClient.request.mock.calls[1][1].body).toContain(mainContext)
        expect(mockClient.httpClient.request).toHaveBeenCalledTimes(3)
      })

      it("retries without context when the active program lacks the new INCLUDE", async () => {
        mockClient.httpClient.request
          .mockResolvedValueOnce({ body: inactiveXml })
          .mockRejectedValueOnce({
            type: "invalidMainProgram",
            message: "Master program ZTEST is invalid for include ZTEST_I01"
          })
          .mockResolvedValueOnce({ body: "" })
          .mockResolvedValueOnce({ body: emptyList })
        const activator = AdtObjectActivator.get("conn5")

        const result = await activator.activateMultiple(false, [programUri, includeUri])

        expect(result.ok).toBe(true)
        expect(mockClient.httpClient.request.mock.calls[1][1].body).toContain(mainContext)
        const retryBody = mockClient.httpClient.request.mock.calls[2][1].body
        expect(retryBody).toContain(`adtcore:uri="${includeUri}"`)
        expect(retryBody).not.toContain("context=")
      })

      it("does not retry when the main program is not part of the batch", async () => {
        const includeOnly = `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
          <adtcore:objectReference adtcore:uri="${includeUri}" adtcore:type="PROG/I" adtcore:name="ZTEST_I01"/>
        </adtcore:objectReferences>`
        mockClient.httpClient.request
          .mockResolvedValueOnce({ body: includeOnly })
          .mockRejectedValueOnce({ type: "invalidMainProgram", message: "Master program invalid" })
          .mockResolvedValueOnce({ body: includeOnly })
        const activator = AdtObjectActivator.get("conn5")

        const result = await activator.activateMultiple(false, [includeUri])

        expect(result.ok).toBe(false)
        expect(
          mockClient.httpClient.request.mock.calls.filter(
            (call: unknown[]) => call[0] === "/sap/bc/adt/activation"
          )
        ).toHaveLength(1)
      })
    })

    it("resolves include main programs one at a time", async () => {
      const otherIncludeUri = "/sap/bc/adt/programs/includes/ztest_f01"
      const inactiveXml = `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
        <adtcore:objectReference adtcore:uri="${includeUri}" adtcore:type="PROG/I" adtcore:name="ZTEST_I01"/>
        <adtcore:objectReference adtcore:uri="${otherIncludeUri}" adtcore:type="PROG/I" adtcore:name="ZTEST_F01"/>
      </adtcore:objectReferences>`
      mockClient.inactiveObjects.mockResolvedValue([])
      mockClient.httpClient.request
        .mockResolvedValueOnce({ body: inactiveXml })
        .mockResolvedValueOnce({ body: "" })
        .mockResolvedValueOnce({ body: "" })
      mockRoot.findByAdtUri.mockImplementation(async (uri: string) => ({
        path: `/Source Library/${uri.split("/").pop()}`,
        file: { object: { type: "PROG/I" } }
      }))
      includeService.needMain.mockReturnValue(true)
      let running = 0
      let maxRunning = 0
      ;(IncludeProvider.get() as any).switchIncludeIfMissing.mockImplementation(async () => {
        running++
        maxRunning = Math.max(maxRunning, running)
        await new Promise(resolve => setTimeout(resolve, 5))
        running--
        return { "adtcore:uri": programUri, "adtcore:name": "ZTEST" }
      })
      const activator = AdtObjectActivator.get("conn5")

      await activator.activateMultiple(false, [includeUri, otherIncludeUri])

      expect(maxRunning).toBe(1)
      const body = mockClient.httpClient.request.mock.calls[1][1].body
      const context = `?context=${encodeURIComponent(programUri)}`
      expect(body).toContain(`${includeUri}${context}`)
      expect(body).toContain(`${otherIncludeUri}${context}`)
    })

    it("preserves activation failure messages from the raw XML response", async () => {
      const inactiveXml = `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
        <adtcore:objectReference
          adtcore:uri="/sap/bc/adt/programs/programs/ztest"
          adtcore:type="PROG/P"
          adtcore:name="ZTEST"/>
      </adtcore:objectReferences>`
      mockClient.inactiveObjects.mockResolvedValue([])
      mockClient.httpClient.request
        .mockResolvedValueOnce({ body: inactiveXml })
        .mockResolvedValueOnce({
          body: `<chkl:messages xmlns:chkl="http://www.sap.com/adt/checkresults">
            <msg type="E" objDescr="Program ZTEST">
              <shortText><txt>Dependent include is inactive</txt></shortText>
            </msg>
          </chkl:messages>`
        })
        .mockResolvedValueOnce({ body: inactiveXml })
      const activator = AdtObjectActivator.get("conn5")

      const result = await activator.activateMultiple(false, [
        "/sap/bc/adt/programs/programs/ztest"
      ])

      expect(result.ok).toBe(false)
      expect(result.summary).toContain("Dependent include is inactive")
      expect(result.stillInactiveObjects).toHaveLength(1)
    })

    it("treats objects SAP wants activated together as a failure", async () => {
      const inactiveXml = `<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
        <adtcore:objectReference adtcore:uri="${programUri}" adtcore:type="PROG/P" adtcore:name="ZTEST"/>
      </adtcore:objectReferences>`
      mockClient.inactiveObjects.mockResolvedValue([])
      mockClient.httpClient.request
        .mockResolvedValueOnce({ body: inactiveXml })
        .mockResolvedValueOnce({
          body: `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects">
            <ioc:entry>
              <ioc:object ioc:user="DEVELOPER" ioc:deleted="false">
                <ioc:ref adtcore:uri="${includeUri}" adtcore:type="PROG/I" adtcore:name="ZTEST_I01" adtcore:parentUri=""/>
              </ioc:object>
            </ioc:entry>
          </ioc:inactiveObjects>`
        })
        .mockResolvedValueOnce({ body: inactiveXml })
      const activator = AdtObjectActivator.get("conn5")

      const result = await activator.activateMultiple(false, [programUri])

      expect(result.ok).toBe(false)
      expect(result.summary).toContain("must be activated together")
      expect(result.summary).toContain("ZTEST_I01")
    })

    it("activates selected inactive objects in one request and verifies them", async () => {
      const relatedInclude = {
        ...inactiveObject,
        "adtcore:name": "ZTEST_C01",
        "adtcore:uri": "/sap/bc/adt/programs/includes/ztest_c01"
      }
      mockClient.inactiveObjects
        .mockResolvedValueOnce([{ object: inactiveObject }, { object: relatedInclude }])
        .mockResolvedValueOnce([])
      mockClient.activate.mockResolvedValue(success)
      const activator = AdtObjectActivator.get("conn5")

      const result = await activator.activateMultiple(false, [
        inactiveObject["adtcore:uri"],
        relatedInclude["adtcore:uri"]
      ])

      expect(mockClient.activate).toHaveBeenCalledTimes(1)
      expect(mockClient.activate).toHaveBeenCalledWith([inactiveObject, relatedInclude])
      expect(result.ok).toBe(true)
      expect(result.selectedCount).toBe(2)
      expect(result.stillInactiveObjects).toEqual([])
      expect(activator["emitter"].fire).toHaveBeenCalledWith({
        connectionId: "conn5",
        objects: [inactiveObject, relatedInclude]
      })
      expect(mockRoot.service.invalidateStructCache).toHaveBeenCalledWith(includeUri)
    })

    describe("related objects left inactive", () => {
      const main = inactive("ZTEST", "PROG/P", programUri, "/sap/bc/adt/packages/ztmp")
      const otherIncludeUri = "/sap/bc/adt/programs/includes/ztest_c01"
      const otherInclude = inactive("ZTEST_C01", "PROG/I", otherIncludeUri, programUri)
      const includeNodes = {
        nodes: [
          { OBJECT_TYPE: "PROG/I", OBJECT_NAME: "ZTEST_I01", OBJECT_URI: includeUri },
          { OBJECT_TYPE: "PROG/I", OBJECT_NAME: "ZTEST_C01", OBJECT_URI: otherIncludeUri }
        ]
      }

      it("reports inactive includes of a submitted program", async () => {
        mockClient.inactiveObjects
          .mockResolvedValueOnce([{ object: main }, { object: inactiveObject }])
          .mockResolvedValueOnce([{ object: inactiveObject }])
        mockClient.activate.mockResolvedValue(success)
        mockStatelessClient.nodeContents.mockResolvedValue(includeNodes)
        const activator = AdtObjectActivator.get("conn6")

        const result = await activator.activateMultiple(false, [programUri])

        expect(mockClient.activate).toHaveBeenCalledWith([main])
        expect(result.ok).toBe(true)
        expect(result.stillInactiveObjects).toEqual([])
        expect(result.relatedStillInactive).toEqual([inactiveObject])
        expect(result.summary).toContain("ZTEST_I01")
      })

      it("reports the main program and sibling includes of a submitted include", async () => {
        mockClient.inactiveObjects
          .mockResolvedValueOnce([
            { object: main },
            { object: inactiveObject },
            { object: otherInclude }
          ])
          .mockResolvedValueOnce([{ object: main }, { object: otherInclude }])
        mockClient.activate.mockResolvedValue(success)
        mockStatelessClient.nodeContents.mockResolvedValue(includeNodes)
        mockRoot.findByAdtUri.mockResolvedValue({
          path: "/$TMP/Source Library/Includes/ZTEST_I01.prog.abap",
          file: { object: { type: "PROG/I" } }
        })
        includeService.current.mockReturnValue({
          "adtcore:uri": programUri,
          "adtcore:name": "ZTEST"
        })
        const activator = AdtObjectActivator.get("conn6")

        const result = await activator.activateMultiple(false, [includeUri])

        expect(result.ok).toBe(true)
        expect(result.relatedStillInactive).toEqual([main, otherInclude])
        expect(IncludeProvider.get().switchIncludeIfMissing).not.toHaveBeenCalled()
      })

      it("finds the main program of an include without prompting", async () => {
        mockClient.inactiveObjects
          .mockResolvedValueOnce([{ object: main }, { object: inactiveObject }])
          .mockResolvedValueOnce([{ object: main }])
        mockClient.activate.mockResolvedValue(success)
        mockRoot.findByAdtUri.mockResolvedValue({
          path: "/$TMP/Source Library/Includes/ZTEST_I01.prog.abap",
          file: { object: { type: "PROG/I" } }
        })
        includeService.candidates.mockResolvedValue([
          { "adtcore:uri": programUri, "adtcore:name": "ZTEST" }
        ])
        const activator = AdtObjectActivator.get("conn6")

        const result = await activator.activateMultiple(false, [includeUri])

        expect(result.relatedStillInactive).toEqual([main])
        expect(IncludeProvider.get().switchIncludeIfMissing).not.toHaveBeenCalled()
      })

      it("skips the lookup when nothing else is inactive", async () => {
        mockClient.inactiveObjects
          .mockResolvedValueOnce([{ object: main }])
          .mockResolvedValueOnce([])
        mockClient.activate.mockResolvedValue(success)
        const activator = AdtObjectActivator.get("conn6")

        const result = await activator.activateMultiple(false, [programUri])

        expect(result.ok).toBe(true)
        expect(result.relatedStillInactive).toEqual([])
        expect(result.summary).toBeUndefined()
        expect(mockStatelessClient.nodeContents).not.toHaveBeenCalled()
      })

      it("does not report unrelated inactive objects", async () => {
        const unrelated = inactive("ZOTHER", "PROG/P", "/sap/bc/adt/programs/programs/zother", "")
        mockClient.inactiveObjects
          .mockResolvedValueOnce([{ object: main }, { object: unrelated }])
          .mockResolvedValueOnce([{ object: unrelated }])
        mockClient.activate.mockResolvedValue(success)
        const activator = AdtObjectActivator.get("conn6")

        const result = await activator.activateMultiple(false, [programUri])

        expect(result.relatedStillInactive).toEqual([])
        expect(mockStatelessClient.nodeContents).not.toHaveBeenCalled()
      })
    })

    it("matches requested source URLs to their inactive object", async () => {
      mockClient.inactiveObjects
        .mockResolvedValueOnce([{ object: inactiveObject }])
        .mockResolvedValueOnce([])
      mockClient.activate.mockResolvedValue(success)
      const activator = AdtObjectActivator.get("conn5")

      const result = await activator.activateMultiple(false, [`${includeUri}/source/main`])

      expect(mockClient.activate).toHaveBeenCalledWith([inactiveObject])
      expect(result.ok).toBe(true)
      expect(result.notInactiveUris).toEqual([])
    })

    it("reloads open editors of activated objects", async () => {
      const editorObject = abapObject({ name: "ZTEST_I01", type: "PROG/I", path: includeUri })
      mocks.textDocuments = [{ uri: vsUri("/Source Library/ZTEST_I01.prog.abap") }]
      mockRoot.getNode.mockReturnValue({ object: editorObject })
      mockClient.inactiveObjects
        .mockResolvedValueOnce([{ object: inactiveObject }])
        .mockResolvedValueOnce([])
      mockClient.activate.mockResolvedValue(success)
      const activator = AdtObjectActivator.get("conn")

      await activator.activateMultiple(false, [includeUri])

      expect(editorObject.loadStructure).toHaveBeenCalledWith(true)
    })

    it("reports requested objects that remain inactive after activation", async () => {
      mockClient.inactiveObjects.mockResolvedValue([{ object: inactiveObject }])
      mockClient.activate.mockResolvedValue(success)
      const activator = AdtObjectActivator.get("conn6")

      const result = await activator.activateMultiple(false, [inactiveObject["adtcore:uri"]])

      expect(result.ok).toBe(false)
      expect(result.summary).toContain("still inactive")
      expect(result.stillInactiveObjects).toEqual([inactiveObject])
      expect(activator["emitter"].fire).not.toHaveBeenCalled()
    })

    it("verifies remaining inactive objects after an activation exception", async () => {
      mockClient.inactiveObjects.mockResolvedValue([{ object: inactiveObject }])
      mockClient.activate.mockRejectedValue(new Error("Activation request failed"))
      const activator = AdtObjectActivator.get("conn7")

      const result = await activator.activateMultiple(false, [inactiveObject["adtcore:uri"]])

      expect(result.ok).toBe(false)
      expect(result.summary).toBe("Activation request failed")
      expect(result.stillInactiveObjects).toEqual([inactiveObject])
    })

    it("does not activate URLs that are not currently inactive", async () => {
      const activator = AdtObjectActivator.get("conn8")

      const result = await activator.activateMultiple(false, [
        "/sap/bc/adt/programs/includes/zactive"
      ])

      expect(mockClient.activate).not.toHaveBeenCalled()
      expect(result.ok).toBe(false)
      expect(result.notInactiveUris).toEqual(["/sap/bc/adt/programs/includes/zactive"])
    })

    it("reports success without a request when nothing is inactive", async () => {
      const activator = AdtObjectActivator.get("conn8")

      const result = await activator.activateMultiple(true)

      expect(result).toMatchObject({ ok: true, availableCount: 0, selectedCount: 0 })
      expect(mockShowQuickPick).not.toHaveBeenCalled()
      expect(mockClient.activate).not.toHaveBeenCalled()
    })

    it("lets the user pick objects grouped by transport", async () => {
      mockClient.inactiveObjects
        .mockResolvedValueOnce([
          {
            object: inactiveObject,
            transport: inactive("DEVK900002", "/RQ", "/cts/DEVK900002", "/cts/DEVK900001")
          }
        ])
        .mockResolvedValueOnce([])
      mockClient.activate.mockResolvedValue(success)
      pickFirstObject()
      const activator = AdtObjectActivator.get("conn8")

      const result = await activator.activateMultiple(true)

      const items = mockShowQuickPick.mock.calls[0][0]
      expect(items[0]).toMatchObject({ kind: -1, label: "DEVK900001 / DEVK900002" })
      expect(items[1]).toMatchObject({ label: "  ZTEST_I01", object: inactiveObject })
      expect(mockClient.activate).toHaveBeenCalledWith([inactiveObject])
      expect(result.ok).toBe(true)
    })

    it("reports a cancelled selection", async () => {
      mockClient.inactiveObjects.mockResolvedValue([{ object: inactiveObject }])
      const activator = AdtObjectActivator.get("conn8")

      const result = await activator.activateMultiple(true)

      expect(result).toMatchObject({ ok: false, cancelled: true })
      expect(mockClient.activate).not.toHaveBeenCalled()
    })

    it("serializes concurrent activation requests of a connection", async () => {
      mockClient.inactiveObjects.mockResolvedValue([{ object: inactiveObject }])
      let release = () => {}
      mockClient.activate
        .mockImplementationOnce(() => new Promise(resolve => (release = () => resolve(success))))
        .mockResolvedValueOnce(success)
      const activator = AdtObjectActivator.get("conn9")

      const first = activator.activateMultiple(false, [includeUri])
      const second = activator.activateMultiple(false, [includeUri])
      await vi.waitFor(() => expect(mockClient.activate).toHaveBeenCalledTimes(1))
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(mockClient.activate).toHaveBeenCalledTimes(1)

      release()
      await Promise.all([first, second])
      expect(mockClient.activate).toHaveBeenCalledTimes(2)
    })
  })

  describe("activate", () => {
    it("activates an include by name with its main program context", async () => {
      const include = abapObject({ name: "ZTEST_I01", type: "PROG/I", path: includeUri })
      includeService.needMain.mockReturnValue(true)
      includeService.current.mockReturnValue({ "adtcore:uri": programUri, "adtcore:name": "ZTEST" })
      mockClient.inactiveObjects.mockResolvedValue([{ object: inactiveObject }])
      mockClient.activate.mockResolvedValue(success)
      const activator = AdtObjectActivator.get("conn")
      const uri = vsUri("/Source Library/ZTEST_I01.prog.abap")

      const result = await activator.activate(include, uri)

      expect(result).toEqual({ ok: true })
      expect(mockClient.activate).toHaveBeenCalledWith("ZTEST_I01", includeUri, programUri, true)
      expect(mockStatelessClient.nodeContents).not.toHaveBeenCalled()
      expect(include.loadStructure).toHaveBeenCalledWith(true)
      expect(activator["emitter"].fire).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: "conn",
          object: include,
          uri,
          mainProg: programUri,
          objects: [expect.objectContaining({ "adtcore:uri": includeUri })]
        })
      )
    })

    it("activates the inactive parts of the main program together without asking", async () => {
      const otherIncludeUri = "/sap/bc/adt/programs/includes/ztest_f01"
      const main = inactive("ZTEST", "PROG/P", programUri, "/sap/bc/adt/packages/ztmp")
      const otherInclude = inactive("ZTEST_F01", "PROG/I", otherIncludeUri, programUri)
      const include = abapObject({ name: "ZTEST_I01", type: "PROG/I", path: includeUri })
      includeService.needMain.mockReturnValue(true)
      includeService.current.mockReturnValue({ "adtcore:uri": programUri, "adtcore:name": "ZTEST" })
      mockClient.inactiveObjects.mockResolvedValue([
        { object: otherInclude },
        { object: inactiveObject },
        { object: main }
      ])
      mockStatelessClient.nodeContents.mockResolvedValue({
        nodes: [
          { OBJECT_TYPE: "PROG/I", OBJECT_NAME: "ZTEST_F01", OBJECT_URI: otherIncludeUri },
          { OBJECT_TYPE: "PROG/I", OBJECT_NAME: "ZTEST_I01", OBJECT_URI: includeUri }
        ]
      })
      mockClient.activate.mockResolvedValue(success)
      const activator = AdtObjectActivator.get("conn")

      const result = await activator.activate(include, vsUri("/ZTEST_I01"))

      expect(result.ok).toBe(true)
      expect(mockStatelessClient.nodeContents).toHaveBeenCalledWith(
        "PROG/P",
        "ZTEST",
        undefined,
        undefined,
        true
      )
      expect(mockShowQuickPick).not.toHaveBeenCalled()
      expect(mockClient.activate).toHaveBeenCalledTimes(1)
      expect(mockClient.activate).toHaveBeenCalledWith([main, inactiveObject, otherInclude])
    })

    it("activates a program with its inactive includes", async () => {
      const main = inactive("ZTEST", "PROG/P", programUri, "/sap/bc/adt/packages/ztmp")
      const program = abapObject({ name: "ZTEST", type: "PROG/P", path: programUri })
      mockClient.inactiveObjects.mockResolvedValue([{ object: main }, { object: inactiveObject }])
      mockStatelessClient.nodeContents.mockResolvedValue({
        nodes: [
          {
            OBJECT_TYPE: "PROG/I",
            OBJECT_NAME: "ZTEST_I01",
            OBJECT_URI: `${includeUri}/source/main?context=${encodeURIComponent(programUri)}`
          }
        ]
      })
      mockClient.activate.mockResolvedValue(success)
      const activator = AdtObjectActivator.get("conn")

      const result = await activator.activate(program, vsUri("/ZTEST"))

      expect(result.ok).toBe(true)
      expect(mockClient.activate).toHaveBeenCalledWith([main, inactiveObject])
    })

    it("asks which class parts to activate only after the silent attempt fails", async () => {
      const testclasses = inactive(
        "ZCL_TEST",
        "CLAS/I",
        `${classUri}/includes/testclasses`,
        classUri
      )
      const implementations = inactive(
        "ZCL_TEST",
        "CLAS/I",
        `${classUri}/includes/implementations`,
        classUri
      )
      const clas = abapObject({ name: "ZCL_TEST", type: "CLAS/OC", path: classUri })
      const classInclude = abapObject(
        { name: "ZCL_TEST.testclasses", type: "CLAS/I", path: testclasses["adtcore:uri"] },
        clas
      )
      mockClient.inactiveObjects.mockResolvedValue([
        { object: testclasses },
        { object: implementations }
      ])
      mockClient.activate
        .mockResolvedValueOnce(failure("Method FOO is unknown"))
        .mockResolvedValueOnce(success)
      pickFirstObject()
      const activator = AdtObjectActivator.get("conn")

      const result = await activator.activate(classInclude, vsUri("/ZCL_TEST.testclasses"))

      expect(result.ok).toBe(true)
      expect(mockClient.activate).toHaveBeenNthCalledWith(1, [testclasses, implementations])
      expect(mockShowQuickPick).toHaveBeenCalledTimes(1)
      expect(mockClient.activate).toHaveBeenNthCalledWith(2, [testclasses])
      expect(clas.loadStructure).toHaveBeenCalledWith(true)
    })

    it("does not open dialogs when not interactive", async () => {
      const testclasses = inactive(
        "ZCL_TEST",
        "CLAS/I",
        `${classUri}/includes/testclasses`,
        classUri
      )
      const implementations = inactive(
        "ZCL_TEST",
        "CLAS/I",
        `${classUri}/includes/implementations`,
        classUri
      )
      const clas = abapObject({ name: "ZCL_TEST", type: "CLAS/OC", path: classUri })
      const classInclude = abapObject(
        { name: "ZCL_TEST.testclasses", type: "CLAS/I", path: testclasses["adtcore:uri"] },
        clas
      )
      mockClient.inactiveObjects.mockResolvedValue([
        { object: testclasses },
        { object: implementations }
      ])
      mockClient.activate.mockResolvedValue(failure("Method FOO is unknown"))
      const activator = AdtObjectActivator.get("conn")

      const result = await activator.activate(classInclude, vsUri("/ZCL_TEST.testclasses"), false)

      expect(mockShowQuickPick).not.toHaveBeenCalled()
      expect(mockClient.activate).toHaveBeenCalledTimes(2)
      expect(result.ok).toBe(false)
      expect(result.summary).toContain("Method FOO is unknown")
    })

    it("reports a cancelled dialog as cancelled rather than failed", async () => {
      const testclasses = inactive(
        "ZCL_TEST",
        "CLAS/I",
        `${classUri}/includes/testclasses`,
        classUri
      )
      const implementations = inactive(
        "ZCL_TEST",
        "CLAS/I",
        `${classUri}/includes/implementations`,
        classUri
      )
      const clas = abapObject({ name: "ZCL_TEST", type: "CLAS/OC", path: classUri })
      const classInclude = abapObject(
        { name: "ZCL_TEST.testclasses", type: "CLAS/I", path: testclasses["adtcore:uri"] },
        clas
      )
      mockClient.inactiveObjects.mockResolvedValue([
        { object: testclasses },
        { object: implementations }
      ])
      mockClient.activate.mockResolvedValue(failure("Method FOO is unknown"))
      const activator = AdtObjectActivator.get("conn")

      const result = await activator.activate(classInclude, vsUri("/ZCL_TEST.testclasses"))

      expect(result).toMatchObject({ ok: false, cancelled: true })
      expect(mockClient.activate).toHaveBeenCalledTimes(1)
      expect(activator["emitter"].fire).not.toHaveBeenCalled()
    })

    it("activates the objects SAP asks for when the object alone fails", async () => {
      const clas = abapObject({ name: "ZCL_TEST", type: "CLAS/OC", path: classUri })
      const dependency = inactive("ZIF_TEST", "INTF/OI", "/sap/bc/adt/oo/interfaces/zif_test", "/p")
      const self = inactive("ZCL_TEST", "CLAS/OC", classUri, "/p")
      mockClient.activate
        .mockResolvedValueOnce({
          success: false,
          messages: [],
          inactive: [{ object: self }, { object: dependency }]
        })
        .mockResolvedValueOnce(success)
      const activator = AdtObjectActivator.get("conn")

      const result = await activator.activate(clas, vsUri("/ZCL_TEST"))

      expect(result.ok).toBe(true)
      expect(mockClient.activate).toHaveBeenNthCalledWith(1, "ZCL_TEST", classUri, undefined, true)
      expect(mockClient.activate).toHaveBeenNthCalledWith(2, [self, dependency])
      expect(mockShowQuickPick).not.toHaveBeenCalled()
    })

    it("still activates by name when the inactive list cannot be read", async () => {
      const clas = abapObject({ name: "ZCL_TEST", type: "CLAS/OC", path: classUri })
      mockClient.inactiveObjects.mockRejectedValue(new Error("list failed"))
      mockClient.activate.mockResolvedValue(success)
      const activator = AdtObjectActivator.get("conn")

      const result = await activator.activate(clas, vsUri("/ZCL_TEST"))

      expect(result.ok).toBe(true)
      expect(mockClient.activate).toHaveBeenCalledWith("ZCL_TEST", classUri, undefined, true)
    })

    it("does not report a failure when reloading the structure fails", async () => {
      const clas = abapObject({ name: "ZCL_TEST", type: "CLAS/OC", path: classUri })
      clas.loadStructure.mockRejectedValue(new Error("network down"))
      mockClient.activate.mockResolvedValue(success)
      const activator = AdtObjectActivator.get("conn")

      const result = await activator.activate(clas, vsUri("/ZCL_TEST"))

      expect(result).toEqual({ ok: true })
      expect(activator["emitter"].fire).toHaveBeenCalled()
    })

    it("reloads again when the reload returned a stale inactive structure", async () => {
      const clas = abapObject({ name: "ZCL_TEST", type: "CLAS/OC", path: classUri })
      clas.loadStructure.mockImplementationOnce(async () => {
        clas.structure = { metaData: { "adtcore:version": "inactive" } }
        return clas.structure
      })
      mockClient.activate.mockResolvedValue(success)
      const activator = AdtObjectActivator.get("conn")

      await activator.activate(clas, vsUri("/ZCL_TEST"))

      expect(clas.loadStructure).toHaveBeenCalledTimes(2)
      expect(clas.structure.metaData["adtcore:version"]).toBe("active")
    })

    it("returns the error summary when the activation request throws", async () => {
      const clas = abapObject({ name: "ZCL_TEST", type: "CLAS/OC", path: classUri })
      mockClient.activate.mockRejectedValue(new Error("socket ECONNRESET"))
      const activator = AdtObjectActivator.get("conn")

      const result = await activator.activate(clas, vsUri("/ZCL_TEST"))

      expect(result.ok).toBe(false)
      expect(result.summary).toContain("Connection lost during activation")
    })
  })
})
