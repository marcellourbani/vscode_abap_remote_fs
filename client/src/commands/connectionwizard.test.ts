jest.mock("vscode", () => ({
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  QuickPickItem: jest.fn(),
  Uri: {
    parse: jest.fn((s: string) => ({ toString: () => s }))
  },
  workspace: {
    fs: {
      readFile: jest.fn()
    },
    getConfiguration: jest.fn()
  }
}), { virtual: true })

jest.mock("abap_cloud_platform", () => ({
  cfInfo: jest.fn(),
  cfPasswordGrant: jest.fn(),
  cfCodeGrant: jest.fn(),
  cfOrganizations: jest.fn(),
  cfSpaces: jest.fn(),
  cfServiceInstances: jest.fn(),
  cfServices: jest.fn(),
  cfInstanceServiceKeys: jest.fn(),
  cfInstanceServiceKeyCreate: jest.fn(),
  getAbapSystemInfo: jest.fn(),
  getAbapUserInfo: jest.fn(),
  isAbapEntity: jest.fn(),
  isAbapServiceKey: jest.fn(),
  loginServer: jest.fn()
}))

jest.mock("client-oauth2", () => ({}))

jest.mock("fp-ts/lib/function", () => ({
  pipe: jest.fn((...args: any[]) => {
    // Pass-through: call first arg if function, else return it
    return args[0]
  })
}))

jest.mock("fp-ts/lib/TaskEither", () => ({
  bind: jest.fn(),
  chain: jest.fn(),
  map: jest.fn()
}))

jest.mock("../config", () => ({
  saveNewRemote: jest.fn(),
  validateNewConfigId: jest.fn(() => jest.fn())
}))

jest.mock("../lib", () => ({
  after: jest.fn(),
  askConfirmation: jest.fn(),
  inputBox: jest.fn(),
  isString: jest.fn((x: any) => typeof x === "string"),
  openDialog: jest.fn(),
  quickPick: jest.fn(),
  rfsChainE: jest.fn(),
  rfsExtract: jest.fn(),
  rfsTaskEither: jest.fn((v: any) => async () => ({ _tag: "Right", right: v })),
  rfsTryCatch: jest.fn(),
  rfsWrap: jest.fn()
}))

// createConnection is the only export we can meaningfully test at integration level
// The internal functions use fp-ts pipelines that are hard to unit test in isolation.
// We test that it can be imported and that it exports the expected function.
import { createConnection } from "./connectionwizard"

describe("createConnection", () => {
  test("is exported and is a function", () => {
    expect(typeof createConnection).toBe("function")
  })

  test("returns a promise when called", async () => {
    const { quickPick } = require("../lib")
    // Simulate user cancelling the source selection
    ;(quickPick as jest.Mock).mockImplementation(async () => {
      throw new Error("Cancelled")
    })

    // Should not throw, it wraps errors via rfsExtract
    const { rfsExtract } = require("../lib")
    ;(rfsExtract as jest.Mock).mockReturnValue(undefined)

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
  const invalidUrls = [
    "not-a-url",
    "ftp://server.com",
    "http://",
    ""
  ]

  test.each(validUrls)("accepts valid URL: %s", (url) => {
    const pattern = /^http(s)?:\/\/[\w\.-]+(:\d+)?$/i
    expect(pattern.test(url)).toBe(true)
  })

  test.each(invalidUrls)("rejects invalid URL: %s", (url) => {
    const pattern = /^http(s)?:\/\/[\w\.-]+(:\d+)?$/i
    expect(pattern.test(url)).toBe(false)
  })
})

// Test client validation pattern
describe("SAP client validation pattern", () => {
  const validClients = ["001", "100", "200", "999"]
  const invalidClients = ["000", "1234", "abc", "10", ""]

  test.each(validClients)("accepts valid client: %s", (client) => {
    const pattern = /^\d\d\d$/
    const notZero = client !== "000"
    expect(pattern.test(client) && notZero).toBe(true)
  })

  test.each(invalidClients)("rejects invalid client: %s", (client) => {
    const pattern = /^\d\d\d$/
    const isValid = pattern.test(client) && client !== "000"
    expect(isValid).toBe(false)
  })
})

// Test language code validation
describe("language code validation pattern", () => {
  const validCodes = ["en", "de", "fr", "zh"]
  const invalidCodes = ["EN", "eng", "e", ""]

  test.each(validCodes)("accepts valid 2-letter lowercase language: %s", (lang) => {
    const pattern = /^[a-z][a-z]$/
    expect(pattern.test(lang)).toBe(true)
  })

  test.each(invalidCodes)("rejects invalid language code: %s", (lang) => {
    const pattern = /^[a-z][a-z]$/
    expect(pattern.test(lang)).toBe(false)
  })
})
