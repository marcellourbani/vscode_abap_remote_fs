import { hasReadyLanguageModels, isAutoLanguageModel } from "./modelAvailability"

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
})
