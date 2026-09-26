// Must mock vscode before any imports that reference it
vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn(),
    workspaceFolders: [] as any[],
    onDidChangeConfiguration: vi.fn()
  },
  Uri: {
    parse: vi.fn(function (s: string) {
      return { toString: () => s }
    }),
    file: (p: string) => ({ fsPath: p, toString: () => p })
  }
}))

vi.mock("../../lib/vscodefunctions", () => ({}))
vi.mock("../../services/funMessenger", () => ({
  funWindow: {
    createOutputChannel: vi.fn(function () {
      return {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn()
      }
    })
  }
}))
vi.mock("abap-adt-api", () => ({
  ADTClient: vi.fn(class {}),
  createSSLConfig: vi.fn(function () {
    return { ssl: true }
  })
}))
vi.mock("../../config", () => ({
  formatKey: vi.fn(function (name: string) {
    return `key:${name}`
  })
}))
vi.mock("../../langClient", () => ({
  configFromKey: vi.fn()
}))
vi.mock("../../oauth", () => ({
  futureToken: vi.fn()
}))
vi.mock("crypto", () => ({
  createHash: vi.fn(function () {
    return {
      update: vi.fn().mockReturnThis(),
      digest: vi.fn(() => "mockhash")
    }
  })
}))

import { md5, newClientFromKey } from "./functions"
import { ADTClient, createSSLConfig } from "abap-adt-api"
import { configFromKey } from "../../langClient"
import { futureToken } from "../../oauth"
import type { MockedClass, MockedFunction, Mock } from "vitest"

const MockADTClient = ADTClient as MockedClass<typeof ADTClient>
const mockConfigFromKey = configFromKey as MockedFunction<typeof configFromKey>
const mockFutureToken = futureToken as MockedFunction<typeof futureToken>

describe("md5", () => {
  test("returns the digest of the hash", () => {
    const result = md5("hello")
    expect(result).toBe("mockhash")
  })

  test("returns a string", () => {
    expect(typeof md5("anything")).toBe("string")
  })
})

describe("newClientFromKey", () => {
  const baseConf = {
    name: "myconn",
    url: "http://my-sap-server",
    username: "TESTUSER",
    password: "secret",
    client: "100",
    language: "EN",
    allowSelfSigned: false,
    customCA: undefined,
    oauth: undefined
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
    MockADTClient.mockImplementation(function () {
      return {} as any
    })
  })

  test("returns undefined when configFromKey returns undefined", async () => {
    mockConfigFromKey.mockResolvedValueOnce(undefined as any)
    const result = await newClientFromKey("somekey")
    expect(result).toBeUndefined()
  })

  test("creates an ADTClient with http config (no SSL)", async () => {
    mockConfigFromKey.mockResolvedValueOnce(baseConf)
    const client = await newClientFromKey("somekey")
    expect(client).toBeDefined()
    expect(MockADTClient).toHaveBeenCalledWith(
      baseConf.url,
      baseConf.username,
      baseConf.password,
      baseConf.client,
      baseConf.language,
      {}
    )
  })

  test("creates an ADTClient with HTTPS SSL config", async () => {
    const httpsConf = { ...baseConf, url: "https://my-sap-server" }
    mockConfigFromKey.mockResolvedValueOnce(httpsConf)
    ;(createSSLConfig as Mock).mockReturnValueOnce({ ssl: true })
    const client = await newClientFromKey("somekey")
    expect(client).toBeDefined()
    expect(createSSLConfig).toHaveBeenCalledWith(httpsConf.allowSelfSigned, httpsConf.customCA)
  })

  test("uses futureToken when oauth config is present", async () => {
    const oauthConf = { ...baseConf, oauth: { clientId: "id" } }
    mockConfigFromKey.mockResolvedValueOnce(oauthConf)
    const fakeToken = vi.fn().mockResolvedValue("token123")
    mockFutureToken.mockReturnValueOnce(Promise.resolve("token123") as any)
    await newClientFromKey("somekey")
    // futureToken is called inside a lambda; ADTClient receives a function
    const pwdOrFetch = MockADTClient.mock.calls[0][2]
    expect(typeof pwdOrFetch).toBe("function")
  })

  test("passes extra options to ADTClient on HTTPS", async () => {
    const httpsConf = { ...baseConf, url: "https://secure" }
    mockConfigFromKey.mockResolvedValueOnce(httpsConf)
    ;(createSSLConfig as Mock).mockReturnValueOnce({ ssl: true })
    await newClientFromKey("somekey", { timeout: 5000 } as any)
    // SSL config should be merged with options
    const callArgs = MockADTClient.mock.calls[0]
    expect(callArgs[5]).toMatchObject({ ssl: true })
  })
})
