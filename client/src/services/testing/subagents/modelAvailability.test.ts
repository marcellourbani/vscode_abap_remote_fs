import { hasReadyLanguageModels, isAutoLanguageModel, resolveModel } from "./modelAvailability"

describe("language model availability", () => {
  it("identifies Auto models by name or family", () => {
    expect(isAutoLanguageModel({ name: "Auto", family: "router" })).toBe(true)
    expect(isAutoLanguageModel({ name: "provider-model", family: "Auto" })).toBe(true)
    expect(isAutoLanguageModel({ name: "provider-model", family: "provider" })).toBe(false)
  })

  it("treats an Auto-only model list as not ready", () => {
    expect(hasReadyLanguageModels([])).toBe(false)
    expect(hasReadyLanguageModels([{ name: "Auto", family: "router" }])).toBe(false)
    expect(
      hasReadyLanguageModels([
        { name: "Auto", family: "router" },
        { name: "provider-model", family: "provider" }
      ])
    ).toBe(true)
  })

  it("resolves by id and rejects ambiguous legacy names", () => {
    const models = [
      { id: "vendor-a-model", name: "Shared Name", vendor: "vendor-a", family: "x", version: "" },
      { id: "vendor-b-model", name: "Shared Name", vendor: "vendor-b", family: "x", version: "" }
    ]
    expect(resolveModel("vendor-a-model", models)?.vendor).toBe("vendor-a")
    expect(resolveModel("Shared Name", models)).toBeUndefined()
  })
})
