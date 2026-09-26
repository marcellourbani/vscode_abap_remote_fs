vi.mock("vscode", () => ({
  Uri: {
    parse: vi.fn(function (s: string) {
      return {
        scheme: s.split("://")[0] || "ABAPGIT",
        authority: s.split("://")[1]?.split("?")[0] || "",
        query: s.split("?")[1] || "",
        toString: () => s
      }
    })
  },
  workspace: {
    registerTextDocumentContentProvider: vi.fn()
  }
}))

vi.mock("./scm", () => ({
  scmKey: vi.fn(function (auth: string, key: string) {
    return `abapGit_${auth}_${key}`
  }),
  scmData: vi.fn()
}))

vi.mock("../../lib", () => ({
  atob: vi.fn(function (s: string) {
    return Buffer.from(s, "base64").toString("utf-8")
  }),
  btoa: vi.fn(function (s: string) {
    return Buffer.from(s).toString("base64")
  })
}))

vi.mock("abap-adt-api", () => ({}))

vi.mock("../../adt/conections", () => ({
  getClient: vi.fn()
}))

import { scmData } from "./scm"
import { btoa, atob } from "../../lib"
import * as __$mock_vscode from "vscode"
import * as __$mock_adt_conections from "../../adt/conections"
import * as __$mock_scm from "./scm"
import type { TextDocumentContentProvider } from "vscode"
import type { Mock } from "vitest"

// documentProvider ⇄ scm is a circular import; vitest's ESM init needs it evaluated
// dynamically AFTER the vi.mocks are established. The provider is registered when
// registerGitDocProvider() is called, so we invoke it here and capture gitUrl plus
// the registered scheme/provider for all tests below.
let gitUrl: (data: any, path: string, file: any) => any
let registeredProvider: TextDocumentContentProvider
let registeredScheme: unknown

beforeAll(async () => {
  const dp = await import("./documentProvider")
  gitUrl = dp.gitUrl
  dp.registerGitDocProvider()
  const register = __$mock_vscode.workspace.registerTextDocumentContentProvider as Mock
  const firstCall = register.mock.calls[0]
  registeredScheme = firstCall?.[0]
  registeredProvider = firstCall?.[1] as unknown as TextDocumentContentProvider
})

describe("gitUrl", () => {
  it("returns an ABAPGIT URI", () => {
    const { Uri } = __$mock_vscode
    const data: any = {
      connId: "myconn",
      repo: { key: "ZPACKAGE" }
    }
    const file: any = { name: "ZCL_TEST.clas.abap" }
    const url = gitUrl(data, "/sap/bc/adt/abapgit/path/object", file)
    expect(Uri.parse).toHaveBeenCalledWith(expect.stringContaining("ABAPGIT://"))
  })

  it("encodes key and path in query", () => {
    const { Uri } = __$mock_vscode
    const mockBtoa = btoa as Mock
    const data: any = { connId: "conn1", repo: { key: "ZREPOKEY" } }
    const file: any = { name: "foo.abap" }
    const path = "/sap/bc/adt/path"
    gitUrl(data, path, file)
    expect(mockBtoa).toHaveBeenCalledWith(JSON.stringify({ key: "ZREPOKEY", path }))
  })

  it("uses connId as URI authority", () => {
    const { Uri } = __$mock_vscode
    const data: any = { connId: "dev100", repo: { key: "ZPKG" } }
    const file: any = { name: "test.abap" }
    gitUrl(data, "/path", file)
    const uriStr = (Uri.parse as Mock).mock.calls.at(-1)?.[0] as string
    expect(uriStr).toContain("dev100")
  })
})

describe("GitDocProvider.provideTextDocumentContent", () => {
  // The provider is registered via registerGitDocProvider(); we test its behavior indirectly
  it("registers provider with the ABAPGIT scheme", () => {
    expect(registeredScheme).toBe("ABAPGIT")
    expect(registeredProvider).toBeDefined()
  })

  it("throws for non-ABAPGIT scheme URIs", async () => {
    // Import the module to get access to the provider instance via workspace mock
    const badUri: any = { scheme: "file", query: "", authority: "" }
    await expect(
      registeredProvider.provideTextDocumentContent(badUri, null as any)
    ).rejects.toThrow("Unexpected URI scheme")
  })

  it("throws for invalid (missing key) URLs", async () => {
    const mockAtob = atob as Mock
    mockAtob.mockReturnValueOnce(JSON.stringify({ key: "", path: "/path" }))
    const mockScmData = scmData as Mock
    mockScmData.mockReturnValue(undefined)

    const uri: any = { scheme: "ABAPGIT", query: "xxx", authority: "conn" }
    await expect(registeredProvider.provideTextDocumentContent(uri, null as any)).rejects.toThrow(
      "Invalid URL"
    )
  })

  it("calls getObjectSource with correct path when valid", async () => {
    const mockAtob = atob as Mock
    mockAtob.mockReturnValueOnce(JSON.stringify({ key: "ZPKG", path: "/sap/bc/adt/path" }))

    const mockScmData = scmData as Mock
    const mockGetObjectSource = vi.fn().mockResolvedValue("ABAP source code")
    const { getClient } = __$mock_adt_conections
    ;(getClient as Mock).mockReturnValue({ getObjectSource: mockGetObjectSource })
    mockScmData.mockReturnValue({
      credentials: { user: "user1", password: "pass1" },
      repo: { key: "ZPKG" }
    })
    ;(__$mock_scm.scmKey as Mock).mockReturnValue("abapGit_conn_ZPKG")

    const uri: any = { scheme: "ABAPGIT", query: "xxx", authority: "conn" }
    const result = await registeredProvider.provideTextDocumentContent(uri, null as any)
    expect(mockGetObjectSource).toHaveBeenCalledWith(
      "/sap/bc/adt/path",
      expect.objectContaining({ gitUser: "user1", gitPassword: "pass1" })
    )
    expect(result).toBe("ABAP source code")
  })

  it("encodes # as %23 in path before calling getObjectSource", async () => {
    const mockAtob = atob as Mock
    mockAtob.mockReturnValueOnce(JSON.stringify({ key: "ZPKG", path: "/sap/path/with#hash" }))

    const mockGetObjectSource = vi.fn().mockResolvedValue("")
    const { getClient } = __$mock_adt_conections
    ;(getClient as Mock).mockReturnValue({ getObjectSource: mockGetObjectSource })
    ;(scmData as Mock).mockReturnValue({
      credentials: undefined,
      repo: { key: "ZPKG" }
    })

    const uri: any = { scheme: "ABAPGIT", query: "xxx", authority: "conn" }
    await registeredProvider.provideTextDocumentContent(uri, null as any)
    const calledPath = mockGetObjectSource.mock.calls[0]?.[0] as string
    expect(calledPath).not.toContain("#")
    expect(calledPath).toContain("%23")
  })
})
