import { AcpClientImpl } from "./AcpClientImpl"

import type { ClientApp } from "@agentclientprotocol/sdk"

vi.mock("../utils/Logger", () => ({ log: vi.fn() }))
vi.mock("../handlers/FileSystemHandler", () => ({}))
vi.mock("../handlers/TerminalHandler", () => ({}))
vi.mock("../handlers/PermissionHandler", () => ({}))
vi.mock("../handlers/ElicitationHandler", () => ({}))
vi.mock("../handlers/SessionUpdateHandler", () => ({}))

type Route = (context: { params: unknown }) => unknown

function fakeApp() {
  const requests = new Map<string, Route>()
  const notifications = new Map<string, Route>()
  const app = {
    onRequest: vi.fn((method: string, route: Route) => (requests.set(method, route), app)),
    onNotification: vi.fn((method: string, route: Route) => (notifications.set(method, route), app))
  }
  return { app, requests, notifications }
}

const handlers = () => ({
  fs: { readTextFile: vi.fn(() => "read"), writeTextFile: vi.fn(() => "written") },
  terminal: {
    createTerminal: vi.fn(() => "created"),
    terminalOutput: vi.fn(() => "output"),
    waitForTerminalExit: vi.fn(() => "exited"),
    killTerminal: vi.fn(() => "killed"),
    releaseTerminal: vi.fn(() => "released")
  },
  permission: { requestPermission: vi.fn(() => "allowed") },
  elicitation: { createElicitation: vi.fn(() => "answered") },
  updates: { handleUpdate: vi.fn() }
})

describe("AcpClientImpl", () => {
  const h = handlers()
  const { app, requests, notifications } = fakeApp()
  new AcpClientImpl(
    h.fs as any,
    h.terminal as any,
    h.permission as any,
    h.elicitation as any,
    h.updates as any
  ).register(app as unknown as ClientApp)

  it.each([
    ["session/request_permission", h.permission.requestPermission, "allowed"],
    ["fs/read_text_file", h.fs.readTextFile, "read"],
    ["fs/write_text_file", h.fs.writeTextFile, "written"],
    ["terminal/create", h.terminal.createTerminal, "created"],
    ["terminal/output", h.terminal.terminalOutput, "output"],
    ["terminal/wait_for_exit", h.terminal.waitForTerminalExit, "exited"],
    ["terminal/kill", h.terminal.killTerminal, "killed"],
    ["terminal/release", h.terminal.releaseTerminal, "released"],
    ["elicitation/create", h.elicitation.createElicitation, "answered"]
  ])("routes %s requests to their handler", (method, target, answer) => {
    const params = { method, path: "/x" }
    expect(requests.get(method)!({ params })).toBe(answer)
    expect(target).toHaveBeenCalledWith(params)
  })

  it("registers exactly the supported client methods", () => {
    expect(requests.size).toBe(9)
    expect([...notifications.keys()]).toEqual(["session/update"])
  })

  it("forwards session updates", () => {
    const params = { sessionId: "s1", update: {} }
    notifications.get("session/update")!({ params })
    expect(h.updates.handleUpdate).toHaveBeenCalledWith(params)
  })
})
