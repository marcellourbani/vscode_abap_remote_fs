jest.mock(
  "vscode",
  () => ({
    LanguageModelToolResult: jest.fn().mockImplementation((parts: any[]) => ({ parts })),
    LanguageModelTextPart: jest.fn().mockImplementation((text: string) => ({ text })),
    workspace: {
      workspaceFolders: [],
      getConfiguration: jest.fn()
    }
  }),
  { virtual: true }
)

jest.mock("../telemetry", () => ({ logTelemetry: jest.fn() }))
jest.mock("./toolRegistry", () => ({
  registerToolWithRegistry: jest.fn(() => ({ dispose: jest.fn() }))
}))
jest.mock("../../config", () => ({ getConfig: jest.fn() }))
jest.mock("./toolGuard", () => ({ assertToolInvocationAuthorized: jest.fn() }))

import { ConfiguredSystemsTool } from "./configuredSystemsTool"
import { getConfig } from "../../config"

const mockToken = {} as any

function makeOptions(input: any = {}) {
  return { input } as any
}

const packageJSON = {
  contributes: {
    configuration: {
      properties: {
        "abapfs.remote": {
          patternProperties: {
            "[a-zA-Z][a-zA-Z0-9_]+": {
              properties: {
                url: { default: "https://myserver:44300" },
                username: { default: "developer" },
                client: { default: "001" },
                language: { default: "en" },
                newOption: { default: true },
                oauth: {
                  properties: {
                    clientId: {},
                    clientSecret: {},
                    saveCredentials: { default: false }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

describe("ConfiguredSystemsTool", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("lists IDs without expanding every system", async () => {
    const inspect = jest.fn().mockReturnValue({
      globalValue: {
        DEV100: { client: "100" },
        QAS200: { client: "200" }
      }
    })
    ;(getConfig as jest.Mock).mockReturnValue({ inspect })

    const result: any = await new ConfiguredSystemsTool(packageJSON).invoke(
      makeOptions(),
      mockToken
    )
    const output = JSON.parse(result.parts[0].text)

    expect(output).toEqual({
      connectionIds: ["DEV100", "QAS200"],
      settingsSource: "global"
    })
    expect(output).not.toHaveProperty("settings")
    expect(output).not.toHaveProperty("defaults")
    expect(output).not.toHaveProperty("configuredSystems")
  })

  it("returns one system with grouped configured values and package defaults", async () => {
    const inspect = jest.fn((key: string) => {
      if (key === "remote") {
        return {
          globalValue: {
            DEV100: {
              url: "https://secret-host",
              username: "developer",
              password: "secret",
              client: "100",
              oauth: {
                clientId: "client-id",
                clientSecret: "client-secret"
              },
              newOption: false
            }
          },
          workspaceValue: { DEV100: { client: "200" } },
          workspaceFolderValue: {}
        }
      }
      if (key === "remote.DEV100.client") {
        return { defaultValue: "001", globalValue: "100", workspaceValue: "200" }
      }
      if (key === "remote.DEV100.newOption") {
        return { defaultValue: true, globalValue: false }
      }
      if (key === "remote.DEV100.oauth.clientId") {
        return { globalValue: "client-id" }
      }
      return {}
    })
    ;(getConfig as jest.Mock).mockReturnValue({ inspect })

    const result: any = await new ConfiguredSystemsTool(packageJSON).invoke(
      makeOptions({ connectionId: "dev100" }),
      mockToken
    )
    const output = JSON.parse(result.parts[0].text)
    const { settings, defaults } = output

    expect(output.connectionId).toBe("DEV100")
    expect(output.settingsSource).toBe("global")
    expect(output.defaultsSource).toBe("package.json")
    expect(settings.client).toBe("100")
    expect(settings.newOption).toBe(false)
    expect(settings.oauth.clientId).toBe("client-id")
    expect(defaults.language).toBe("en")
    expect(defaults.oauth.saveCredentials).toBe(false)
    expect(JSON.stringify(output)).not.toContain("secret-host")
    expect(JSON.stringify(output)).not.toContain("developer")
    expect(JSON.stringify(output)).not.toContain("client-secret")
    expect(output).not.toHaveProperty("securityNote")
    expect(output).not.toHaveProperty("redactedSettings")
  })

  it("returns an empty ID list when no remotes exist", async () => {
    ;(getConfig as jest.Mock).mockReturnValue({
      inspect: jest.fn().mockReturnValue({ globalValue: {}, workspaceValue: {} })
    })

    const result: any = await new ConfiguredSystemsTool(packageJSON).invoke(
      makeOptions(),
      mockToken
    )
    expect(JSON.parse(result.parts[0].text).connectionIds).toEqual([])
  })

  it("rejects unknown connection IDs", async () => {
    ;(getConfig as jest.Mock).mockReturnValue({
      inspect: jest.fn().mockReturnValue({ globalValue: { DEV100: {} } })
    })

    await expect(
      new ConfiguredSystemsTool(packageJSON).invoke(
        makeOptions({ connectionId: "missing" }),
        mockToken
      )
    ).rejects.toThrow('No configured SAP system found for connectionId "missing"')
  })

  it("wraps configuration errors", async () => {
    ;(getConfig as jest.Mock).mockImplementation(() => {
      throw new Error("config error")
    })

    await expect(
      new ConfiguredSystemsTool(packageJSON).invoke(makeOptions(), mockToken)
    ).rejects.toThrow("Failed to get configured systems: config error")
  })
})
