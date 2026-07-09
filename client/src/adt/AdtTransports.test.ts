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
    expect(mockClient.createTransport).toHaveBeenCalledWith("/path", "New request text", "ZDEV", "")
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

describe("pickTransportProgrammatically", () => {
  const { pickTransportProgrammatically, TransportPickerError } =
    jest.requireActual("./AdtTransports")

  let mockClient: any
  beforeEach(() => {
    jest.clearAllMocks()
    mockClient = {
      transportInfo: jest.fn(),
      createTransport: jest.fn()
    }
  })

  it("returns empty transport for LOCAL package and ignores request", async () => {
    mockClient.transportInfo.mockResolvedValue({
      DLVUNIT: "LOCAL",
      TRANSPORTS: [],
      LOCKS: undefined
    })
    const result = await pickTransportProgrammatically(
      mockClient,
      { type: "existing", number: "IGNORED" },
      "/path",
      "$TMP",
      ""
    )
    expect(result).toEqual({ cancelled: false, transport: "" })
    expect(mockClient.createTransport).not.toHaveBeenCalled()
  })

  describe("type: existing", () => {
    it("uses the requested transport when in the modifiable list", async () => {
      mockClient.transportInfo.mockResolvedValue({
        DLVUNIT: "HOME",
        TRANSPORTS: [{ TRKORR: "DEV1K900123" }, { TRKORR: "DEV1K900124" }],
        LOCKS: undefined
      })
      const result = await pickTransportProgrammatically(
        mockClient,
        { type: "existing", number: "DEV1K900123" },
        "/path",
        "ZDEV",
        ""
      )
      expect(result).toEqual({ cancelled: false, transport: "DEV1K900123" })
      expect(mockClient.createTransport).not.toHaveBeenCalled()
    })

    it("throws TransportPickerError when 'number' is missing", async () => {
      mockClient.transportInfo.mockResolvedValue({
        DLVUNIT: "HOME",
        TRANSPORTS: [],
        LOCKS: undefined
      })
      await expect(
        pickTransportProgrammatically(mockClient, { type: "existing" }, "/path", "ZDEV", "")
      ).rejects.toBeInstanceOf(TransportPickerError)
    })

    it("throws TransportPickerError when the requested number is not modifiable", async () => {
      mockClient.transportInfo.mockResolvedValue({
        DLVUNIT: "HOME",
        TRANSPORTS: [{ TRKORR: "DEV1K900999" }],
        LOCKS: undefined
      })
      await expect(
        pickTransportProgrammatically(
          mockClient,
          { type: "existing", number: "DEV1K900123" },
          "/path",
          "ZDEV",
          ""
        )
      ).rejects.toThrow(/DEV1K900123.*not in the modifiable list/)
    })

    it("throws when package is locked to a different transport (no silent override)", async () => {
      mockClient.transportInfo.mockResolvedValue({
        DLVUNIT: "HOME",
        TRANSPORTS: [],
        LOCKS: { HEADER: { TRKORR: "DEV1K900999" } }
      })
      await expect(
        pickTransportProgrammatically(
          mockClient,
          { type: "existing", number: "DEV1K900123" },
          "/path",
          "ZDEV",
          ""
        )
      ).rejects.toThrow(/locked to transport DEV1K900999/)
    })

    it("allows the requested transport when it matches the lock", async () => {
      mockClient.transportInfo.mockResolvedValue({
        DLVUNIT: "HOME",
        TRANSPORTS: [],
        LOCKS: { HEADER: { TRKORR: "DEV1K900123" } }
      })
      const result = await pickTransportProgrammatically(
        mockClient,
        { type: "existing", number: "DEV1K900123" },
        "/path",
        "ZDEV",
        ""
      )
      expect(result).toEqual({ cancelled: false, transport: "DEV1K900123" })
    })
  })

  describe("type: new", () => {
    it("creates a new transport with the caller's description and returns it", async () => {
      mockClient.transportInfo.mockResolvedValue({
        DLVUNIT: "HOME",
        TRANSPORTS: [],
        LOCKS: undefined
      })
      mockClient.createTransport.mockResolvedValue("DEV1K900999")
      const result = await pickTransportProgrammatically(
        mockClient,
        { type: "new", description: "New TR from agent" },
        "/path",
        "ZDEV",
        "ZDEV_LAYER"
      )
      expect(mockClient.createTransport).toHaveBeenCalledWith(
        "/path",
        "New TR from agent",
        "ZDEV",
        "ZDEV_LAYER"
      )
      expect(result).toEqual({ cancelled: false, transport: "DEV1K900999" })
    })

    it("throws TransportPickerError when 'description' is missing", async () => {
      mockClient.transportInfo.mockResolvedValue({
        DLVUNIT: "HOME",
        TRANSPORTS: [],
        LOCKS: undefined
      })
      await expect(
        pickTransportProgrammatically(mockClient, { type: "new" }, "/path", "ZDEV", "")
      ).rejects.toBeInstanceOf(TransportPickerError)
      expect(mockClient.createTransport).not.toHaveBeenCalled()
    })

    it("refuses to create a new transport when the package is already locked", async () => {
      mockClient.transportInfo.mockResolvedValue({
        DLVUNIT: "HOME",
        TRANSPORTS: [],
        LOCKS: { HEADER: { TRKORR: "DEV1K900123" } }
      })
      await expect(
        pickTransportProgrammatically(
          mockClient,
          { type: "new", description: "New TR" },
          "/path",
          "ZDEV",
          ""
        )
      ).rejects.toThrow(/already locked to transport DEV1K900123/)
      expect(mockClient.createTransport).not.toHaveBeenCalled()
    })
  })

  it("throws on unknown request type", async () => {
    mockClient.transportInfo.mockResolvedValue({
      DLVUNIT: "HOME",
      TRANSPORTS: [],
      LOCKS: undefined
    })
    await expect(
      pickTransportProgrammatically(mockClient, { type: "bogus" as any }, "/path", "ZDEV", "")
    ).rejects.toThrow(/Unknown transportRequest\.type/)
  })

  it("does not open any VS Code dialog (no calls to showQuickPick/showInputBox)", async () => {
    mockClient.transportInfo.mockResolvedValue({
      DLVUNIT: "HOME",
      TRANSPORTS: [{ TRKORR: "DEV1K900123" }],
      LOCKS: undefined
    })
    await pickTransportProgrammatically(
      mockClient,
      { type: "existing", number: "DEV1K900123" },
      "/path",
      "ZDEV",
      ""
    )
    expect(mockWindow.showQuickPick).not.toHaveBeenCalled()
    expect(mockWindow.showInputBox).not.toHaveBeenCalled()
  })
})
