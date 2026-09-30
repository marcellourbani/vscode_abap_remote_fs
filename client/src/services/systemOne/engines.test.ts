import { LAYA_MAX_LEN, engineLimits, stateLength } from "./engines"

describe("engineLimits", () => {
  it("carries the limits Laya's server enforces before inference", () => {
    expect(engineLimits("laya")).toMatchObject({
      requiresState: true,
      maxStateChars: 50_000,
      maxQuestions: 64,
      maxChoiceOptions: 100,
      maxScoreLevels: 32,
      maxTotalOptions: 512,
      tokenBudget: { min: 256, max: LAYA_MAX_LEN }
    })
  })

  it("claims no limit for Jev beyond the one the integration has always enforced", () => {
    const limits = engineLimits("jev")
    expect(limits.maxScoreLevels).toBe(10)
    expect(limits.requiresState).toBe(false)
    expect(limits.maxStateChars).toBeUndefined()
    expect(limits.maxQuestions).toBeUndefined()
    expect(limits.maxChoiceOptions).toBeUndefined()
    expect(limits.maxTotalOptions).toBeUndefined()
  })

  it("only offers a token budget for the engine that reads one", () => {
    expect(engineLimits("jev").tokenBudget).toBeUndefined()
  })

  it("names the variable to check when a credential is rejected", () => {
    expect(engineLimits("jev").apiKeyVariable).toBe("TYPESAFE_API_KEY")
    expect(engineLimits("laya").apiKeyVariable).toBe("LAYA_API_KEY")
  })
})

describe("stateLength", () => {
  it("measures a string state as written, with no quoting added", () => {
    expect(stateLength("abc")).toBe(3)
  })

  it("measures anything else as the JSON the engine will tokenize", () => {
    expect(stateLength({ a: "bc" })).toBe('{"a":"bc"}'.length)
    expect(stateLength(["a"])).toBe('["a"]'.length)
    expect(stateLength(null)).toBe(4)
  })

  it("counts an escaped quote the way the engine serializes it", () => {
    expect(stateLength({ a: '"' })).toBeGreaterThan(stateLength({ a: "x" }) - 1)
    expect(stateLength('"')).toBe(1)
  })
})
