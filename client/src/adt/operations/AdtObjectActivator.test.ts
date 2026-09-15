vi.mock("vscode", () => ({
  EventEmitter: vi.fn().mockImplementation(function () {
    return {
      event: "mockEvent",
      fire: vi.fn()
    }
  }),
  Uri: {
    parse: vi.fn(function (s: string) {
      return {
        scheme: "adt",
        authority: "conn",
        path: s,
        toString: () => s
      }
    })
  }
}))

vi.mock("../conections", () => ({
  getClient: vi.fn()
}))

vi.mock("../includes", () => ({
  IncludeService: {
    get: vi.fn().mockReturnValue({
      needMain: vi.fn().mockReturnValue(false),
      current: vi.fn().mockReturnValue(null)
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
  channel: { appendLine: vi.fn() }
}))

vi.mock("abap-adt-api", () => ({
  isAdtError: vi.fn(),
  inactiveObjectsInResults: vi.fn(),
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

import { AdtObjectActivator, type ActivationEvent } from "./AdtObjectActivator"
import { getClient } from "../conections"
import type { Mock } from "vitest"

const mockGetClient = getClient as Mock

describe("AdtObjectActivator", () => {
  let mockStatelessClient: any
  let mockClient: any

  beforeEach(() => {
    vi.clearAllMocks()
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

  it("constructor uses stateless client", () => {
    AdtObjectActivator.get("conn4")
    expect(mockGetClient).toHaveBeenCalledWith("conn4", false)
  })
})
