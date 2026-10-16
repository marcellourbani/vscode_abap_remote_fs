import { clientFromKey, clientFromUrl } from "./clientManager"
import type { ClientConfiguration } from "vscode-abap-remote-fs-sharedapi"

const mocks = vi.hoisted(() => ({
  readConfiguration: vi.fn(),
  createClient: vi.fn(),
  sendRequest: vi.fn(),
  warn: vi.fn()
}))

vi.mock("./clientapis", () => ({ readConfiguration: mocks.readConfiguration }))
vi.mock("abap-adt-api", () => ({
  ADTClient: class {
    stateful = ""
    logout = vi.fn().mockResolvedValue(undefined)
    constructor() {
      mocks.createClient()
    }
  },
  createSSLConfig: vi.fn(() => ({})),
  session_types: { stateful: "stateful", stateless: "stateless" }
}))
vi.mock("vscode-languageserver", () => ({
  ProposedFeatures: { all: {} },
  createConnection: () => ({
    console: { log: vi.fn(), info: vi.fn(), warn: mocks.warn, error: vi.fn() },
    sendRequest: mocks.sendRequest,
    sendNotification: vi.fn()
  })
}))

const configuration = {
  name: "example",
  url: "http://example.invalid",
  username: "example",
  password: "dummy",
  client: "000",
  language: "EN"
} as ClientConfiguration

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.readConfiguration.mockReset().mockResolvedValue(configuration)
  mocks.createClient.mockReset()
  mocks.sendRequest.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it("returns the initialized client on the first lookup and reuses it", async () => {
  const client = await clientFromKey("cold")
  expect(client).toBeDefined()
  expect(await clientFromKey("cold")).toBe(client)
  expect(mocks.readConfiguration).toHaveBeenCalledTimes(1)
  expect(mocks.createClient).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(1)
})

it("shares initialization and a single refresh timer across concurrent decoded keys", async () => {
  let release!: (conf: ClientConfiguration) => void
  mocks.readConfiguration.mockReturnValue(new Promise(resolve => (release = resolve)))
  const first = clientFromKey("parallel%20example")
  const second = clientFromKey("parallel example")
  const third = clientFromUrl("adt://parallel%20example/object")
  expect(mocks.readConfiguration).toHaveBeenCalledTimes(1)
  release(configuration)
  const clients = await Promise.all([first, second, third])
  expect(clients[0]).toBeDefined()
  expect(clients.every(client => client === clients[0])).toBe(true)
  expect(mocks.createClient).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(1)
  await vi.advanceTimersByTimeAsync(240000)
  expect(mocks.createClient).toHaveBeenCalledTimes(2)
  expect(await clientFromKey("parallel example")).not.toBe(clients[0])
})

it("allows retry after missing configuration without scheduling a timer", async () => {
  mocks.readConfiguration.mockResolvedValueOnce(undefined)
  expect(await clientFromKey("missing")).toBeUndefined()
  expect(vi.getTimerCount()).toBe(0)
  expect(await clientFromKey("missing")).toBeDefined()
  expect(mocks.readConfiguration).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(1)
})

it("shares initialization failures and allows retry", async () => {
  mocks.readConfiguration.mockRejectedValueOnce(new Error("Configuration unavailable"))
  const results = await Promise.allSettled([clientFromKey("retry"), clientFromKey("retry")])
  expect(results.every(result => result.status === "rejected")).toBe(true)
  expect(mocks.readConfiguration).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
  expect(await clientFromKey("retry")).toBeDefined()
  expect(vi.getTimerCount()).toBe(1)
})

it("retries after client construction fails", async () => {
  mocks.createClient.mockImplementationOnce(() => {
    throw new Error("Client unavailable")
  })
  await expect(clientFromKey("construction")).rejects.toThrow("Client unavailable")
  expect(vi.getTimerCount()).toBe(0)
  expect(await clientFromKey("construction")).toBeDefined()
})

it("handles scheduled refresh failure and retains the previous client", async () => {
  const client = await clientFromKey("refresh-failure")
  mocks.createClient.mockImplementationOnce(() => {
    throw new Error("Refresh unavailable")
  })
  await vi.advanceTimersByTimeAsync(240000)
  expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining("Refresh unavailable"))
  expect(await clientFromKey("refresh-failure")).toBe(client)
  await vi.advanceTimersByTimeAsync(240000)
  expect(await clientFromKey("refresh-failure")).not.toBe(client)
})

it("does not overlap slow scheduled refreshes", async () => {
  mocks.readConfiguration.mockResolvedValue({ ...configuration, authMethod: "browser_sso" })
  mocks.sendRequest.mockResolvedValueOnce({ httpHeaders: { Cookie: "initial-session" } })
  await clientFromKey("slow-refresh")
  let release!: (value: { httpHeaders: { Cookie: string } }) => void
  mocks.sendRequest.mockReturnValue(new Promise(resolve => (release = resolve)))
  await vi.advanceTimersByTimeAsync(480000)
  expect(mocks.sendRequest).toHaveBeenCalledTimes(2)
  expect(mocks.createClient).toHaveBeenCalledTimes(1)
  release({ httpHeaders: { Cookie: "refreshed-session" } })
  await vi.advanceTimersByTimeAsync(0)
  expect(mocks.createClient).toHaveBeenCalledTimes(2)
})
