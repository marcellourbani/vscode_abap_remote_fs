jest.mock("abap-adt-api", () => ({
  ADTClient: jest.fn(),
  createSSLConfig: jest.fn(() => ({ ssl: true }))
}))
jest.mock("../../config", () => ({
  formatKey: jest.fn((name: string) => `key:${name}`)
}))
jest.mock("../../langClient", () => ({
  configFromKey: jest.fn()
}))
jest.mock("../../oauth", () => ({
  futureToken: jest.fn()
}))
jest.mock("crypto", () => ({
  createHash: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn(() => "mockhash")
  }))
}))

import { md5, newClientFromKey } from "./functions"
import { ADTClient, createSSLConfig } from "abap-adt-api"
import { configFromKey } from "../../langClient"
import { futureToken } from "../../oauth"

const MockADTClient = ADTClient as jest.MockedClass<typeof ADTClient>
const mockConfigFromKey = configFromKey as jest.MockedFunction<typeof configFromKey>
const mockFutureToken = futureToken as jest.MockedFunction<typeof futureToken>

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
    jest.clearAllMocks()
    MockADTClient.mockImplementation(() => ({} as any))
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
    ;(createSSLConfig as jest.Mock).mockReturnValueOnce({ ssl: true })
    const client = await newClientFromKey("somekey")
    expect(client).toBeDefined()
    expect(createSSLConfig).toHaveBeenCalledWith(httpsConf.allowSelfSigned, httpsConf.customCA)
  })

  test("uses futureToken when oauth config is present", async () => {
    const oauthConf = { ...baseConf, oauth: { clientId: "id" } }
    mockConfigFromKey.mockResolvedValueOnce(oauthConf)
    const fakeToken = jest.fn().mockResolvedValue("token123")
    mockFutureToken.mockReturnValueOnce(Promise.resolve("token123") as any)
    await newClientFromKey("somekey")
    // futureToken is called inside a lambda; ADTClient receives a function
    const pwdOrFetch = MockADTClient.mock.calls[0][2]
    expect(typeof pwdOrFetch).toBe("function")
  })

  test("passes extra options to ADTClient on HTTPS", async () => {
    const httpsConf = { ...baseConf, url: "https://secure" }
    mockConfigFromKey.mockResolvedValueOnce(httpsConf)
    ;(createSSLConfig as jest.Mock).mockReturnValueOnce({ ssl: true })
    await newClientFromKey("somekey", { timeout: 5000 } as any)
    // SSL config should be merged with options
    const callArgs = MockADTClient.mock.calls[0]
    expect(callArgs[5]).toMatchObject({ ssl: true })
  })
})
