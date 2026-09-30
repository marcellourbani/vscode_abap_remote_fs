import { enginePresentation } from "./presentation"

describe("enginePresentation", () => {
  it("keeps the two panels separate so both can be open at once", () => {
    expect(enginePresentation("jev").viewType).not.toBe(enginePresentation("laya").viewType)
    expect(enginePresentation("jev").commandId).toBe("abapfs.askJev")
    expect(enginePresentation("laya").commandId).toBe("abapfs.askLaya")
  })

  it("states where the data goes without naming the service the user did not pick", () => {
    expect(enginePresentation("jev").dataNotice).toContain("TypeSafe")
    expect(enginePresentation("laya").dataNotice).toContain("Laya server you configured")
    expect(enginePresentation("laya").dataNotice).not.toContain("TypeSafe")
  })

  it("suggests one model value rather than listing every accepted name in the field", () => {
    expect(enginePresentation("jev").modelPlaceholder).toBe("jev-latest")
    expect(enginePresentation("laya").modelPlaceholder).toBe("english")
    expect(enginePresentation("laya").modelHint).toContain("multilingual")
  })

  it("explains the token budget only where the panel shows the field", () => {
    expect(enginePresentation("laya").tokenBudgetHint).toContain("default")
    expect(enginePresentation("jev").tokenBudgetHint).toBeUndefined()
  })
})
