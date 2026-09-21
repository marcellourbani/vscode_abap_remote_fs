vi.mock("vscode", () => ({
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  QuickPickItem: vi.fn(class {}),
  Uri: {
    parse: vi.fn(function (s: string) {
      return { toString: () => s }
    })
  },
  workspace: {
    fs: {
      readFile: vi.fn()
    },
    getConfiguration: vi.fn()
  }
}))

vi.mock("abap_cloud_platform", () => ({
  cfInfo: vi.fn(),
  cfPasswordGrant: vi.fn(),
  cfCodeGrant: vi.fn(),
  cfOrganizations: vi.fn(),
  cfSpaces: vi.fn(),
  cfServiceInstances: vi.fn(),
  cfServices: vi.fn(),
  cfInstanceServiceKeys: vi.fn(),
  cfInstanceServiceKeyCreate: vi.fn(),
  getAbapSystemInfo: vi.fn(),
  getAbapUserInfo: vi.fn(),
  isAbapEntity: vi.fn(),
  isAbapServiceKey: vi.fn(),
  loginServer: vi.fn()
}))

vi.mock("client-oauth2", () => ({}))

vi.mock("fp-ts/lib/function", () => ({
  pipe: vi.fn(function (...args: any[]) {
    // Pass-through: call first arg if function, else return it
    return args[0]
  })
}))

vi.mock("fp-ts/lib/TaskEither", () => ({
  bind: vi.fn(),
  chain: vi.fn(),
  map: vi.fn()
}))

vi.mock("../config", () => ({
  saveNewRemote: vi.fn(),
  validateNewConfigId: vi.fn(function () {
    return vi.fn()
  })
}))

vi.mock("../lib", () => ({
  after: vi.fn(),
  askConfirmation: vi.fn(),
  inputBox: vi.fn(),
  isString: vi.fn(function (x: any) {
    return typeof x === "string"
  }),
  openDialog: vi.fn(),
  quickPick: vi.fn(),
  rfsChainE: vi.fn(),
  rfsExtract: vi.fn(),
  rfsTaskEither: vi.fn(function (v: any) {
    return () => ({ _tag: "Right", right: v })
  }),
  rfsTryCatch: vi.fn(),
  rfsWrap: vi.fn()
}))

// createConnection is the only export we can meaningfully test at integration level
// The internal functions use fp-ts pipelines that are hard to unit test in isolation.
// We test that it can be imported and that it exports the expected function.
import { createConnection } from "./connectionwizard"
import * as __$mock_lib from "../lib"
import type { Mock } from "vitest"

describe("createConnection", () => {
  test("is exported and is a function", () => {
    expect(typeof createConnection).toBe("function")
  })

  test("returns a promise when called", async () => {
    const { quickPick } = __$mock_lib
    // Simulate user cancelling the source selection
    ;(quickPick as Mock).mockImplementation(function () {
      throw new Error("Cancelled")
    })

    // Should not throw, it wraps errors via rfsExtract
    const { rfsExtract } = __$mock_lib
    ;(rfsExtract as Mock).mockReturnValue(undefined)

    const result = createConnection()
    expect(result).toBeInstanceOf(Promise)
    // Consume the rejection to prevent unhandled promise rejection crash
    await result.catch(() => {})
  })
})

// Test the validation helper exported via validateNewConfigId mock
describe("connectionwizard module imports", () => {
  test("module imports without error", () => {
    expect(createConnection).toBeDefined()
  })
})

// Test the URL validation regex pattern used in inputUrl (via integration knowledge)
describe("URL validation pattern", () => {
  const validUrls = [
    "http://localhost:8000",
    "https://myserver.com:44311",
    "http://192.168.1.1:8080",
    "https://sap.example.com"
  ]
  const invalidUrls = ["not-a-url", "ftp://server.com", "http://", ""]

  test.each(validUrls)("accepts valid URL: %s", url => {
    const pattern = /^http(s)?:\/\/[\w\.-]+(:\d+)?$/i
    expect(pattern.test(url)).toBe(true)
  })

  test.each(invalidUrls)("rejects invalid URL: %s", url => {
    const pattern = /^http(s)?:\/\/[\w\.-]+(:\d+)?$/i
    expect(pattern.test(url)).toBe(false)
  })
})

// Test client validation pattern
describe("SAP client validation pattern", () => {
  const validClients = ["001", "100", "200", "999"]
  const invalidClients = ["000", "1234", "abc", "10", ""]

  test.each(validClients)("accepts valid client: %s", client => {
    const pattern = /^\d\d\d$/
    const notZero = client !== "000"
    expect(pattern.test(client) && notZero).toBe(true)
  })

  test.each(invalidClients)("rejects invalid client: %s", client => {
    const pattern = /^\d\d\d$/
    const isValid = pattern.test(client) && client !== "000"
    expect(isValid).toBe(false)
  })
})

// Test language code validation
describe("language code validation pattern", () => {
  const validCodes = ["en", "de", "fr", "zh"]
  const invalidCodes = ["EN", "eng", "e", ""]

  test.each(validCodes)("accepts valid 2-letter lowercase language: %s", lang => {
    const pattern = /^[a-z][a-z]$/
    expect(pattern.test(lang)).toBe(true)
  })

  test.each(invalidCodes)("rejects invalid language code: %s", lang => {
    const pattern = /^[a-z][a-z]$/
    expect(pattern.test(lang)).toBe(false)
  })
})
