import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("./query", () => ({ ensureConnected: vi.fn() }))
import { ensureConnected } from "./query"
import { callEngine, imgIndexRead, imgSearchViaEngine, requireCustomizingBackend } from "./engine"
import { ENGINE_VERSION } from "./payload"

describe("authenticated engine transport", () => {
  const request = vi.fn()
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(ensureConnected).mockResolvedValue({
      statelessClone: { httpClient: { request } }
    } as never)
  })
  it("accepts only a successful compatible ping", async () => {
    request.mockResolvedValue({ body: JSON.stringify({ STATUS: "ok", VERSION: ENGINE_VERSION }) })
    await expect(requireCustomizingBackend("example")).resolves.toBeUndefined()
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "/sap/bc/zabapfs_cust",
      expect.objectContaining({ body: '{"operation":"ping"}' })
    )
  })
  it.each([
    { STATUS: "ok" },
    { STATUS: "ok", VERSION: "old" },
    { STATUS: "error", VERSION: ENGINE_VERSION, MESSAGES: ["Not authorized"] },
    { STATUS: "pending", VERSION: ENGINE_VERSION },
    {},
    [],
    null,
    "<html>Login required</html>"
  ])("returns setup guidance for incompatible/malformed ping %#", async body => {
    request.mockResolvedValue({ body: typeof body === "string" ? body : JSON.stringify(body) })
    await expect(requireCustomizingBackend("example")).rejects.toThrow(
      /system "example".*Customizing Setup view.*handled by the user.*No configuration change was submitted/
    )
    expect(request).toHaveBeenCalledTimes(1)
  })
  it.each([
    new Error("HTTP 401"),
    new Error("HTTP 403"),
    new Error("HTTP 404"),
    new Error("Timeout"),
    "Connection closed"
  ])("wraps inaccessible backend %# without retries", async error => {
    request.mockRejectedValue(error)
    await expect(requireCustomizingBackend("example")).rejects.toThrow(
      error instanceof Error ? error.message : error
    )
    expect(request).toHaveBeenCalledTimes(1)
  })
  it("does not cache availability between systems or subsequent calls", async () => {
    request
      .mockResolvedValueOnce({ body: JSON.stringify({ STATUS: "ok", VERSION: ENGINE_VERSION }) })
      .mockRejectedValue(new Error("HTTP 404"))
    await requireCustomizingBackend("example")
    await expect(requireCustomizingBackend("other")).rejects.toThrow('system "other"')
    await expect(requireCustomizingBackend("example")).rejects.toThrow('system "example"')
    expect(request).toHaveBeenCalledTimes(3)
  })
  it("uses the existing HTTP identity and fixed ABAP FS endpoint", async () => {
    request.mockResolvedValue({ body: JSON.stringify({ STATUS: "ok" }) })
    await expect(callEngine("example", { operation: "ping" })).resolves.toEqual({ STATUS: "ok" })
    expect(request).toHaveBeenCalledWith(
      "/sap/bc/zabapfs_cust",
      expect.objectContaining({ method: "POST", body: '{"operation":"ping"}' })
    )
  })
  it.each(["", "<html>Login</html>", "null", "[]", "{}", '{"STATUS":2}'])(
    "rejects malformed response %s",
    async body => {
      request.mockResolvedValue({ body })
      await expect(callEngine("example", { operation: "ping" })).rejects.toThrow()
    }
  )
  it("does not retry an uncertain mutation", async () => {
    request.mockRejectedValue(new Error("Connection reset"))
    await expect(callEngine("example", { operation: "write", commit: "X" })).rejects.toThrow(
      "Connection reset"
    )
    expect(request).toHaveBeenCalledTimes(1)
  })
  it("keeps application errors inspectable", async () => {
    request.mockResolvedValue({ body: '{"STATUS":"error","MESSAGES":["Not authorized"]}' })
    expect(await callEngine("example", { operation: "write" })).toMatchObject({
      STATUS: "error",
      MESSAGES: ["Not authorized"]
    })
  })
  it("parses IMG rows and reports capped search", async () => {
    request.mockResolvedValue({
      body: JSON.stringify({
        STATUS: "ok",
        DATA_JSON: '[{"ACTIVITY":"A"}]',
        MESSAGES: ["Result capped"]
      })
    })
    expect(await imgSearchViaEngine("example", { keyword: "plant" })).toMatchObject({
      hits: [{ ACTIVITY: "A" }],
      capped: true
    })
  })
  it("supports a diagnostic service override", async () => {
    request.mockResolvedValue({ body: '{"STATUS":"ok"}' })
    await callEngine("example", { operation: "ping" }, "/sap/bc/zabapfs_diag")
    expect(request.mock.calls[0][0]).toBe("/sap/bc/zabapfs_diag")
  })
  it.each([undefined, "", "[]"])("accepts empty result data %s", async DATA_JSON => {
    request.mockResolvedValue({ body: JSON.stringify({ STATUS: "ok", DATA_JSON }) })
    expect(await imgSearchViaEngine("example", { keyword: "plant" })).toEqual({
      hits: [],
      capped: false,
      messages: []
    })
  })
  it.each(["null", "true", "123", "broken"])("rejects invalid nested data %s", async DATA_JSON => {
    request.mockResolvedValue({ body: JSON.stringify({ STATUS: "ok", DATA_JSON }) })
    await expect(imgIndexRead("example", { structureId: "EXAMPLE" })).rejects.toThrow()
  })
  it("forwards index arguments and no-index status", async () => {
    request.mockResolvedValue({ body: '{"STATUS":"no_index","MESSAGES":["Build index"]}' })
    expect(
      await imgIndexRead("example", {
        structureId: "TREE",
        language: "D",
        keyword: "plant",
        maxRows: 5
      })
    ).toEqual({ status: "no_index", messages: ["Build index"], hits: [] })
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
      operation: "img_index_read",
      structure_id: "TREE",
      language: "D",
      keyword: "plant",
      max_rows: 5
    })
  })
  it("returns null for unsupported search operations", async () => {
    request.mockResolvedValue({ body: '{"STATUS":"error"}' })
    expect(await imgSearchViaEngine("example", { keyword: "plant" })).toBeNull()
  })
  it("refuses corrupt nested JSON instead of calling it no matches", async () => {
    request.mockResolvedValue({ body: '{"STATUS":"ok","DATA_JSON":"{}"}' })
    await expect(imgIndexRead("example", { structureId: "EXAMPLE" })).rejects.toThrow(
      "invalid row data"
    )
  })
})
