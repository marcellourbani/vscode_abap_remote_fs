import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
vi.mock("vscode", () => ({
  CancellationError: class CancellationError extends Error {},
  LanguageModelTextPart: class LanguageModelTextPart {
    constructor(public value: string) {}
  },
  LanguageModelToolResult: class LanguageModelToolResult {
    constructor(public content: unknown[]) {}
  }
}))
vi.mock("../../adt/conections", () => ({ getOrCreateClient: vi.fn() }))
vi.mock("../../lib", () => ({ log: vi.fn() }))
vi.mock("../customizing/discovery", () => ({ handleImgSearch: vi.fn() }))
vi.mock("../customizing/inspection", () => ({
  handleCustomizingRead: vi.fn(),
  handleCustomizingDescribe: vi.fn()
}))
vi.mock("../customizing/comparison", () => ({
  handleCustomizingDiff: vi.fn(),
  handleCustomizingPlanChange: vi.fn()
}))
vi.mock("../customizing/mutations", () => ({
  mutateConfiguration: vi.fn(),
  configurationStatus: vi.fn()
}))
vi.mock("../customizing/setup", () => ({ checkInstallation: vi.fn(), deployInstallation: vi.fn() }))
vi.mock("./toolRegistry", () => ({ registerToolWithRegistry: vi.fn() }))
vi.mock("../customizing/engine", () => ({ requireCustomizingBackend: vi.fn() }))
import { requireCustomizingBackend } from "../customizing/engine"
import { handleImgSearch } from "../customizing/discovery"
import { handleCustomizingDescribe } from "../customizing/inspection"
import { handleCustomizingDiff, handleCustomizingPlanChange } from "../customizing/comparison"
import { configurationStatus, mutateConfiguration } from "../customizing/mutations"
import { checkInstallation, deployInstallation } from "../customizing/setup"
import { invokeCustomizing, registerCustomizingTools } from "./customizingTools"
import { registerToolWithRegistry } from "./toolRegistry"
interface ManifestTool {
  name: string
  modelDescription: string
  tags: string[]
  inputSchema: {
    required: string[]
    additionalProperties?: boolean
    properties: Record<
      string,
      { type: string; minimum?: number; maximum?: number; description?: string }
    >
  }
}
const manifest = JSON.parse(
  readFileSync(new URL("../../../../package.json", import.meta.url), "utf8")
)
const tools: ManifestTool[] = manifest.contributes.languageModelTools.filter((tool: ManifestTool) =>
  /customizing|abapfs_search_img/.test(tool.name)
)
import { handleCustomizingRead } from "../customizing/inspection"
import type { ExtensionContext, LanguageModelTool } from "vscode"
vi.mock("./toolGuard", () => ({ assertToolInvocationAuthorized: vi.fn() }))
import { assertToolInvocationAuthorized } from "./toolGuard"

const scope = {
  connectionId: "example",
  objectName: "ZCFG",
  keyField: "WERKS",
  sourceKey: "0001",
  targetKey: "0002"
}

async function formattedMutation(response: unknown) {
  vi.mocked(mutateConfiguration).mockResolvedValueOnce(response as never)
  registerCustomizingTools({ subscriptions: [] } as unknown as ExtensionContext)
  const tool = vi
    .mocked(registerToolWithRegistry)
    .mock.calls.find(
      ([name]) => name === "abapfs_create_customizing"
    )![1] as LanguageModelTool<unknown>
  const result = await tool.invoke(
    { input: { connectionId: "example", objectName: "V_EXAMPLE", rows: [] } } as never,
    { isCancellationRequested: false } as never
  )
  return (result as { content: { value: string }[] }).content[0].value
}

