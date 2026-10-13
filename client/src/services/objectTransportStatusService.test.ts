import { vi } from "vitest"

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  getClient: vi.fn(),
  getOrCreateRoot: vi.fn()
}))

vi.mock("abapfs", () => ({
  isAbapFile: vi.fn((node: any) => node.kind === "file"),
  isAbapFolder: vi.fn((node: any) => node.kind === "folder")
}))

vi.mock("../adt/conections", () => ({
  getClient: mocks.getClient,
  getOrCreateRoot: mocks.getOrCreateRoot
}))

vi.mock("./abapResourceDownloadService", () => ({
  resolveAbapResource: mocks.resolve
}))

import { getAbapObjectTransportStatus } from "./objectTransportStatusService"

describe("getAbapObjectTransportStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolve.mockResolvedValue({
      scheme: "adt",
      path: "/workspace/ztest",
      toString: () => "adt://target100/workspace/ztest"
    })
    mocks.getOrCreateRoot.mockResolvedValue({
      getNodeAsync: vi.fn().mockResolvedValue({
        kind: "file",
        object: { contentsPath: vi.fn(() => "/sap/bc/adt/programs/programs/ztest/source/main") }
      })
    })
  })

  it("returns the transport locking one target object", async () => {
    const transportInfo = vi.fn().mockResolvedValue({
      LOCKS: { HEADER: { TRKORR: "DEVK900123", AS4TEXT: "Repository apply" } },
      TRANSPORTS: [],
      DLVUNIT: "HOME"
    })
    mocks.getClient.mockReturnValue({ transportInfo })

    const result = await getAbapObjectTransportStatus({
      connectionId: "TARGET100",
      source: "ZTEST",
      objectType: "PROG",
      packageName: "ZPKG"
    })

    expect(transportInfo).toHaveBeenCalledWith(
      "/sap/bc/adt/programs/programs/ztest/source/main",
      "ZPKG",
      ""
    )
    expect(result).toMatchObject({
      connectionId: "target100",
      status: "locked",
      transportRequest: "DEVK900123",
      transportDescription: "Repository apply"
    })
  })

  it("distinguishes an unlocked object from a local object", async () => {
    const transportInfo = vi
      .fn()
      .mockResolvedValueOnce({ TRANSPORTS: [], DLVUNIT: "HOME" })
      .mockResolvedValueOnce({ TRANSPORTS: [], DLVUNIT: "LOCAL" })
    mocks.getClient.mockReturnValue({ transportInfo })

    const unlocked = await getAbapObjectTransportStatus({
      connectionId: "target100",
      source: "ZTEST"
    })
    const local = await getAbapObjectTransportStatus({
      connectionId: "target100",
      source: "ZLOCAL"
    })

    expect(unlocked.status).toBe("not-locked")
    expect(local.status).toBe("local")
  })

  it("reports no transport when SAP has no usable request", async () => {
    const transportInfo = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "No existing request can be used for change recording; " +
            "No authorization to create new workbench request"
        )
      )
    mocks.getClient.mockReturnValue({ transportInfo })

    const result = await getAbapObjectTransportStatus({
      connectionId: "target100",
      source: "ZTEST"
    })

    expect(result).toMatchObject({
      status: "no-transport",
      transportRequest: "",
      transportDescription: "No transport request available"
    })
    expect(result.transportCheckError).toContain("No existing request")
  })

  it("keeps unrelated transport-check failures as errors", async () => {
    const transportInfo = vi.fn().mockRejectedValue(new Error("Connection failed"))
    mocks.getClient.mockReturnValue({ transportInfo })

    await expect(
      getAbapObjectTransportStatus({
        connectionId: "target100",
        source: "ZTEST"
      })
    ).rejects.toThrow("Connection failed")
  })
})
