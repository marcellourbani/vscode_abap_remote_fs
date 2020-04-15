import {
  after,
  chainTaskTransformers,
  fieldReplacer,
  dependFieldReplacer,
  splitAdtUriInternal
} from "./functions"
import { none } from "fp-ts/lib/Option"
import { right, left, isLeft, isRight } from "fp-ts/lib/Either"
import { TaskEither } from "fp-ts/lib/TaskEither"
const isFalsey = (x: any) => !x
const rejectPromise = () => Promise.reject(new Error("foo"))

interface A extends Record<string, string> {
  a: string
  b: string
}

const fakeselect = <T2>(
  x?: string,
  f?: () => Promise<T2>
): TaskEither<Error | typeof none, string> => async () => {
  if (f)
    try {
      await f()
    } catch (error) {
      return left(error)
    }
  return after(1).then(() => (x ? right(x as string) : left(none)))
}

function dependentInput<T1 extends Record<string, string>, T2>(
  x?: string,
  f?: () => Promise<T2>
): (record: T1, field: keyof T1) => TaskEither<Error | typeof none, string> {
  return (record: T1, field: keyof T1) => {
    const old: string = record[field]
    return fakeselect(old + x, f)
  }
}
test("compose text input and selections", async () => {
  const base2 = { a: "", b: "b" }

  const single = await fieldReplacer("b", fakeselect("bb"))(base2)()
  if (isRight(single)) {
    expect(single.right.a).toBe("")
  } else {
    expect(single.left).toBe(none)
  }
  const inputBoth = chainTaskTransformers<A>(
    fieldReplacer("b", fakeselect("bb")),
    fieldReplacer("a", fakeselect("aa")),
    fieldReplacer("a", fakeselect("b"), isFalsey)
  )(base2)

  const both = await inputBoth()
  if (isLeft(both)) throw new Error("Unexpected none")
  expect(both.right.a).toBe("aa")
  expect(both.right.b).toBe("bb")
  const inputBoth2 = chainTaskTransformers<A>(
    fieldReplacer("b", fakeselect()),
    fieldReplacer("a", fakeselect("aa")),
    fieldReplacer("a", fakeselect("b"), isFalsey)
  )(base2)
  const both2 = await inputBoth2()
  if (isRight(both2)) fail("Unexpected right")
  expect(isLeft(both2) && both2.left).toBe(none)
  const inputBoth3 = chainTaskTransformers<A>(
    fieldReplacer("b", fakeselect("c", rejectPromise)),
    fieldReplacer("a", fakeselect("aa")),
    fieldReplacer("a", fakeselect("b"))
  )(base2)
  const both3 = await inputBoth3()
  if (isRight(both3)) fail("Unexpected right")
  else expect(both3.left.toString()).toBe("Error: foo")
})

test("compose dependent replacers", async () => {
  const base3 = { a: "", b: "b" }
  const _ = ""
  const changed = await chainTaskTransformers<A>(
    dependFieldReplacer("a", dependentInput("aa")),
    dependFieldReplacer("a", dependentInput<A, any>("suffix")),
    dependFieldReplacer("b", dependentInput<A, any>("suffix")),
    dependFieldReplacer("a", () => fakeselect("aa")),
    fieldReplacer("a", fakeselect("aa"))
  )(base3)()
  if (isLeft(changed)) fail("Unexpected failure")
  else {
    expect(changed.right.a).toBe("aa")
    expect(changed.right.b).toBe("bsuffix")
  }

  const rejectPromise2 = () => {
    return rejectPromise()
  }

  const changed2 = await chainTaskTransformers<A>(
    dependFieldReplacer("a", dependentInput<A, any>("aa")),
    dependFieldReplacer("b", dependentInput<A, any>("suffix", rejectPromise2)),
    dependFieldReplacer("a", () => fakeselect("aa")),
    fieldReplacer("a", fakeselect("aa"))
  )(base3)()
  if (isRight(changed2)) fail("Unexpected success")
})

const base = "sap/bc/adt/oo/classes/zfoobar/includes/testclasses"
test("split uri simple", () => {
  const parts = splitAdtUriInternal(base)
  expect(parts.path).toBe(base)
  expect(parts.name).toBeUndefined()
  expect(parts.start).toBeUndefined()
})

test("split uri fragment", () => {
  let parts = splitAdtUriInternal(`${base}#`)
  expect(parts.path).toBe(base)
  expect(parts.name).toBeFalsy()
  expect(parts.type).toBeFalsy()
  parts = splitAdtUriInternal(
    `${base}#type=${"CLAS/OLD"};name=${encodeURIComponent(
      "MULTIPLE                      II"
    )}`
  )
  expect(parts.path).toBe(base)
  expect(parts.name).toBe("MULTIPLE                      II")
  expect(parts.type).toBe("CLAS/OLD")
  parts = splitAdtUriInternal(`${base}#foo;bar=1`)
  expect(parts.path).toBe(base)
  expect(parts.name).toBeFalsy()
  expect(parts.type).toBeFalsy()
})

test("split uri start", () => {
  let parts = splitAdtUriInternal(`${base}?`)
  expect(parts.path).toBe(base)
  expect(parts.start).toBeFalsy()
  parts = splitAdtUriInternal(`${base}?start=3,2`)
  expect(parts.path).toBe(base)
  expect(parts.start).toBeDefined()
  expect(parts.start?.line).toBe(3)
  expect(parts.start?.character).toBe(2)
  expect(parts.end).toBeFalsy()
})
test("split uri start in fragment", () => {
  const parts = splitAdtUriInternal(`${base}#start=3,2`)
  expect(parts.path).toBe(base)
  expect(parts.start).toBeDefined()
  expect(parts.start?.line).toBe(3)
  expect(parts.start?.character).toBe(2)
  expect(parts.end).toBeFalsy()
})
test("split namespaced uri start in fragment", () => {
  const path = "/sap/bc/adt/vit/wb/object_type/ttypda/object_name/%2fFOO%2fBAR"
  const parts = splitAdtUriInternal(`${path}#start=3,2`)
  expect(parts.path).toBe(path)
  expect(parts.start).toBeDefined()
  expect(parts.start?.line).toBe(3)
  expect(parts.start?.character).toBe(2)
  expect(parts.end).toBeFalsy()
})
