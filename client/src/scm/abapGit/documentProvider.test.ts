jest.mock("vscode", () => ({
  Uri: {
    parse: jest.fn((s: string) => ({
      scheme: s.split("://")[0] || "ABAPGIT",
      authority: s.split("://")[1]?.split("?")[0] || "",
      query: s.split("?")[1] || "",
      toString: () => s
    }))
  },
  workspace: {
    registerTextDocumentContentProvider: jest.fn()
  }
}), { virtual: true })

jest.mock("./scm", () => ({
  scmKey: jest.fn((auth: string, key: string) => `abapGit_${auth}_${key}`),
  scmData: jest.fn()
}))

jest.mock("../../lib", () => ({
  atob: jest.fn((s: string) => Buffer.from(s, "base64").toString("utf-8")),
  btoa: jest.fn((s: string) => Buffer.from(s).toString("base64"))
}))

jest.mock("abap-adt-api", () => ({}))

jest.mock("../../adt/conections", () => ({
  getClient: jest.fn()
}))

import { gitUrl } from "./documentProvider"
import { scmData } from "./scm"
import { btoa, atob } from "../../lib"

describe("gitUrl", () => {
  it("returns an ABAPGIT URI", () => {
    const { Uri } = require("vscode")
    const data: any = {
      connId: "myconn",
      repo: { key: "ZPACKAGE" }
    }
    const file: any = { name: "ZCL_TEST.clas.abap" }
    const url = gitUrl(data, "/sap/bc/adt/abapgit/path/object", file)
    expect(Uri.parse).toHaveBeenCalledWith(expect.stringContaining("ABAPGIT://"))
  })

  it("encodes key and path in query", () => {
    const { Uri } = require("vscode")
    const mockBtoa = btoa as jest.Mock
    const data: any = { connId: "conn1", repo: { key: "ZREPOKEY" } }
    const file: any = { name: "foo.abap" }
    const path = "/sap/bc/adt/path"
    gitUrl(data, path, file)
    expect(mockBtoa).toHaveBeenCalledWith(
      JSON.stringify({ key: "ZREPOKEY", path })
    )
  })

  it("uses connId as URI authority", () => {
    const { Uri } = require("vscode")
    const data: any = { connId: "dev100", repo: { key: "ZPKG" } }
    const file: any = { name: "test.abap" }
    gitUrl(data, "/path", file)
    const uriStr = (Uri.parse as jest.Mock).mock.calls.at(-1)?.[0] as string
    expect(uriStr).toContain("dev100")
  })
})

describe("GitDocProvider.provideTextDocumentContent", () => {
  // The provider is registered at module load time; we test its behavior indirectly
  it("registers provider at module load", () => {
    const { workspace } = require("vscode")
    expect(workspace.registerTextDocumentContentProvider).toHaveBeenCalledWith(
      "ABAPGIT",
      expect.any(Object)
    )
  })

  it("throws for non-ABAPGIT scheme URIs", async () => {
    // Import the module to get access to the provider instance via workspace mock
    const registeredProvider = (require("vscode").workspace.registerTextDocumentContentProvider as jest.Mock).mock.calls[0][1]
    const badUri: any = { scheme: "file", query: "", authority: "" }
    await expect(registeredProvider.provideTextDocumentContent(badUri)).rejects.toThrow("Unexpected URI scheme")
  })

  it("throws for invalid (missing key) URLs", async () => {
    const mockAtob = atob as jest.Mock
    mockAtob.mockReturnValueOnce(JSON.stringify({ key: "", path: "/path" }))
    const mockScmData = scmData as jest.Mock
    mockScmData.mockReturnValue(undefined)

    const registeredProvider = (require("vscode").workspace.registerTextDocumentContentProvider as jest.Mock).mock.calls[0][1]
    const uri: any = { scheme: "ABAPGIT", query: "xxx", authority: "conn" }
    await expect(registeredProvider.provideTextDocumentContent(uri)).rejects.toThrow("Invalid URL")
  })

  it("calls getObjectSource with correct path when valid", async () => {
    const mockAtob = atob as jest.Mock
    mockAtob.mockReturnValueOnce(JSON.stringify({ key: "ZPKG", path: "/sap/bc/adt/path" }))

    const mockScmData = scmData as jest.Mock
    const mockGetObjectSource = jest.fn().mockResolvedValue("ABAP source code")
    const { getClient } = require("../../adt/conections")
    ;(getClient as jest.Mock).mockReturnValue({ getObjectSource: mockGetObjectSource })
    mockScmData.mockReturnValue({
      credentials: { user: "user1", password: "pass1" },
      repo: { key: "ZPKG" }
    })
    ;(require("./scm").scmKey as jest.Mock).mockReturnValue("abapGit_conn_ZPKG")

    const registeredProvider = (require("vscode").workspace.registerTextDocumentContentProvider as jest.Mock).mock.calls[0][1]
    const uri: any = { scheme: "ABAPGIT", query: "xxx", authority: "conn" }
    const result = await registeredProvider.provideTextDocumentContent(uri)
    expect(mockGetObjectSource).toHaveBeenCalledWith(
      "/sap/bc/adt/path",
      expect.objectContaining({ gitUser: "user1", gitPassword: "pass1" })
    )
    expect(result).toBe("ABAP source code")
  })

  it("encodes # as %23 in path before calling getObjectSource", async () => {
    const mockAtob = atob as jest.Mock
    mockAtob.mockReturnValueOnce(JSON.stringify({ key: "ZPKG", path: "/sap/path/with#hash" }))

    const mockGetObjectSource = jest.fn().mockResolvedValue("")
    const { getClient } = require("../../adt/conections")
    ;(getClient as jest.Mock).mockReturnValue({ getObjectSource: mockGetObjectSource })
    ;(scmData as jest.Mock).mockReturnValue({
      credentials: undefined,
      repo: { key: "ZPKG" }
    })

    const registeredProvider = (require("vscode").workspace.registerTextDocumentContentProvider as jest.Mock).mock.calls[0][1]
    const uri: any = { scheme: "ABAPGIT", query: "xxx", authority: "conn" }
    await registeredProvider.provideTextDocumentContent(uri)
    const calledPath = mockGetObjectSource.mock.calls[0]?.[0] as string
    expect(calledPath).not.toContain("#")
    expect(calledPath).toContain("%23")
  })
})
