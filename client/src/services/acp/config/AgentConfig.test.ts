import { vscodeFake, resetVscodeFake } from "../testing/vscodeFake"
import {
  addAgentInteractive,
  getAgentConfig,
  getAgentConfigs,
  getAgentNames,
  parseCommandLine,
  removeAgentInteractive
} from "./AgentConfig"
import { AGENT_PRESETS } from "./agentPresets"

vi.mock("vscode", async () => (await import("../testing/vscodeFake")).vscodeFake)

const AGENTS = "abapfs.acp.agents"
const { Global, Workspace } = vscodeFake.ConfigurationTarget
const window = vscodeFake.window
const allPresets = () =>
  Object.fromEntries(Object.keys(AGENT_PRESETS).map(n => [n, AGENT_PRESETS[n]]))
const savedAgents = () => vscodeFake.settings.update.mock.lastCall?.[1] as Record<string, unknown>

describe("AgentConfig settings", () => {
  beforeEach(() => resetVscodeFake())

  it("returns only agents with a command", () => {
    vscodeFake.settings.set(AGENTS, {
      Good: { command: "agent", args: ["--acp"] },
      Empty: { command: "" },
      Broken: null
    })
    expect(getAgentConfigs()).toEqual({ Good: { command: "agent", args: ["--acp"] } })
    expect(getAgentNames()).toEqual(["Good"])
    expect(getAgentConfig("Good")?.command).toBe("agent")
    expect(getAgentConfig("Empty")).toBeUndefined()
  })

  it("is empty when nothing is configured", () => {
    expect(getAgentConfigs()).toEqual({})
  })
})

describe("parseCommandLine", () => {
  it.each([
    ["npx -y pkg@latest --acp", ["npx", "-y", "pkg@latest", "--acp"]],
    ['"C:\\Program Files\\agent.exe" --flag', ["C:\\Program Files\\agent.exe", "--flag"]],
    ["agent --name 'two words'  --x", ["agent", "--name", "two words", "--x"]],
    ["   ", []]
  ])("splits %j", (line, expected) => {
    expect(parseCommandLine(line)).toEqual(expected)
  })
})

describe("addAgentInteractive", () => {
  beforeEach(() => resetVscodeFake())

  it("offers unconfigured presets plus a custom entry and saves the pick to user settings", async () => {
    vscodeFake.settings.set(AGENTS, { "Claude Code": AGENT_PRESETS["Claude Code"] })
    window.showQuickPick.mockImplementation(async (items: any[]) =>
      items.find(i => i.label === "Gemini CLI")
    )
    expect(await addAgentInteractive()).toBe("Gemini CLI")
    const [items, options] = window.showQuickPick.mock.lastCall!
    const labels = items.map((i: any) => i.label)
    expect(labels).not.toContain("Claude Code")
    expect(labels.at(-1)).toContain("Custom agent")
    expect(items[0].detail).toBe("npx -y @github/copilot-language-server@latest --acp")
    expect(options.title).toBe("Add ACP Agent")
    expect(vscodeFake.settings.update).toHaveBeenCalledWith(
      AGENTS,
      { "Claude Code": AGENT_PRESETS["Claude Code"], "Gemini CLI": AGENT_PRESETS["Gemini CLI"] },
      Global
    )
  })

  it("keeps agents in workspace settings when they are defined there", async () => {
    vscodeFake.settings.workspaceValues.set(AGENTS, {})
    window.showQuickPick.mockImplementation(async (items: any[]) => items[0])
    await addAgentInteractive()
    expect(vscodeFake.settings.update.mock.lastCall![2]).toBe(Workspace)
  })

  it("saves nothing when the pick is cancelled", async () => {
    window.showQuickPick.mockResolvedValue(undefined)
    expect(await addAgentInteractive()).toBeUndefined()
    expect(vscodeFake.settings.update).not.toHaveBeenCalled()
  })

  it("asks for name, command line and environment of a custom agent", async () => {
    window.showQuickPick.mockImplementation(async (items: any[]) => items.at(-1))
    window.showInputBox
      .mockResolvedValueOnce("  My Agent ")
      .mockResolvedValueOnce('"/opt/my agent/bin" --acp --mode "fast mode"')
      .mockResolvedValueOnce("TOKEN=a=b; DEBUG ;\nEMPTY=")
    expect(await addAgentInteractive()).toBe("My Agent")
    expect(savedAgents()).toEqual({
      "My Agent": {
        command: "/opt/my agent/bin",
        args: ["--acp", "--mode", "fast mode"],
        env: { TOKEN: "a=b", DEBUG: "", EMPTY: "" }
      }
    })
  })

  it("goes straight to a custom agent once every preset is configured", async () => {
    vscodeFake.settings.set(AGENTS, allPresets())
    window.showInputBox
      .mockResolvedValueOnce("Mine")
      .mockResolvedValueOnce("mine")
      .mockResolvedValueOnce("")
    expect(await addAgentInteractive()).toBe("Mine")
    expect(window.showQuickPick).not.toHaveBeenCalled()
    expect(savedAgents()).toMatchObject({ Mine: { command: "mine", args: [], env: {} } })
  })

  it("validates the custom name and command", async () => {
    vscodeFake.settings.set(AGENTS, { ...allPresets(), Taken: { command: "x" } })
    window.showInputBox.mockResolvedValue(undefined)
    await addAgentInteractive()
    const validateName = window.showInputBox.mock.calls[0][0].validateInput
    expect(validateName(" ")).toBe("Name is required")
    expect(validateName("Taken ")).toBe("An agent with this name already exists")
    expect(validateName("Fresh")).toBeUndefined()
    window.showInputBox.mockResolvedValueOnce("Fresh").mockResolvedValueOnce(undefined)
    await addAgentInteractive()
    const validateCommand = window.showInputBox.mock.calls[2][0].validateInput
    expect(validateCommand("")).toBe("Command is required")
    expect(validateCommand("agent")).toBeUndefined()
  })

  it.each([
    ["the name", [undefined]],
    ["the command", ["Name", undefined]],
    ["the environment", ["Name", "cmd", undefined]]
  ])("stops when %s prompt is cancelled", async (_step, answers) => {
    vscodeFake.settings.set(AGENTS, allPresets())
    answers.forEach(answer => window.showInputBox.mockResolvedValueOnce(answer))
    expect(await addAgentInteractive()).toBeUndefined()
    expect(vscodeFake.settings.update).not.toHaveBeenCalled()
  })
})

describe("removeAgentInteractive", () => {
  beforeEach(() => resetVscodeFake())

  it("tells the user when there is nothing to remove", async () => {
    expect(await removeAgentInteractive()).toBeUndefined()
    expect(window.showInformationMessage).toHaveBeenCalledWith("No ACP agents configured.")
  })

  it("removes the chosen agent and keeps the rest, including incomplete entries", async () => {
    vscodeFake.settings.set(AGENTS, {
      A: { command: "a" },
      B: { command: "b" },
      Draft: { command: "" }
    })
    window.showQuickPick.mockResolvedValue("A")
    expect(await removeAgentInteractive()).toBe("A")
    expect(window.showQuickPick.mock.lastCall![0]).toEqual(["A", "B"])
    expect(savedAgents()).toEqual({ B: { command: "b" }, Draft: { command: "" } })
  })

  it("does nothing when cancelled", async () => {
    vscodeFake.settings.set(AGENTS, { A: { command: "a" } })
    window.showQuickPick.mockResolvedValue(undefined)
    expect(await removeAgentInteractive()).toBeUndefined()
    expect(vscodeFake.settings.update).not.toHaveBeenCalled()
  })
})
