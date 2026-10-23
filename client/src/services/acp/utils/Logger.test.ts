import { vscodeFake, resetVscodeFake } from "../testing/vscodeFake"
import {
  disposeChannels,
  getOutputChannel,
  getTrafficChannel,
  log,
  logError,
  logTraffic
} from "./Logger"

vi.mock("vscode", async () => (await import("../testing/vscodeFake")).vscodeFake)

const MAIN = "ABAP FS Agents"
const TRAFFIC = "ABAP FS Agents Traffic"
const lines = (name: string) => vscodeFake.window.channels.get(name)?.lines ?? []
const timestamp = /^\[\d{4}-\d\d-\d\dT[\d:.]+Z\] /

describe("ACP Logger", () => {
  beforeEach(() => {
    disposeChannels()
    resetVscodeFake()
  })

  it("creates each output channel once", () => {
    expect(getOutputChannel()).toBe(getOutputChannel())
    expect(getTrafficChannel()).toBe(getTrafficChannel())
    expect(vscodeFake.window.createOutputChannel.mock.calls.map(c => c[0])).toEqual([MAIN, TRAFFIC])
  })

  it("timestamps messages and appends extra values as JSON", () => {
    log("plain")
    log("with", { id: 1 }, "two")
    expect(lines(MAIN)[0]).toMatch(timestamp)
    expect(lines(MAIN)[0]).toMatch(/\] plain$/)
    expect(lines(MAIN)[1]).toMatch(/\] with \{"id":1\} "two"$/)
  })

  it("logs errors with their message and stack", () => {
    const error = new Error("boom")
    logError("Failed", error)
    logError("Odd", "text")
    logError("Bare")
    expect(lines(MAIN)[0]).toMatch(/ERROR: Failed boom$/)
    expect(lines(MAIN)[1]).toBe(error.stack)
    expect(lines(MAIN)[2]).toMatch(/ERROR: Odd text$/)
    expect(lines(MAIN)[3]).toMatch(/ERROR: Bare $/)
  })

  it("records no traffic unless enabled", () => {
    logTraffic("send", { jsonrpc: "2.0", id: 1, method: "initialize" })
    expect(vscodeFake.window.channels.has(TRAFFIC)).toBe(false)
  })

  it("labels requests, notifications and responses in both directions", () => {
    vscodeFake.settings.set("abapfs.acp.logTraffic", true)
    logTraffic("send", { id: 1, method: "session/prompt" })
    logTraffic("recv", { method: "session/update", params: {} })
    logTraffic("recv", { id: 1, result: {} })
    logTraffic("recv", { id: 2, error: { code: -1 } })
    logTraffic("send", "raw")
    const [request, notification, response, failure, raw] = lines(TRAFFIC)
    expect(request).toContain(">>> CLIENT → AGENT [REQUEST] session/prompt\n")
    expect(request).toContain('"method": "session/prompt"')
    expect(notification).toContain("<<< AGENT → CLIENT [NOTIFICATION] session/update\n")
    expect(response).toContain("[RESPONSE] id=1\n")
    expect(failure).toContain("[RESPONSE] id=2\n")
    expect(raw).toMatch(/AGENT\n"raw"\n$/)
  })

  it("disposes both channels and recreates them on demand", () => {
    const main = getOutputChannel()
    const traffic = getTrafficChannel()
    disposeChannels()
    expect(main.dispose).toHaveBeenCalled()
    expect(traffic.dispose).toHaveBeenCalled()
    expect(getOutputChannel()).not.toBe(main)
  })
})
