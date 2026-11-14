vi.mock("child_process", () => ({ execFile: vi.fn() }))

vi.mock("../config", () => ({ formatKey: (id: string) => id.toLowerCase() }))

vi.mock("../lib", () => ({
  PasswordVault: { get: vi.fn() },
  log: Object.assign(vi.fn(), { debug: vi.fn() })
}))

import { execFile } from "child_process"
import { ADTClient, type HttpClient } from "abap-adt-api"
import { PasswordVault } from "../lib"
import { buildKerberosAuth, createKerberosClientOptions } from "./kerberos"

type HttpClientOptions = Parameters<HttpClient["request"]>[0]

const SAP_URL = "https://sap.example.com"
const originalPlatform = process.platform

function mockVault(stored?: string[]) {
  const vault = {
    getPassword: vi.fn().mockResolvedValue(stored ? JSON.stringify(stored) : undefined),
    setPassword: vi.fn(),
    deletePassword: vi.fn()
  }
  vi.mocked(PasswordVault.get).mockReturnValue(vault as any)
  return vault
}

/** Make the PowerShell handshake answer with the given cookies */
function mockHandshake(cookies: string[]) {
  const output = JSON.stringify({ method: "kerberos", status: 200, cookies })
  vi.mocked(execFile).mockImplementation(((...args: any[]) => {
    const callback = args[args.length - 1]
    callback(null, output, "")
    return { stdin: { end: vi.fn() } }
  }) as any)
}

function handshakeScript() {
  const args = vi.mocked(execFile).mock.calls[0]?.[1] as string[]
  return args[args.length - 1]
}

beforeEach(() => {
  vi.mocked(execFile).mockReset()
  Object.defineProperty(process, "platform", { value: "win32" })
})

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform })
})

describe("Kerberos SSO handshake", () => {
  test("sends an Accept header, which ADT requires", async () => {
    mockVault()
    mockHandshake(["MYSAPSSO2=ticket"])

    await buildKerberosAuth("DEV100", undefined, SAP_URL, "100", false)

    expect(handshakeScript()).toContain("$req.Accept = '*/*'")
  })
})

describe("Kerberos cookie-session options", () => {
  test("uses stored cookies for initial login without a new handshake", async () => {
    mockVault(["MYSAPSSO2=ticket", "SAP_SESSIONID_DEV_100=abc"])
    const options = createKerberosClientOptions("DEV100", undefined, SAP_URL, "100", false)

    await expect(
      options.session?.renew({ reason: "initial-login", client: {} as any })
    ).resolves.toEqual({
      cookieHeader: "MYSAPSSO2=ticket; SAP_SESSIONID_DEV_100=abc",
      replace: true
    })
    expect(options.session?.id).toBe("kerberos:dev100")
    expect(execFile).not.toHaveBeenCalled()
  })

  test("runs a new handshake and stores the cookies when none are stored", async () => {
    const vault = mockVault()
    mockHandshake(["MYSAPSSO2=fresh", "sap-usercontext=sap-client=100"])
    const options = createKerberosClientOptions("DEV100", undefined, SAP_URL, "100", false)

    await expect(
      options.session?.renew({ reason: "initial-login", client: {} as any })
    ).resolves.toEqual({ cookieHeader: "MYSAPSSO2=fresh", replace: true })
    expect(execFile).toHaveBeenCalledOnce()
    expect(vault.setPassword).toHaveBeenCalledWith(
      "vscode.abapfs.kerberos",
      "dev100",
      JSON.stringify(["MYSAPSSO2=fresh"])
    )
  })

  test("ADT requests carry the cookies and no Basic credentials", async () => {
    mockVault(["MYSAPSSO2=ticket"])
    const requests: HttpClientOptions[] = []
    const httpClient: HttpClient = {
      request: async request => {
        requests.push(request)
        return { status: 200, statusText: "OK", headers: { "x-csrf-token": "token" }, body: "" }
      }
    }
    const options = createKerberosClientOptions("DEV100", undefined, SAP_URL, "100", false)
    const client = new ADTClient(httpClient, "USER", "kerberos-sso", "100", "EN", options)

    await client.login()

    expect(requests.length).toBeGreaterThan(0)
    for (const request of requests) {
      expect(request.auth).toBeUndefined()
      expect(request.headers?.Authorization).toBeUndefined()
      expect(request.headers?.Cookie).toContain("MYSAPSSO2=ticket")
    }
  })
})
