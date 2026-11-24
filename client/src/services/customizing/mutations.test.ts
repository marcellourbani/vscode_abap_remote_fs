import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("../../adt/conections", () => ({ getOrCreateClient: vi.fn() }))
vi.mock("./query", async original => ({
  ...(await original<typeof import("./query")>()),
  ensureConnected: vi.fn()
}))
vi.mock("./engine", () => ({ callEngine: vi.fn() }))
vi.mock("./resolver", () => ({ resolveMaint: vi.fn() }))
import { callEngine } from "./engine"
import { resolveMaint } from "./resolver"
import { ENGINE_VERSION } from "./payload"
import {
  mutateConfiguration,
  configurationStatus,
  fieldValues,
  type ChangeInput
} from "./mutations"

const input = {
  connectionId: "example",
  objectName: "ZCFG",
  keyField: "WERKS",
  sourceKey: "0001",
  targetKey: "0002"
}
describe("configuration writes", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(resolveMaint).mockResolvedValue({
      rootTable: "ZCFG",
      maintObject: "V_ZCFG",
      recordObject: "VDAT"
    } as never)
    vi.mocked(callEngine).mockResolvedValue({ STATUS: "ok", VERSION: ENGINE_VERSION })
  })
  it("defaults to dry run, only missing, transport recording", async () => {
    await mutateConfiguration("write", input)
    expect(callEngine).toHaveBeenLastCalledWith(
      "example",
      expect.objectContaining({
        operation: "write",
        commit: "",
        only_missing: "X",
        record_transport: "X",
        view_name: "V_ZCFG"
      })
    )
  })
  it.each([true, false])(
    "passes explicit commit=%s without a UI approval dependency",
    async commit => {
      await mutateConfiguration("write", {
        ...input,
        commit,
        transport: "EXAK900001",
        onlyMissing: false
      })
      expect(callEngine).toHaveBeenLastCalledWith(
        "example",
        expect.objectContaining({
          commit: commit ? "X" : "",
          transport: "EXAK900001",
          only_missing: ""
        })
      )
    }
  )
  it("preserves leading zeros and explicit empty fields", () => {
    expect(fieldValues({ CODE: "0001", TEXT: "" })).toEqual([
      { FIELD: "CODE", VALUE: "0001" },
      { FIELD: "TEXT", VALUE: "" }
    ])
  })
  it.each(["write", "create", "delete"] as const)(
    "forwards explicit new-request creation for %s without creating during preview",
    async operation => {
      await mutateConfiguration(operation, {
        ...input,
        rows: [{ WERKS: "0002" }],
        createTransport: true,
        transportText: "  Configuration changes  "
      })
      expect(callEngine).toHaveBeenLastCalledWith(
        "example",
        expect.objectContaining({
          operation,
          commit: "",
          create_transport: "X",
          transport_text: "Configuration changes",
          transport: undefined,
          record_transport: "X"
        })
      )
    }
  )
  it.each<Partial<ChangeInput>>([
    { createTransport: true, transport: "EXAK900001" },
    { createTransport: true, recordTransport: false },
    { transportText: "Unexpected description" },
    { createTransport: true, transportText: " " },
    { createTransport: true, transportText: "x".repeat(61) }
  ])("rejects conflicting or incomplete new-request options %#", async options => {
    await expect(mutateConfiguration("write", { ...input, ...options })).rejects.toThrow()
    expect(callEngine).not.toHaveBeenCalled()
  })
  it("forwards an explicit in-place edit through apply without creating rows", async () => {
    await mutateConfiguration("write", {
      ...input,
      targetKey: input.sourceKey,
      onlyMissing: false,
      values: { text: "Updated description" }
    })
    expect(callEngine).toHaveBeenLastCalledWith(
      "example",
      expect.objectContaining({
        operation: "write",
        source_key: "0001",
        target_key: "0001",
        only_missing: "",
        commit: "",
        record_transport: "X",
        view_name: "V_ZCFG",
        values_json: '[{"FIELD":"TEXT","VALUE":"Updated description"}]'
      })
    )
    expect(vi.mocked(callEngine).mock.calls.at(-1)![1].rows_json).toBeUndefined()
  })
  it.each<Partial<ChangeInput>>([
    { onlyMissing: false },
    { onlyMissing: false, values: {} },
    { values: { TEXT: "Updated" } },
    { onlyMissing: true, values: { TEXT: "Updated" } },
    { onlyMissing: false, values: { TEXT: "Updated" }, recordTransport: false }
  ])("rejects unsafe in-place edit %# before calling the backend", async options => {
    await expect(
      mutateConfiguration("write", { ...input, targetKey: input.sourceKey, ...options })
    ).rejects.toThrow("In-place updates require")
    expect(callEngine).not.toHaveBeenCalled()
  })
  it("refuses numeric field values", () =>
    expect(() => fieldValues({ CODE: 1 } as never)).toThrow("strings"))
  it("never falls back to direct table writes when maintenance is absent", async () => {
    vi.mocked(resolveMaint).mockResolvedValue({ maintObject: "" } as never)
    await expect(mutateConfiguration("write", input)).rejects.toThrow("No generated maintenance")
    expect(callEngine).not.toHaveBeenCalled()
  })
  it("supports explicitly opted-in recorded table writes without generated maintenance", async () => {
    vi.mocked(resolveMaint).mockResolvedValue({ rootTable: "ZCFG", maintObject: "" } as never)
    await mutateConfiguration("create", {
      ...input,
      rows: [{ WERKS: "0002" }],
      recordTableKeys: true,
      createTransport: true
    })
    expect(callEngine).toHaveBeenLastCalledWith(
      "example",
      expect.objectContaining({
        operation: "create",
        view_name: "",
        transport_object: "TABU",
        record_transport: "X",
        create_transport: "X",
        commit: ""
      })
    )
  })
  it("supports explicit unrecorded create rows without inventing a maintenance object", async () => {
    vi.mocked(resolveMaint).mockResolvedValue({ rootTable: "ZCFG", maintObject: "" } as never)
    await mutateConfiguration("create", {
      ...input,
      rows: [{ WERKS: "0002" }],
      recordTransport: false
    })
    expect(callEngine).toHaveBeenLastCalledWith(
      "example",
      expect.objectContaining({
        operation: "create",
        view_name: "",
        record_transport: "",
        create_transport: ""
      })
    )
  })
  it.each<Partial<ChangeInput>>([
    { recordTableKeys: true, recordTransport: false },
    { recordTableKeys: true, commit: true }
  ])("rejects unsafe recorded table-create options %#", async options => {
    await expect(
      mutateConfiguration("create", {
        ...input,
        rows: [{ WERKS: "0002" }],
        ...options
      })
    ).rejects.toThrow("recordTableKeys")
    expect(callEngine).not.toHaveBeenCalled()
  })
  it("does not silently accept recorded table mode for Apply", async () => {
    await expect(mutateConfiguration("write", { ...input, recordTableKeys: true })).rejects.toThrow(
      "only for explicit create"
    )
    expect(callEngine).not.toHaveBeenCalled()
  })
  it("does not bypass an available maintenance dialog with recorded table mode", async () => {
    await expect(
      mutateConfiguration("create", {
        ...input,
        rows: [{ WERKS: "0002" }],
        recordTableKeys: true,
        createTransport: true
      })
    ).rejects.toThrow("without generated maintenance")
    expect(callEngine).not.toHaveBeenCalled()
  })
  it("forwards create's full-row upsert option", async () => {
    await mutateConfiguration("create", {
      ...input,
      rows: [{ WERKS: "0002", TEXT: "" }],
      onlyMissing: false
    })
    expect(callEngine).toHaveBeenLastCalledWith(
      "example",
      expect.objectContaining({
        operation: "create",
        only_missing: ""
      })
    )
  })
  it("refuses an incompatible engine without installing one", async () => {
    vi.mocked(callEngine).mockResolvedValue({ STATUS: "ok", VERSION: "old" })
    await expect(mutateConfiguration("write", input)).rejects.toThrow("incompatible")
    expect(callEngine).toHaveBeenCalledTimes(1)
  })
  it.each([
    { ...input, keyField: undefined },
    { ...input, sourceKey: undefined },
    { ...input, targetKey: undefined },
    { ...input, targetKey: "0001" },
    { ...input, transport: "not a request" }
  ])("rejects incomplete or unsafe copy %#", async invalid => {
    await expect(mutateConfiguration("write", invalid)).rejects.toThrow()
    expect(callEngine).not.toHaveBeenCalled()
  })
  it.each([undefined, [], Array.from({ length: 1001 }, () => ({ KEY: "1" }))])(
    "bounds explicit create batches %#",
    async rows => {
      await expect(mutateConfiguration("create", { ...input, rows })).rejects.toThrow("1 and 1000")
    }
  )
  it("serializes create rows in the backend field-value protocol", async () => {
    await mutateConfiguration("create", { ...input, rows: [{ CODE: "0001", TEXT: "Hello" }] })
    expect(callEngine).toHaveBeenLastCalledWith(
      "example",
      expect.objectContaining({
        rows_json: '[[{"FIELD":"CODE","VALUE":"0001"},{"FIELD":"TEXT","VALUE":"Hello"}]]'
      })
    )
  })
  it("returns asynchronous runs without resubmission", async () => {
    vi.mocked(callEngine)
      .mockResolvedValueOnce({ STATUS: "ok", VERSION: ENGINE_VERSION })
      .mockResolvedValueOnce({ STATUS: "pending", RUN_ID: "example-run" })
    expect(await mutateConfiguration("write", { ...input, commit: true })).toEqual({
      STATUS: "pending",
      RUN_ID: "example-run"
    })
    expect(callEngine).toHaveBeenCalledTimes(2)
  })
  it("forwards delete as dry run by default", async () => {
    const deleteInput = {
      connectionId: input.connectionId,
      objectName: input.objectName,
      keyField: input.keyField,
      targetKey: "Z"
    }
    await mutateConfiguration("delete", deleteInput)
    expect(callEngine).toHaveBeenLastCalledWith(
      "example",
      expect.objectContaining({
        operation: "delete",
        target_key: "Z",
        commit: ""
      })
    )
  })
  it.each(["", "x".repeat(23), "../other", "bad id"])(
    "rejects malformed run id %s",
    async runId => {
      await expect(configurationStatus("example", runId)).rejects.toThrow("Invalid")
      expect(callEngine).not.toHaveBeenCalled()
    }
  )
  it("polls without converting pending into success", async () => {
    vi.mocked(callEngine).mockResolvedValue({ STATUS: "running" })
    expect(await configurationStatus("example", "example-run")).toEqual({ STATUS: "running" })
  })
  it.each([false, true, undefined])(
    "preserves recordTransport=%s intent",
    async recordTransport => {
      await mutateConfiguration("write", { ...input, recordTransport })
      expect(callEngine).toHaveBeenLastCalledWith(
        "example",
        expect.objectContaining({ record_transport: recordTransport === false ? "" : "X" })
      )
    }
  )
  it("rejects a transport when direct-write mode is requested", async () => {
    await expect(
      mutateConfiguration("create", {
        ...input,
        rows: [{ WERKS: "0001" }],
        transport: "DEVK950272",
        recordTransport: false
      })
    ).rejects.toThrow("Omit transport when recordTransport is false")
    expect(callEngine).not.toHaveBeenCalled()
  })
  it("rejects direct-mode delete before calling the backend", async () => {
    await expect(
      mutateConfiguration("delete", { ...input, recordTransport: false })
    ).rejects.toThrow("Delete requires transport recording")
    expect(callEngine).not.toHaveBeenCalled()
  })
  it("normalizes the user-selected request and custom values", async () => {
    await mutateConfiguration("write", {
      ...input,
      transport: " exak900001 ",
      values: { text: "O'Brien", code: "0001" }
    })
    expect(callEngine).toHaveBeenLastCalledWith(
      "example",
      expect.objectContaining({
        transport: "EXAK900001",
        values_json: '[{"FIELD":"TEXT","VALUE":"O\'Brien"},{"FIELD":"CODE","VALUE":"0001"}]'
      })
    )
  })
  it.each(["BAD NAME", "KEY;DROP", "'", ""])("rejects unsafe explicit field %s", field => {
    expect(() => fieldValues({ [field]: "value" })).toThrow("Invalid")
  })
  it.each([null, false, {}, undefined])("rejects nonstring SAP field value %#", value => {
    expect(() => fieldValues({ KEY: value } as never)).toThrow("strings")
  })
  it("accepts the maximum create batch without losing formatting", async () => {
    await mutateConfiguration("create", {
      ...input,
      rows: Array.from({ length: 1000 }, () => ({ KEY: "0001" }))
    })
    const request = vi.mocked(callEngine).mock.calls.at(-1)![1]
    expect(JSON.parse(request.rows_json as string)).toHaveLength(1000)
  })
  it("returns SAP application errors without retrying", async () => {
    vi.mocked(callEngine)
      .mockResolvedValueOnce({ STATUS: "ok", VERSION: ENGINE_VERSION })
      .mockResolvedValueOnce({ STATUS: "error", MESSAGES: ["Validation failed"] })
    expect(await mutateConfiguration("write", input)).toMatchObject({
      STATUS: "error",
      MESSAGES: ["Validation failed"]
    })
    expect(callEngine).toHaveBeenCalledTimes(2)
  })
  it("does not resubmit an uncertain commit", async () => {
    vi.mocked(callEngine)
      .mockResolvedValueOnce({ STATUS: "ok", VERSION: ENGINE_VERSION })
      .mockRejectedValueOnce(new Error("Timeout after submit"))
    await expect(mutateConfiguration("write", { ...input, commit: true })).rejects.toThrow(
      "Timeout after submit"
    )
    expect(callEngine).toHaveBeenCalledTimes(2)
  })
  it.each(["ok", "error", "aborted", "unknown", "pending", "running"])(
    "preserves terminal or pending status %s",
    async STATUS => {
      vi.mocked(callEngine).mockResolvedValue({ STATUS })
      expect(await configurationStatus("example", "example-run")).toEqual({ STATUS })
    }
  )
  it.each(["AbCd+/=", "{example}", "x".repeat(22)])("accepts SAP run id %s", async runId => {
    await configurationStatus("example", runId)
    expect(callEngine).toHaveBeenCalledWith("example", { operation: "status", run_id: runId })
  })
})