describe("Customizing LM integration", () => {
  it("teaches Apply in-place edits and keeps Create focused on new entries", () => {
    const apply = tools.find(tool => tool.name === "abapfs_apply_customizing")!
    expect(apply.modelDescription).toContain("sourceKey = targetKey")
    expect(apply.modelDescription).toContain("onlyMissing: false")
    expect(apply.modelDescription).toContain("values: { ANTXT:")
    expect(apply.modelDescription).toContain("current SAP logon language only")
    expect(apply.modelDescription).toContain("DATA, EXTRAS")
    expect(apply.modelDescription).toContain("does not automatically copy source descriptions")
    expect(apply.inputSchema.properties.onlyMissing.description).toContain("Set false to edit")
    expect(apply.inputSchema.properties.sourceKey.description).toContain("equal to targetKey")
    expect(apply.inputSchema.properties.values.description).toContain("view-only fields")
    expect(apply.inputSchema.properties.recordTransport.description).toContain("reject false")
    const create = tools.find(tool => tool.name === "abapfs_create_customizing")!
    expect(create.inputSchema.properties.onlyMissing.description).toContain("full-row")
    expect(create.modelDescription).toContain("partial edits")
  })
  it("explains new Customizing requests without installation terminology on every mutation", () => {
    for (const name of ["apply", "create", "delete"]) {
      const tool = tools.find(tool => tool.name === `abapfs_${name}_customizing`)!
      expect(tool.inputSchema.properties.createTransport.type).toBe("boolean")
      expect(tool.inputSchema.properties.transportText.type).toBe("string")
      expect(tool.inputSchema.properties.transportText.description).toContain("60 characters")
      expect(tool.modelDescription).toContain("createTransport: true")
      expect(tool.modelDescription).toContain("TRANSPORT")
      expect(tool.modelDescription).toMatch(/[Pp]review.*create/)
      expect(tool.modelDescription).not.toMatch(/\bengine\b|Workbench|auto.deploy/i)
      for (const property of Object.values(tool.inputSchema.properties))
        expect(property.description).not.toMatch(/\bengine\b|Workbench/i)
    }
    const create = tools.find(tool => tool.name === "abapfs_create_customizing")!
    expect(create.inputSchema.properties.recordTableKeys.type).toBe("boolean")
    expect(create.modelDescription).toContain("bypasses")
  })
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(requireCustomizingBackend).mockResolvedValue(undefined)
    vi.mocked(checkInstallation).mockResolvedValue({
      version: "1.0.0",
      objects: [],
      services: [],
      ready: false
    })
  })
  it("registers every manifest tool exactly once with the shared LM/MCP registry", () => {
    const context = { extensionPath: "/example", subscriptions: [] } as unknown as ExtensionContext
    registerCustomizingTools(context)
    expect(registerToolWithRegistry).toHaveBeenCalledTimes(tools.length)
    expect(context.subscriptions).toHaveLength(tools.length)
    const manifest = JSON.parse(
      readFileSync(new URL("../../../../package.json", import.meta.url), "utf8")
    )
    const names = vi.mocked(registerToolWithRegistry).mock.calls.map(([name]) => name)
    expect(new Set(names).size).toBe(tools.length)
    expect(names.sort()).toEqual(tools.map(tool => tool.name).sort())
    for (const tool of tools) {
      expect(tool.tags).toContain("abap-fs")
      expect(tool.modelDescription).toBeTruthy()
      expect(tool.inputSchema.required).toContain("connectionId")
      expect(tool.inputSchema.additionalProperties).toBeUndefined()
      for (const property of Object.values(tool.inputSchema.properties))
        expect(property.description).toBeTruthy()
    }
  })
  const cases = [
    ["search_img", { connectionId: "example", keyword: "plant" }, handleImgSearch],
    [
      "describe_customizing",
      { connectionId: "example", objectName: "ZCFG" },
      handleCustomizingDescribe
    ],
    ["read_customizing", { connectionId: "example", objectName: "ZCFG" }, handleCustomizingRead],
    ["diff_customizing", scope, handleCustomizingDiff],
    ["plan_customizing_change", scope, handleCustomizingPlanChange],
    ["apply_customizing", scope, mutateConfiguration],
    [
      "create_customizing",
      { connectionId: "example", objectName: "ZCFG", rows: [{ KEY: "1" }] },
      mutateConfiguration
    ],
    ["delete_customizing", scope, mutateConfiguration],
    [
      "get_customizing_status",
      { connectionId: "example", runId: "example-run" },
      configurationStatus
    ],
    ["check_customizing_setup", { connectionId: "example" }, checkInstallation]
  ] as const
  it.each(cases.filter(([suffix]) => suffix !== "check_customizing_setup"))(
    "probes before executing %s",
    async (suffix, input, handler) => {
      await invokeCustomizing(suffix, input, () => false)
      expect(requireCustomizingBackend).toHaveBeenCalledExactlyOnceWith("example")
      expect(handler).toHaveBeenCalledTimes(1)
      expect(vi.mocked(requireCustomizingBackend).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(handler).mock.invocationCallOrder[0]
      )
    }
  )
  it("returns setup guidance without requiring the backend ping to succeed", async () => {
    vi.mocked(requireCustomizingBackend).mockRejectedValue(new Error("Backend unavailable"))
    const result = await invokeCustomizing(
      "check_customizing_setup",
      { connectionId: "example" },
      () => false
    )
    expect(result).toMatchObject({
      ready: false,
      guidance: expect.stringContaining("ABAP FS > Customizing Setup")
    })
    expect(requireCustomizingBackend).not.toHaveBeenCalled()
    expect(checkInstallation).toHaveBeenCalledExactlyOnceWith("example")
  })
  it("reports ready-specific setup guidance", async () => {
    vi.mocked(checkInstallation).mockResolvedValueOnce({
      version: "1.0.0",
      objects: [],
      services: [],
      ready: true
    })
    const result = await invokeCustomizing(
      "check_customizing_setup",
      { connectionId: "example" },
      () => false
    )
    expect(result).toMatchObject({
      ready: true,
      guidance: expect.stringContaining("No setup action is needed")
    })
  })
  it.each(cases.filter(([suffix]) => suffix !== "check_customizing_setup"))(
    "blocks %s when backend is unavailable",
    async (suffix, input, handler) => {
      vi.mocked(requireCustomizingBackend).mockRejectedValue(
        new Error("Use the Customizing Setup view")
      )
      await expect(invokeCustomizing(suffix, input, () => false)).rejects.toThrow(
        "Customizing Setup view"
      )
      expect(handler).not.toHaveBeenCalled()
      expect(deployInstallation).not.toHaveBeenCalled()
    }
  )
  it.each(cases)("does not probe invalid input for %s", async suffix => {
    await expect(invokeCustomizing(suffix, {}, () => false)).rejects.toThrow()
    expect(requireCustomizingBackend).not.toHaveBeenCalled()
  })
  it.each(cases)("cancels %s before probing", async (suffix, input, handler) => {
    await expect(invokeCustomizing(suffix, input, () => true)).rejects.toThrow()
    expect(requireCustomizingBackend).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })
  it.each(cases.filter(([suffix]) => suffix !== "check_customizing_setup"))(
    "cancels %s after probing without performing work",
    async (suffix, input, handler) => {
      let cancelled = false
      vi.mocked(requireCustomizingBackend).mockImplementation(async () => {
        cancelled = true
      })
      await expect(invokeCustomizing(suffix, input, () => cancelled)).rejects.toThrow()
      expect(handler).not.toHaveBeenCalled()
    }
  )
  it.each(["deploy_customizing", "constructor", "toString", "__proto__"])(
    "rejects removed or inherited operation %s",
    async suffix => {
      await expect(invokeCustomizing(suffix, scope, () => false)).rejects.toThrow("Unknown")
      expect(requireCustomizingBackend).not.toHaveBeenCalled()
      expect(deployInstallation).not.toHaveBeenCalled()
    }
  )
  it("never registers a deployment tool in either registry or manifest", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../../../../package.json", import.meta.url), "utf8")
    )
    expect(
      manifest.contributes.languageModelTools.some(
        (tool: { name: string }) => tool.name === "abapfs_deploy_customizing"
      )
    ).toBe(false)
    expect(tools.some(tool => tool.name.includes("deploy"))).toBe(false)
  })
  it("keeps the setup-check description focused on its purpose", () => {
    const tool = tools.find(tool => tool.name === "abapfs_check_customizing_setup")!
    expect(tool.modelDescription).toContain("Read-only")
    expect(tool.modelDescription).toContain("ready for the selected connection")
    expect(tool.modelDescription).toContain("ABAP FS Customizing Setup")
    expect(tool.modelDescription).not.toMatch(/\bengine\b|Workbench/i)
    expect(tool.modelDescription).not.toContain("abapfs_search_documentation")
    expect(tool.modelDescription).not.toContain("Before first use")
    expect(tool.modelDescription).not.toContain("installation guide")
  })
  it("uses registered ABAP FS tool names for workflow suggestions", () => {
    const names = new Set(
      manifest.contributes.languageModelTools.map((tool: ManifestTool) => tool.name)
    )
    for (const tool of tools)
      for (const reference of tool.modelDescription.match(/\babapfs_[a-z_]+\b/g) ?? [])
        expect(names.has(reference), `${tool.name} references ${reference}`).toBe(true)
  })
  it("describes our implementation rather than unsupported donor behaviours", () => {
    const description = (name: string) => tools.find(tool => tool.name === name)!.modelDescription
    expect(description("abapfs_read_customizing")).toContain(
      "supply keyField and keyValue together"
    )
    expect(description("abapfs_diff_customizing")).toContain("changed source/target pairs")
    expect(description("abapfs_plan_customizing_change")).not.toContain(
      "works before the engine is installed"
    )
    expect(description("abapfs_delete_customizing")).toContain("keyField = targetKey")
  })
  it("puts limited-inventory guidance in the not-ready result", async () => {
    const result = await invokeCustomizing(
      "check_customizing_setup",
      { connectionId: "example" },
      () => false
    )
    expect(result).toMatchObject({
      guidance: expect.stringContaining("not a full system inventory")
    })
  })
  it("checks backend availability for every operation and target system", async () => {
    for (const connectionId of ["example", "other", "example"])
      await invokeCustomizing("read_customizing", { connectionId, objectName: "ZCFG" }, () => false)
    expect(vi.mocked(requireCustomizingBackend).mock.calls.map(args => args[0])).toEqual([
      "example",
      "other",
      "example"
    ])
  })
  it("shows a tool-specific progress message and serializes tool output", async () => {
    registerCustomizingTools({ subscriptions: [] } as unknown as ExtensionContext)
    const expectedMessages: Record<string, string> = {
      abapfs_search_img: "Searching SAP IMG activities",
      abapfs_describe_customizing: "Inspecting SAP Customizing object",
      abapfs_read_customizing: "Reading SAP configuration",
      abapfs_diff_customizing: "Comparing SAP configuration",
      abapfs_plan_customizing_change: "Planning SAP configuration change",
      abapfs_apply_customizing: "Applying SAP configuration change",
      abapfs_create_customizing: "Creating SAP configuration entries",
      abapfs_delete_customizing: "Deleting SAP configuration entries",
      abapfs_get_customizing_status: "Checking SAP Customizing run status",
      abapfs_check_customizing_setup: "Checking SAP Customizing setup"
    }
    for (const [name, registeredTool] of vi.mocked(registerToolWithRegistry).mock.calls) {
      const tool = registeredTool as LanguageModelTool<unknown>
      expect(await tool.prepareInvocation!({ input: {} } as never, {} as never)).toMatchObject({
        invocationMessage: expectedMessages[name]
      })
    }
    const tool = vi.mocked(registerToolWithRegistry).mock.calls[0][1] as LanguageModelTool<unknown>
    vi.mocked(handleImgSearch).mockResolvedValue({ content: [{ type: "text", text: "Result" }] })
    const result = await tool.invoke(
      { input: { connectionId: "example", keyword: "plant" } } as never,
      { isCancellationRequested: false } as never
    )
    expect(assertToolInvocationAuthorized).toHaveBeenCalledTimes(1)
    expect(result).toBeDefined()
    expect(handleImgSearch).toHaveBeenCalledTimes(1)
    expect((result as { content: { value: string }[] }).content[0].value).toBe("Result")
  })
  it("formats engine DATA_JSON as readable structured output", async () => {
    vi.mocked(mutateConfiguration).mockResolvedValueOnce({
      STATUS: "ok",
      ROWS_WRITTEN: 1,
      DATA_JSON: '[{"STLAN":"Z","ANTXT":"Zeta Prototype"}]'
    } as never)
    registerCustomizingTools({ subscriptions: [] } as unknown as ExtensionContext)
    const tool = vi
      .mocked(registerToolWithRegistry)
      .mock.calls.find(
        ([name]) => name === "abapfs_create_customizing"
      )![1] as LanguageModelTool<unknown>
    const result = await tool.invoke(
      { input: { connectionId: "example", objectName: "V_T416", rows: [] } } as never,
      { isCancellationRequested: false } as never
    )
    const text = (result as { content: { value: string }[] }).content[0].value
    expect(text).toContain('"DATA": [\n')
    expect(text).toContain('"ANTXT": "Zeta Prototype"')
    expect(text).not.toContain("DATA_JSON")
    expect(mutateConfiguration).toHaveBeenCalledWith("create", {
      connectionId: "example",
      objectName: "V_T416",
      rows: []
    })
  })
  it("preserves special characters in base rows, extras, messages and metadata", async () => {
    const special =
      ' "quoted" \\path\\literal\\n\r\n\t<>&|`' +
      "\u0000\b\f\u001b\u00e9\u4e2d\ud83d\ude80\u2028\u2029  "
    const data = [{ STLAN: "Z", VALUE: special }]
    const extras = [{ ROW: 1, FIELD: "ANTXT", VALUE: special }]
    const metadata = { STATUS: "ok", DRY_RUN: true, MESSAGES: [special], OTHER: special }
    const text = await formattedMutation({
      ...metadata,
      DATA_JSON: JSON.stringify(data),
      EXTRAS_JSON: JSON.stringify(extras)
    })
    expect(JSON.parse(text)).toEqual({ ...metadata, DATA: data, EXTRAS: extras })
  })
  it("returns plain text content verbatim", async () => {
    const text = 'Actual newline:\nLiteral escape: \\n; "quote"; \\path; \u00e9\u4e2d  '
    expect(await formattedMutation({ content: [{ type: "text", text }] })).toBe(text)
  })
  it.each([
    { content: [{ type: "text", text: "Result" }], isError: true, detail: "Keep me" },
    { content: [{ type: "text", text: "Result", annotations: { audience: ["user"] } }] },
    {
      content: [
        { type: "text", text: "Result" },
        { type: "image", data: "AAAA" }
      ]
    },
    { content: [] },
    [{ STATUS: "ok" }, { STATUS: "error" }]
  ])("retains content metadata and non-text output %#", async response => {
    expect(JSON.parse(await formattedMutation(response))).toEqual(response)
  })
  it.each(["", "broken", '{"incomplete":'])(
    "retains invalid DATA_JSON while decoding extras: %j",
    async raw => {
      const extras = [{ ROW: 1, FIELD: "ANTXT", VALUE: "Keep this" }]
      expect(
        JSON.parse(
          await formattedMutation({
            DATA_JSON: raw,
            EXTRAS_JSON: JSON.stringify(extras)
          })
        )
      ).toEqual({ DATA_JSON: raw, EXTRAS: extras })
    }
  )
  it("retains invalid extras while decoding base rows", async () => {
    expect(JSON.parse(await formattedMutation({ DATA_JSON: "[]", EXTRAS_JSON: "broken" }))).toEqual(
      { DATA: [], EXTRAS_JSON: "broken" }
    )
  })
  it("does not overwrite existing DATA or EXTRAS fields", async () => {
    const response = {
      DATA: ["original"],
      DATA_JSON: '["nested"]',
      EXTRAS: { original: true },
      EXTRAS_JSON: '[{"ROW":1}]'
    }
    expect(JSON.parse(await formattedMutation(response))).toEqual(response)
  })
  it("rejects unauthorized callers without contacting SAP", async () => {
    registerCustomizingTools({ subscriptions: [] } as unknown as ExtensionContext)
    const tool = vi.mocked(registerToolWithRegistry).mock.calls[0][1] as LanguageModelTool<unknown>
    vi.mocked(assertToolInvocationAuthorized).mockImplementation(() => {
      throw new Error("Unauthorized")
    })
    await expect(
      tool.invoke(
        { input: { connectionId: "example", keyword: "plant" } } as never,
        { isCancellationRequested: false } as never
      )
    ).rejects.toThrow("Unauthorized")
    expect(requireCustomizingBackend).not.toHaveBeenCalled()
  })
  it("rejects unknown tool names", async () => {
    await expect(invokeCustomizing("unknown", {}, () => false)).rejects.toThrow("Unknown")
  })
  it.each(tools.map(tool => tool.name.replace(/^abapfs_/, "")))(
    "requires a connection for %s",
    async suffix => {
      await expect(invokeCustomizing(suffix, {}, () => false)).rejects.toThrow()
    }
  )
  it("declares boolean commit semantics in the AI-facing manifest", () => {
    for (const tool of tools.filter(tool => tool.inputSchema.properties.commit))
      expect(tool.inputSchema.properties.commit.type).toBe("boolean")
  })
  it("passes headless commits to the backend without a VS Code prompt", async () => {
    await invokeCustomizing("apply_customizing", { ...scope, commit: true }, () => false)
    expect(mutateConfiguration).toHaveBeenCalledWith("write", { ...scope, commit: true })
  })
  it("declares read parameters and row bounds in the AI-facing manifest", () => {
    const read = tools.find(tool => tool.name === "abapfs_read_customizing")!
    expect(read.inputSchema.properties.commit).toBeUndefined()
    expect(read.inputSchema.properties.maxRows).toMatchObject({
      type: "integer",
      minimum: 1,
      maximum: 9999
    })
  })
  it.each([null, undefined, [], { connectionId: 1 }, { connectionId: " " }])(
    "rejects missing connection input %# without probing",
    async input => {
      await expect(invokeCustomizing("read_customizing", input, () => false)).rejects.toThrow(
        "connectionId"
      )
      expect(requireCustomizingBackend).not.toHaveBeenCalled()
    }
  )
})
