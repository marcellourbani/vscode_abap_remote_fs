import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Hoisted so the vi.mock("playwright") factory (also hoisted) can reference them.
const { get, post, storageState, dispose, newContext } = vi.hoisted(() => {
  const get = vi.fn()
  const post = vi.fn()
  const storageState = vi.fn()
  const dispose = vi.fn()
  const newContext = vi.fn(async () => ({ get, post, storageState, dispose }))
  return { get, post, storageState, dispose, newContext }
})

vi.mock("playwright", () => ({ request: { newContext } }))

// Static import so vitest transforms the template and intercepts its require("playwright").
import setup from "./sso-global-setup"
const originalEnv = { ...process.env }
let directory: string
let statePath: string

beforeEach(async () => {
  vi.clearAllMocks()
  process.env = { ...originalEnv }
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "sso-setup-"))
  statePath = path.join(directory, "state.json")
  process.env.SAP_TESTING_STORAGE_STATE = statePath
})

afterEach(async () => {
  process.env = { ...originalEnv }
  await fs.rm(directory, { recursive: true, force: true })
})

describe("SSO global setup", () => {
  it("writes empty reusable state without opening a request context when auto-login is disabled", async () => {
    delete process.env.SAP_TESTING_LOGIN_URL
    await setup()
    expect(newContext).not.toHaveBeenCalled()
    expect(JSON.parse(await fs.readFile(statePath, "utf8"))).toEqual({ cookies: [], origins: [] })
  })

  it("exchanges one ticket and saves cookies once for all workers", async () => {
    process.env.SAP_TESTING_LOGIN_URL = "http://launcher"
    get.mockResolvedValue({
      ok: () => true,
      text: async () =>
        '<form action="http://sap/login"><input name="sap-mysapsso" value="ticket&amp;1"><input name="sap-mysapred" value="target"></form>'
    } as never)
    post.mockResolvedValue({ status: () => 302 } as never)
    storageState.mockResolvedValue({
      cookies: [{ name: "SAP_SESSIONID", value: "session" }],
      origins: []
    } as never)

    await setup()

    expect(newContext).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith("http://sap/login", {
      form: { "sap-mysapsso": "ticket&1", "sap-mysapred": "target" },
      maxRedirects: 0,
      timeout: 30_000
    })
    expect(JSON.parse(await fs.readFile(statePath, "utf8"))).toEqual({
      cookies: [{ name: "SAP_SESSIONID", value: "session" }],
      origins: []
    })
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it("fails when SAP sets no cookie and still disposes the request context", async () => {
    process.env.SAP_TESTING_LOGIN_URL = "http://launcher"
    get.mockResolvedValue({
      ok: () => true,
      text: async () =>
        '<form action="http://sap/login"><input name="sap-mysapsso" value="ticket"></form>'
    } as never)
    post.mockResolvedValue({ status: () => 200 } as never)
    storageState.mockResolvedValue({ cookies: [], origins: [] } as never)

    await expect(setup()).rejects.toThrow("SAP SSO exchange set no session cookie")
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
