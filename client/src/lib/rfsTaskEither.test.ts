import { isRight, isLeft, right, left } from "fp-ts/lib/Either"
import { none, None } from "fp-ts/lib/Option"
import {
  rfsExtract,
  nullToNone,
  rfsTaskEither,
  rfsTryCatch,
  rfsWrap,
  rfsChainE,
  addField,
  chainTaskTransformers,
  createTaskTransformer
} from "./rfsTaskEither"
import { pipe } from "fp-ts/lib/function"

describe("rfsExtract", () => {
  test("returns value from Right", () => {
    expect(rfsExtract(right("hello"))).toBe("hello")
  })

  test("returns undefined from Left(none)", () => {
    expect(rfsExtract(left(none as None))).toBeUndefined()
  })

  test("throws from Left(Error)", () => {
    expect(() => rfsExtract(left(new Error("boom")))).toThrow("boom")
  })
})

describe("nullToNone", () => {
  test("returns Right for truthy value", () => {
    const result = nullToNone("hello")
    expect(isRight(result)).toBe(true)
    if (isRight(result)) expect(result.right).toBe("hello")
  })

  test("returns Right for zero", () => {
    const result = nullToNone(0)
    expect(isRight(result)).toBe(true)
    if (isRight(result)) expect(result.right).toBe(0)
  })

  test("returns Left(none) for null", () => {
    const result = nullToNone(null)
    expect(isLeft(result)).toBe(true)
    if (isLeft(result)) expect(result.left).toBe(none)
  })

  test("returns Left(none) for undefined", () => {
    const result = nullToNone(undefined)
    expect(isLeft(result)).toBe(true)
    if (isLeft(result)) expect(result.left).toBe(none)
  })
})

describe("rfsTaskEither", () => {
  test("wraps a value into TaskEither Right", async () => {
    const result = await rfsTaskEither(42)()
    expect(isRight(result)).toBe(true)
    if (isRight(result)) expect(result.right).toBe(42)
  })

  test("wraps null into TaskEither Left(none)", async () => {
    const result = await rfsTaskEither(null)()
    expect(isLeft(result)).toBe(true)
  })
})

describe("rfsTryCatch", () => {
  test("resolves to Right on success", async () => {
    const result = await rfsTryCatch(async () => "ok")()
    expect(isRight(result)).toBe(true)
    if (isRight(result)) expect(result.right).toBe("ok")
  })

  test("resolves to Left(Error) on thrown error", async () => {
    const result = await rfsTryCatch(async () => {
      throw new Error("fail")
    })()
    expect(isLeft(result)).toBe(true)
    if (isLeft(result)) expect((result.left as Error).message).toBe("fail")
  })

  test("resolves to Left(none) when returning undefined", async () => {
    const result = await rfsTryCatch(async () => undefined)()
    expect(isLeft(result)).toBe(true)
  })

  test("wraps non-Error throw into Error", async () => {
    const result = await rfsTryCatch(async () => {
      throw "string error"
    })()
    expect(isLeft(result)).toBe(true)
    if (isLeft(result)) expect(result.left).toBeInstanceOf(Error)
  })
})

describe("rfsWrap", () => {
  test("wraps sync function into TaskEither", async () => {
    const fn = rfsWrap((x: number) => x * 2)
    const result = await fn(5)()
    expect(isRight(result)).toBe(true)
    if (isRight(result)) expect(result.right).toBe(10)
  })

  test("wraps async function into TaskEither", async () => {
    const fn = rfsWrap(async (x: number) => x + 1)
    const result = await fn(10)()
    expect(isRight(result)).toBe(true)
    if (isRight(result)) expect(result.right).toBe(11)
  })

  test("catches errors from wrapped function", async () => {
    const fn = rfsWrap(() => {
      throw new Error("wrapped fail")
    })
    const result = await fn(0)()
    expect(isLeft(result)).toBe(true)
  })
})

describe("addField", () => {
  test("adds a field to input object", async () => {
    const adder = addField("c", async (x: { a: number }) => x.a * 10)
    const result = await adder({ a: 5 })
    expect(result).toEqual({ a: 5, c: 50 })
  })

  test("preserves existing fields", async () => {
    const adder = addField("z", async () => "new")
    const result = await adder({ x: 1, y: 2 })
    expect(result).toEqual({ x: 1, y: 2, z: "new" })
  })
})

describe("createTaskTransformer", () => {
  test("transforms value through function", async () => {
    const tf = createTaskTransformer((x: number) => x + 1)
    const result = await tf(5)()
    expect(isRight(result)).toBe(true)
    if (isRight(result)) expect(result.right).toBe(6)
  })

  test("handles async transformer", async () => {
    const tf = createTaskTransformer(async (x: number) => x * 2)
    const result = await tf(3)()
    expect(isRight(result)).toBe(true)
    if (isRight(result)) expect(result.right).toBe(6)
  })

  test("catches errors in transformer", async () => {
    const tf = createTaskTransformer<number>(() => {
      throw new Error("boom")
    })
    const result = await tf(1)()
    expect(isLeft(result)).toBe(true)
  })
})

describe("chainTaskTransformers", () => {
  test("chains multiple transformers in sequence", async () => {
    const add1 = createTaskTransformer((x: number) => x + 1)
    const double = createTaskTransformer((x: number) => x * 2)
    const chained = chainTaskTransformers(add1, double)
    const result = await chained(5)()
    // (5 + 1) * 2 = 12
    expect(isRight(result)).toBe(true)
    if (isRight(result)) expect(result.right).toBe(12)
  })

  test("short-circuits on error", async () => {
    const fail = createTaskTransformer<number>(() => {
      throw new Error("stop")
    })
    const double = createTaskTransformer((x: number) => x * 2)
    const chained = chainTaskTransformers(fail, double)
    const result = await chained(5)()
    expect(isLeft(result)).toBe(true)
  })
})
