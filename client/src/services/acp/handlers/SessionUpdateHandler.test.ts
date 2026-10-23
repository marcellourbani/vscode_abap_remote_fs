import { SessionUpdateHandler } from "./SessionUpdateHandler"
import { logError } from "../utils/Logger"

import type { SessionNotification } from "@agentclientprotocol/sdk"

vi.mock("../utils/Logger", () => ({ logError: vi.fn() }))

const update = {
  sessionId: "s1",
  update: { sessionUpdate: "agent_message_chunk" }
} as SessionNotification

describe("SessionUpdateHandler", () => {
  beforeEach(() => vi.clearAllMocks())

  it("delivers each update to every listener once", () => {
    const handler = new SessionUpdateHandler()
    const first = vi.fn()
    const second = vi.fn()
    handler.addListener(first)
    handler.addListener(second)
    handler.addListener(first)
    handler.handleUpdate(update)
    expect(first).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledWith(update)
    expect(second).toHaveBeenCalledWith(update)
  })

  it("keeps delivering when a listener throws", () => {
    const handler = new SessionUpdateHandler()
    const failure = new Error("listener broke")
    const after = vi.fn()
    handler.addListener(() => {
      throw failure
    })
    handler.addListener(after)
    handler.handleUpdate(update)
    expect(after).toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith("Error in session update listener", failure)
  })

  it("stops delivering after removal or disposal", () => {
    const handler = new SessionUpdateHandler()
    const removed = vi.fn()
    const disposed = vi.fn()
    handler.addListener(removed)
    handler.addListener(disposed)
    handler.removeListener(removed)
    handler.handleUpdate(update)
    handler.dispose()
    handler.handleUpdate(update)
    expect(removed).not.toHaveBeenCalled()
    expect(disposed).toHaveBeenCalledTimes(1)
  })
})
