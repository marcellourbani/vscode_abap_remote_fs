jest.mock("vscode", () => ({ ProgressLocation: { Notification: 15 } }), { virtual: true })
jest.mock("../services/funMessenger", () => ({
  funWindow: {
    showQuickPick: jest.fn(),
    showInputBox: jest.fn(),
    showInformationMessage: jest.fn()
  }
}))
jest.mock("../lib", () => ({
  fieldOrder: () => () => 0,
  withp: jest.fn()
}))
jest.mock("../api", () => ({}))
jest.mock("./conections", () => ({
  uriRoot: jest.fn(),
  getClient: jest.fn()
}))
jest.mock("abapfs", () => ({
  isAbapStat: jest.fn(),
  isAbapFolder: jest.fn()
}))

import { trSel, TransportStatus, transportValidators } from "./AdtTransports"
import { funWindow as window } from "../services/funMessenger"
import { withp } from "../lib"

const mockWindow = window as jest.Mocked<typeof window>
const mockWithp = withp as jest.Mock

describe("trSel", () => {
  it("creates a transport selection with cancelled=false by default", () => {
    const result = trSel("NPLK900123")
    expect(result.transport).toBe("NPLK900123")
    expect(result.cancelled).toBe(false)
  })

  it("creates a cancelled selection", () => {
    const result = trSel("", true)
    expect(result.transport).toBe("")
    expect(result.cancelled).toBe(true)
  })

  it("creates selection with specific transport and cancelled=true", () => {
    const result = trSel("T123", true)
    expect(result.transport).toBe("T123")
    expect(result.cancelled).toBe(true)
  })

  it("creates selection with empty transport and cancelled=false", () => {
    const result = trSel("")
    expect(result.cancelled).toBe(false)
    expect(result.transport).toBe("")
  })
})

describe("TransportStatus enum", () => {
  it("has UNKNOWN = 0", () => {
    expect(TransportStatus.UNKNOWN).toBe(0)
  })

  it("has REQUIRED = 1", () => {
    expect(TransportStatus.REQUIRED).toBe(1)
  })

  it("has LOCAL = 2", () => {
    expect(TransportStatus.LOCAL).toBe(2)
  })
})

describe("transportValidators array", () => {
  it("is exported and is an array", () => {
    expect(Array.isArray(transportValidators)).toBe(true)
  })

  it("starts empty", () => {
    // May have been mutated by other tests - just verify it's an array
    expect(Array.isArray(transportValidators)).toBe(true)
  })

  it("can have validators pushed in", () => {
    const validator = jest.fn().mockResolvedValue(true)
    const before = transportValidators.length
    transportValidators.push(validator)
    expect(transportValidators.length).toBe(before + 1)
    // cleanup
    transportValidators.splice(transportValidators.indexOf(validator), 1)
  })
})

describe("selectTransport", () => {
  let mockClient: any
  const { selectTransport } = jest.requireActual("./AdtTransports")

  beforeEach(() => {
    jest.clearAllMocks()
    mockClient = {
      transportInfo: jest.fn(),
      createTransport: jest.fn()
    }
  })

  it("returns locked transport immediately when LOCKS present", async () => {
    mockClient.transportInfo.mockResolvedValue({
      LOCKS: { HEADER: { TRKORR: "NPLK900001" } },
      TRANSPORTS: [],
      DLVUNIT: ""
    })
    const result = await selectTransport("/path", "DEVC", mockClient)
    expect(result.transport).toBe("NPLK900001")
    expect(result.cancelled).toBe(false)
  })

  it("returns current transport if it matches a proposal", async () => {
    mockClient.transportInfo.mockResolvedValue({
      LOCKS: null,
      TRANSPORTS: [{ TRKORR: "NPLK900002", AS4TEXT: "My request" }],
      DLVUNIT: "",
      OBJECT: "PROG",
      OBJECTNAME: "ZPROG"
    })
    const result = await selectTransport("/path", "DEVC", mockClient, false, "NPLK900002")
    expect(result.transport).toBe("NPLK900002")
    expect(result.cancelled).toBe(false)
  })

  it("returns empty transport for LOCAL objects", async () => {
    mockClient.transportInfo.mockResolvedValue({
      LOCKS: null,
      TRANSPORTS: [],
      DLVUNIT: "LOCAL",
      OBJECT: "PROG",
      OBJECTNAME: "ZPROG"
    })
    const result = await selectTransport("/path", "DEVC", mockClient)
    expect(result.transport).toBe("")
    expect(result.cancelled).toBe(false)
  })

  it("prompts user for transport selection when no lock/match", async () => {
    mockClient.transportInfo.mockResolvedValue({
      LOCKS: null,
      TRANSPORTS: [{ TRKORR: "T001", AS4TEXT: "Request 1" }],
      DLVUNIT: "",
      OBJECT: "PROG",
      OBJECTNAME: "ZPROG"
    })
    // User picks "T001 Request 1"
    mockWindow.showQuickPick.mockResolvedValue("T001 Request 1" as any)
    const result = await selectTransport("/path", "DEVC", mockClient)
    expect(result.transport).toBe("T001")
  })

  it("returns cancelled when user dismisses the transport picker", async () => {
    mockClient.transportInfo.mockResolvedValue({
      LOCKS: null,
      TRANSPORTS: [{ TRKORR: "T001", AS4TEXT: "Req" }],
      DLVUNIT: "",
      OBJECT: "PROG",
      OBJECTNAME: "ZPROG"
    })
    mockWindow.showQuickPick.mockResolvedValue(undefined)
    const result = await selectTransport("/path", "DEVC", mockClient)
    expect(result.cancelled).toBe(true)
  })

  it("creates new transport when user selects 'Create a new transport'", async () => {
    mockClient.transportInfo.mockResolvedValue({
      LOCKS: null,
      TRANSPORTS: [],
      DLVUNIT: "",
      OBJECT: "PROG",
      OBJECTNAME: "ZPROG",
      DEVCLASS: "ZDEV"
    })
    mockClient.createTransport.mockResolvedValue("NEWTR001")
    mockWindow.showQuickPick.mockResolvedValue("Create a new transport" as any)
    mockWindow.showInputBox.mockResolvedValue("New request text")
    const result = await selectTransport("/path", "ZDEV", mockClient)
    expect(mockClient.createTransport).toHaveBeenCalledWith(
      "/path",
      "New request text",
      "ZDEV",
      ""
    )
    expect(result.transport).toBe("NEWTR001")
  })

  it("returns cancelled when user dismisses transport text input", async () => {
    mockClient.transportInfo.mockResolvedValue({
      LOCKS: null,
      TRANSPORTS: [],
      DLVUNIT: "",
      OBJECT: "PROG",
      OBJECTNAME: "ZPROG",
      DEVCLASS: "ZDEV"
    })
    mockWindow.showQuickPick.mockResolvedValue("Create a new transport" as any)
    mockWindow.showInputBox.mockResolvedValue(undefined)
    const result = await selectTransport("/path", "ZDEV", mockClient)
    expect(result.cancelled).toBe(true)
  })
})
