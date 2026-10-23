// The bridge is a standalone script that starts on import, so each test imports a fresh copy.
const transports = vi.hoisted(() => ({ agent: [] as any[], server: [] as any[] }))

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {
    send = vi.fn(async (_message: Record<string, unknown>) => {})
    start = vi.fn(async () => {})
    close = vi.fn(async () => {})
    onmessage?: (message: unknown) => void
    onclose?: () => void
    onerror?: (error: unknown) => void
    constructor() {
      transports.agent.unshift(this)
    }
  }
}))
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    send = vi.fn(async (_message: Record<string, unknown>) => {})
    start = vi.fn(async () => {})
    close = vi.fn(async () => {})
    onmessage?: (message: unknown) => void
    onclose?: () => void
    onerror?: (error: unknown) => void
    constructor(
      readonly url: URL,
      readonly options: { requestInit: { headers: Record<string, string> } }
    ) {
      transports.server.unshift(this)
    }
  }
}))

const URL_ARG = "http://127.0.0.1:4848/mcp"
const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const savedArgv = process.argv
const savedToken = process.env.ABAPFS_MCP_TOKEN

async function startBridge(args: string[] = [URL_ARG], token?: string) {
  vi.resetModules()
  transports.agent.length = transports.server.length = 0
  process.argv = ["node", "bridge.js", ...args]
  if (token) process.env.ABAPFS_MCP_TOKEN = token
  else delete process.env.ABAPFS_MCP_TOKEN
  await import("./mcpStdioBridge")
  await flush()
  return { agent: transports.agent[0], server: transports.server[0] }
}

describe("MCP stdio bridge", () => {
  let exit: ReturnType<typeof vi.spyOn>
  let stderr: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
    stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    process.argv = savedArgv
    if (savedToken === undefined) delete process.env.ABAPFS_MCP_TOKEN
    else process.env.ABAPFS_MCP_TOKEN = savedToken
  })

  it("exits with an error without a server url", async () => {
    await startBridge([])
    expect(stderr.mock.calls[0][0]).toBe("abap-fs mcp bridge: missing MCP server url argument\n")
    expect(exit.mock.calls[0][0]).toBe(1)
  })

  it("connects to the server, authenticating with the bridge token, before reading stdin", async () => {
    const { agent, server } = await startBridge([URL_ARG], "secret-token")
    expect(server.url.href).toBe(URL_ARG)
    expect(server.options.requestInit.headers).toEqual({ Authorization: "Bearer secret-token" })
    expect(server.start).toHaveBeenCalled()
    expect(agent.start).toHaveBeenCalled()
    expect(server.start.mock.invocationCallOrder[0]).toBeLessThan(
      agent.start.mock.invocationCallOrder[0]
    )
  })

  it("sends no authorization header without a token", async () => {
    const { server } = await startBridge()
    expect(server.options.requestInit.headers).toEqual({})
  })

  it("holds later messages until the initialize request has been sent", async () => {
    const { agent, server } = await startBridge()
    let finishInitialize!: () => void
    server.send.mockImplementationOnce(
      () => new Promise<void>(resolve => (finishInitialize = resolve))
    )
    agent.onmessage({ id: 1, method: "initialize" })
    agent.onmessage({ method: "notifications/initialized" })
    agent.onmessage({ id: 2, method: "tools/list" })
    await flush()
    expect(server.send).toHaveBeenCalledTimes(1)
    finishInitialize()
    await flush()
    expect(server.send.mock.calls.map((c: any[]) => c[0].method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list"
    ])
  })

  it("reports a failed initialize and keeps relaying", async () => {
    const { agent, server } = await startBridge()
    server.send.mockRejectedValueOnce(new Error("401"))
    agent.onmessage({ id: 1, method: "initialize" })
    agent.onmessage({ id: 2, method: "ping" })
    await flush()
    expect(stderr).toHaveBeenCalledWith("abap-fs mcp bridge: Error: 401\n")
    expect(server.send).toHaveBeenCalledTimes(2)
  })

  it("relays server messages to the agent and reports send failures", async () => {
    const { agent, server } = await startBridge()
    server.onmessage({ id: 1, result: {} })
    expect(agent.send).toHaveBeenCalledWith({ id: 1, result: {} })
    agent.send.mockRejectedValueOnce(new Error("EPIPE"))
    server.onmessage({ id: 2, result: {} })
    await flush()
    expect(stderr).toHaveBeenCalledWith("abap-fs mcp bridge: Error: EPIPE\n")
  })

  it.each([
    ["agent", "server"],
    ["server", "agent"]
  ] as const)(
    "closes the %s side when the %s side closes, then exits cleanly",
    async (closing, other) => {
      const bridge = await startBridge()
      bridge[closing].onclose()
      await flush()
      expect(bridge[other].close).toHaveBeenCalled()
      expect(exit).toHaveBeenCalledWith(0)
    }
  )

  it("logs transport errors to stderr only", async () => {
    const { agent, server } = await startBridge()
    agent.onerror("bad json")
    server.onerror("socket hang up")
    expect(stderr.mock.calls.map((c: any[]) => c[0])).toEqual([
      "abap-fs mcp bridge: bad json\n",
      "abap-fs mcp bridge: socket hang up\n"
    ])
    expect(exit).not.toHaveBeenCalled()
  })
})
