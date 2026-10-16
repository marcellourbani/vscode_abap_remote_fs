import { vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  register: vi.fn(),
  authorize: vi.fn()
}))

vi.mock("vscode", () => ({
  Uri: {
    parse: vi.fn((value: string) => {
      const parsed = new URL(value)
      return {
        scheme: parsed.protocol.slice(0, -1),
        authority: parsed.host,
        path: parsed.pathname,
        toString: () => value
      }
    })
  },
  LanguageModelToolResult: vi.fn().mockImplementation(function (parts: any[]) {
    return { parts }
  }),
  LanguageModelTextPart: vi.fn().mockImplementation(function (text: string) {
    return { text }
  }),
  MarkdownString: vi.fn().mockImplementation(function (text: string) {
    return { text }
  })
}))
vi.mock("../objectTransportStatusService", () => ({
  getAbapObjectTransportStatus: mocks.getStatus
}))
vi.mock("../transportIntentService", () => ({
  TransportIntentService: {
    get: vi.fn(() => ({ register: mocks.register }))
  }
}))
vi.mock("./toolGuard", () => ({
  assertToolInvocationAuthorized: mocks.authorize
}))
vi.mock("./toolRegistry", () => ({
  registerToolWithRegistry: vi.fn()
}))

import { SetTransportForNextObjectSaveTool } from "./nextObjectSaveTransportTool"

const options = (input: unknown) => ({ input }) as any

describe("SetTransportForNextObjectSaveTool", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getStatus.mockResolvedValue({
      status: "not-locked",
      transportRequest: "",
      connectionId: "dev100"
    })
    mocks.register.mockReturnValue({ intentId: "intent-1", status: "armed" })
  })

  it("normalizes the connection and arms one exact URI intent", async () => {
    const tool = new SetTransportForNextObjectSaveTool()
    const result: any = await tool.invoke(
      options({
        objectUri: "adt://DEV100/sap/bc/adt/programs/ztest/source/main",
        transportChoice: { type: "existing", number: "DEVK900123" }
      })
    )

    expect(mocks.authorize).toHaveBeenCalled()
    expect(mocks.getStatus).toHaveBeenCalledWith({
      connectionId: "dev100",
      source: "adt://DEV100/sap/bc/adt/programs/ztest/source/main"
    })
    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({
        process: "normal-edit",
        transportChoice: { type: "existing", number: "DEVK900123" }
      })
    )
    expect(JSON.parse(result.parts[0].text)).toEqual(
      expect.objectContaining({ armed: true, connectionId: "dev100" })
    )
  })

  it("does not arm an intent for a local object", async () => {
    mocks.getStatus.mockResolvedValue({
      status: "local",
      transportRequest: "",
      connectionId: "dev100"
    })

    const result: any = await new SetTransportForNextObjectSaveTool().invoke(
      options({
        objectUri: "adt://DEV100/object",
        transportChoice: { type: "existing", number: "IGNORED" }
      })
    )

    expect(mocks.register).not.toHaveBeenCalled()
    expect(JSON.parse(result.parts[0].text)).toEqual(
      expect.objectContaining({ armed: false, status: "local" })
    )
  })

  it("allows the user-approved request when it matches the current lock", async () => {
    mocks.getStatus.mockResolvedValue({
      status: "locked",
      transportRequest: "DEVK900123"
    })

    await new SetTransportForNextObjectSaveTool().invoke(
      options({
        objectUri: "adt://dev100/object",
        transportChoice: { type: "existing", number: "devk900123" }
      })
    )

    expect(mocks.register).toHaveBeenCalled()
  })

  it("rejects a different existing request when the object is locked", async () => {
    mocks.getStatus.mockResolvedValue({
      status: "locked",
      transportRequest: "DEVK900999"
    })

    await expect(
      new SetTransportForNextObjectSaveTool().invoke(
        options({
          objectUri: "adt://dev100/object",
          transportChoice: { type: "existing", number: "DEVK900123" }
        })
      )
    ).rejects.toThrow(/already locked to DEVK900999/)
    expect(mocks.register).not.toHaveBeenCalled()
  })

  it("rejects creating a new request when the object is locked", async () => {
    mocks.getStatus.mockResolvedValue({
      status: "locked",
      transportRequest: "DEVK900999"
    })

    await expect(
      new SetTransportForNextObjectSaveTool().invoke(
        options({
          objectUri: "adt://dev100/object",
          transportChoice: { type: "new", description: "Approved request" }
        })
      )
    ).rejects.toThrow(/Cannot create a new transport/)
    expect(mocks.register).not.toHaveBeenCalled()
  })

  it("rejects non-ADT URIs before checking SAP", async () => {
    await expect(
      new SetTransportForNextObjectSaveTool().invoke(
        options({
          objectUri: "file:///tmp/ztest",
          transportChoice: { type: "existing", number: "DEVK900123" }
        })
      )
    ).rejects.toThrow(/adt/)
    expect(mocks.getStatus).not.toHaveBeenCalled()
  })
})
