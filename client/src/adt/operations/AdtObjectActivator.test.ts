jest.mock(
  "vscode",
  () => ({
    EventEmitter: jest.fn().mockImplementation(() => ({
      event: "mockEvent",
      fire: jest.fn()
    })),
    Uri: {
      parse: jest.fn((s: string) => ({
        scheme: "adt",
        authority: "conn",
        path: s,
        toString: () => s
      }))
    }
  }),
  { virtual: true }
)

jest.mock("../conections", () => ({
  getClient: jest.fn()
}))

jest.mock("../includes", () => ({
  IncludeService: {
    get: jest.fn().mockReturnValue({
      needMain: jest.fn().mockReturnValue(false),
      current: jest.fn().mockReturnValue(null)
    })
  },
  IncludeProvider: {
    get: jest.fn().mockReturnValue({
      switchIncludeIfMissing: jest.fn().mockResolvedValue(null)
    })
  }
}))

jest.mock("../../lib", () => ({
  isDefined: jest.fn((x: any) => x !== undefined && x !== null),
  channel: { appendLine: jest.fn() }
}))

jest.mock("abap-adt-api", () => ({
  isAdtError: jest.fn(),
  inactiveObjectsInResults: jest.fn(),
  session_types: { stateful: "stateful" }
}))

jest.mock("../../services/funMessenger", () => ({
  funWindow: {
    showQuickPick: jest.fn(),
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    withProgress: jest.fn()
  }
}))

jest.mock("abapobject", () => ({}))

import { AdtObjectActivator, ActivationEvent } from "./AdtObjectActivator"
import { getClient } from "../conections"

const mockGetClient = getClient as jest.Mock

describe("AdtObjectActivator", () => {
  let mockStatelessClient: any
  let mockClient: any

  beforeEach(() => {
    jest.clearAllMocks()
    AdtObjectActivator["instances"].clear()

    mockStatelessClient = {
      activate: jest.fn(),
      inactiveObjects: jest.fn().mockResolvedValue([]),
      statelessClone: {
        nodeContents: jest.fn().mockResolvedValue({ nodes: [] }),
        login: jest.fn()
      },
      nodeContents: jest.fn().mockResolvedValue({ nodes: [] }),
      httpClient: {
        request: jest.fn().mockResolvedValue({ body: "" })
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
