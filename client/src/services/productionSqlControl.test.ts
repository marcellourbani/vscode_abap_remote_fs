vi.mock("vscode", () => ({
  ConfigurationTarget: { Global: 1 },
  commands: { registerCommand: vi.fn() },
  workspace: { getConfiguration: vi.fn() }
}))

vi.mock("../config", () => ({
  connectedRoots: vi.fn(),
  formatKey: vi.fn(function (connectionId: string) {
    return connectionId.toLowerCase()
  })
}))

vi.mock("./funMessenger", () => ({
  funWindow: {
    showQuickPick: vi.fn(),
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn()
  }
}))

import { ConfigurationTarget, workspace } from "vscode"
import { connectedRoots } from "../config"
import { funWindow as window } from "./funMessenger"
import {
  clearSessionProductionSqlPreferences,
  configureProductionSqlControl,
  getProductionSqlPreference,
  setSessionProductionSqlPreference
} from "./productionSqlControl"
import type { MockedFunction, Mock } from "vitest"

const mockConnectedRoots = connectedRoots as MockedFunction<typeof connectedRoots>
const mockGetConfiguration = workspace.getConfiguration as Mock
const mockShowQuickPick = window.showQuickPick as Mock
const mockShowWarningMessage = window.showWarningMessage as Mock
const mockShowInformationMessage = window.showInformationMessage as Mock

function configureGlobalPreferences(globalValue: Record<string, "allow"> = {}) {
  const update = vi.fn().mockResolvedValue(undefined)
  mockGetConfiguration.mockReturnValue({
    inspect: vi.fn(function () {
      return { globalValue }
    }),
    update
  })
  return update
}

describe("production SQL control", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearSessionProductionSqlPreferences()
    mockConnectedRoots.mockReturnValue(new Map())
    configureGlobalPreferences()
  })

  it("normalizes connection IDs through formatKey for session preferences", () => {
    setSessionProductionSqlPreference("PRD100")

    expect(getProductionSqlPreference("prd100")).toBe("allow")
  })

  it("reads mixed-case global preference keys through formatKey", () => {
    configureGlobalPreferences({ PRD100: "allow" })

    expect(getProductionSqlPreference("prd100")).toBe("allow")
  })

  it("uses connected roots for the connection picker", async () => {
    mockConnectedRoots.mockReturnValue(
      new Map([
        ["prd100", {} as any],
        ["dev100", {} as any]
      ])
    )
    mockShowQuickPick.mockResolvedValueOnce(undefined)

    await configureProductionSqlControl()

    expect(mockShowQuickPick).toHaveBeenCalledWith(["dev100", "prd100"], {
      title: "Configure Production SQL Control",
      placeHolder: "Select an SAP connection"
    })
  })

  it("warns when no SAP connection is connected", async () => {
    await configureProductionSqlControl()

    expect(mockShowWarningMessage).toHaveBeenCalledWith("No SAP systems are currently connected.")
    expect(mockShowQuickPick).not.toHaveBeenCalled()
  })

  it("stores an allow-always preference globally", async () => {
    const update = configureGlobalPreferences({ dev100: "allow" })
    mockConnectedRoots.mockReturnValue(new Map([["prd100", {} as any]]))
    mockShowQuickPick.mockResolvedValueOnce("prd100").mockResolvedValueOnce("Allow always")

    await configureProductionSqlControl()

    expect(update).toHaveBeenCalledWith(
      "productionSqlControl",
      { dev100: "allow", prd100: "allow" },
      ConfigurationTarget.Global
    )
    expect(mockShowInformationMessage).toHaveBeenCalledWith(
      "Production SQL allowed for prd100 across workspaces."
    )
  })

  it("resets both session and global preferences", async () => {
    const update = configureGlobalPreferences({ prd100: "allow", dev100: "allow" })
    setSessionProductionSqlPreference("PRD100")
    mockConnectedRoots.mockReturnValue(new Map([["prd100", {} as any]]))
    mockShowQuickPick.mockResolvedValueOnce("prd100").mockResolvedValueOnce("Reset preference")

    await configureProductionSqlControl()

    expect(update).toHaveBeenCalledWith(
      "productionSqlControl",
      { dev100: "allow" },
      ConfigurationTarget.Global
    )
    configureGlobalPreferences({ dev100: "allow" })
    expect(getProductionSqlPreference("prd100")).toBeUndefined()
  })
})
