import { vi } from "vitest"

vi.mock("vscode", () => ({
  Uri: {
    parse: vi.fn((value: string) => {
      const parsed = new URL(value)
      return {
        scheme: parsed.protocol.slice(0, -1),
        authority: parsed.host,
        path: parsed.pathname,
        query: parsed.search.slice(1),
        toString: () => value
      }
    })
  }
}))

import { canonicalTransportIntentKey, TransportIntentService } from "./transportIntentService"

const uri = (authority = "DEV100", path = "/sap/bc/adt/programs/ztest/source/main") =>
  ({
    scheme: "adt",
    authority,
    path,
    toString: () => `adt://${authority}${path}`
  }) as any

describe("TransportIntentService", () => {
  let service: TransportIntentService

  beforeEach(() => {
    service = new TransportIntentService()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("normalizes authority and transport number while preserving the exact resource path", () => {
    const intent = service.register({
      objectUri: uri(),
      process: "normal-edit",
      transportChoice: { type: "existing", number: " devk900123 " }
    })

    expect(intent.canonicalKey).toBe("dev100/sap/bc/adt/programs/ztest/source/main")
    expect(intent.transportChoice).toEqual({
      type: "existing",
      number: "DEVK900123"
    })
    expect(service.claim(uri("dev100"))?.intentId).toBe(intent.intentId)
  })

  it("does not let an intent for one source resource match another resource", () => {
    service.register({
      objectUri: uri(),
      process: "normal-edit",
      transportChoice: { type: "existing", number: "DEVK900123" }
    })

    expect(service.claim(uri("dev100", "/sap/bc/adt/programs/ztest/includes/zinc"))).toBeUndefined()
  })

  it("rejects competing intents for the same target", () => {
    service.register({
      objectUri: uri(),
      process: "normal-edit",
      transportChoice: { type: "existing", number: "DEVK900123" }
    })

    expect(() =>
      service.register({
        objectUri: uri("dev100"),
        process: "repository-assisted-apply",
        transportChoice: { type: "new", description: "Approved request" }
      })
    ).toThrow(/already active/)
  })

  it("atomically claims an intent once", () => {
    service.register({
      objectUri: uri(),
      process: "normal-edit",
      transportChoice: { type: "existing", number: "DEVK900123" }
    })

    expect(service.claim(uri())).toEqual(expect.objectContaining({ status: "claimed" }))
    expect(() => service.claim(uri())).toThrow(/already claimed/)
  })

  it("resolves completion with the actual transport and frees the target", async () => {
    const intent = service.register({
      objectUri: uri(),
      process: "repository-assisted-apply",
      transportChoice: { type: "new", description: " Approved request " },
      workflowId: "wf",
      objectKey: "r3tr:prog:ztest"
    })
    service.claim(uri())
    const waiting = service.waitForResult(intent.intentId, undefined, 1000)

    service.succeed(intent.intentId, "DEVK900555")

    await expect(waiting).resolves.toEqual(
      expect.objectContaining({
        status: "succeeded",
        process: "repository-assisted-apply",
        transportRequest: "DEVK900555"
      })
    )
    expect(service.claim(uri())).toBeUndefined()
    expect(
      service.register({
        objectUri: uri(),
        process: "normal-edit",
        transportChoice: { type: "local" }
      })
    ).toBeDefined()
  })

  it("records a provider failure and returns the same terminal result once", async () => {
    const intent = service.register({
      objectUri: uri(),
      process: "normal-edit",
      transportChoice: { type: "existing", number: "DEVK900123" }
    })
    service.claim(uri())

    const failed = service.fail(intent.intentId, new Error("SAP write failed"), "DEVK900555")

    expect(failed).toEqual(
      expect.objectContaining({
        status: "failed",
        error: "SAP write failed",
        transportRequest: "DEVK900555"
      })
    )
    await expect(service.waitForResult(intent.intentId)).resolves.toEqual(failed)
    expect(service.succeed(intent.intentId, "OTHER")).toEqual(failed)
  })

  it("expires an unclaimed intent and allows a replacement", () => {
    vi.useFakeTimers()
    const intent = service.register({
      objectUri: uri(),
      process: "normal-edit",
      transportChoice: { type: "existing", number: "DEVK900123" },
      ttlMs: 10
    })
    vi.advanceTimersByTime(11)

    expect(service.claim(uri())).toBeUndefined()
    expect(service.get(intent.intentId)).toEqual(expect.objectContaining({ status: "expired" }))
    expect(() =>
      service.register({
        objectUri: uri(),
        process: "normal-edit",
        transportChoice: { type: "existing", number: "DEVK900124" }
      })
    ).not.toThrow()
  })

  it("does not expire or replace a claimed intent while its SAP write is running", () => {
    vi.useFakeTimers()
    const intent = service.register({
      objectUri: uri(),
      process: "normal-edit",
      transportChoice: { type: "existing", number: "DEVK900123" },
      ttlMs: 10
    })
    service.claim(uri())
    vi.advanceTimersByTime(11)

    expect(service.get(intent.intentId)).toEqual(expect.objectContaining({ status: "claimed" }))
    expect(() =>
      service.register({
        objectUri: uri(),
        process: "normal-edit",
        transportChoice: { type: "existing", number: "DEVK900124" }
      })
    ).toThrow(/already active/)
  })

  it("reports an unknown result on timeout without completing the intent", async () => {
    vi.useFakeTimers()
    const intent = service.register({
      objectUri: uri(),
      process: "normal-edit",
      transportChoice: { type: "existing", number: "DEVK900123" }
    })

    const waiting = service.waitForResult(intent.intentId, undefined, 25)
    await vi.advanceTimersByTimeAsync(25)

    await expect(waiting).resolves.toEqual(
      expect.objectContaining({ status: "timed-out", error: expect.stringMatching(/unknown/) })
    )
    expect(service.get(intent.intentId)).toEqual(expect.objectContaining({ status: "armed" }))
  })

  it("stops waiting on cancellation without cancelling the underlying intent", async () => {
    let cancel = () => {}
    const token = {
      onCancellationRequested: vi.fn((callback: () => void) => {
        cancel = callback
        return { dispose: vi.fn() }
      })
    } as any
    const intent = service.register({
      objectUri: uri(),
      process: "normal-edit",
      transportChoice: { type: "local" }
    })
    const waiting = service.waitForResult(intent.intentId, token)

    cancel()

    await expect(waiting).resolves.toEqual(
      expect.objectContaining({ status: "timed-out", error: expect.stringMatching(/cancelled/) })
    )
    expect(service.get(intent.intentId)).toEqual(expect.objectContaining({ status: "armed" }))
  })

  it("does not subscribe when waiting starts with an already-cancelled token", async () => {
    const token = {
      isCancellationRequested: true,
      onCancellationRequested: vi.fn()
    } as any
    const intent = service.register({
      objectUri: uri(),
      process: "normal-edit",
      transportChoice: { type: "local" }
    })

    await expect(service.waitForResult(intent.intentId, token)).resolves.toEqual(
      expect.objectContaining({ status: "timed-out", error: expect.stringMatching(/cancelled/) })
    )
    expect(token.onCancellationRequested).not.toHaveBeenCalled()
  })

  it("validates schemes and non-empty choices", () => {
    expect(() =>
      service.register({
        objectUri: "file:///tmp/ztest",
        process: "normal-edit",
        transportChoice: { type: "local" }
      })
    ).toThrow(/adt/)
    expect(() =>
      service.register({
        objectUri: uri(),
        process: "normal-edit",
        transportChoice: { type: "existing", number: " " }
      })
    ).toThrow(/request number/)
    expect(() =>
      service.register({
        objectUri: uri(),
        process: "normal-edit",
        transportChoice: { type: "new", description: " " }
      })
    ).toThrow(/description/)
  })

  it("canonicalizes only connection and path", () => {
    expect(
      canonicalTransportIntentKey({
        authority: " DEV100 ",
        path: "/exact/path",
        query: "version=inactive"
      } as any)
    ).toBe("dev100/exact/path")
  })
})
