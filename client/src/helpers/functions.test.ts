import { delay, chainTaskTransformers, fieldReplacer } from "./functions"
import { none } from "fp-ts/lib/Option"
import { right, left, isLeft, isRight } from "fp-ts/lib/Either"
import { TaskEither } from "fp-ts/lib/TaskEither"
const isFalsey = (x: any) => !x

const fakeselect = <T, T2>(
  x?: T,
  f?: () => Promise<T2>
): TaskEither<Error | typeof none, T> => async () => {
  if (f)
    try {
      await f()
    } catch (error) {
      return left(error)
    }
  return delay(1).then(() => (x ? right(x) : left(none)))
}

interface A {
  a: string
  b: string
}

test("compose text input and selections", async () => {
  const base = { a: "", b: "b" }

  const single = await fieldReplacer("b", fakeselect("bb"))(base)()
  if (isRight(single)) {
    expect(single.right.a).toBe("")
  } else {
    expect(single.left).toBe(none)
  }
  const inputBoth = chainTaskTransformers<A>(
    fieldReplacer("b", fakeselect("bb")),
    fieldReplacer("a", fakeselect("aa")),
    fieldReplacer("a", fakeselect("b"), isFalsey)
  )(base)

  const both = await inputBoth()
  if (isLeft(both)) throw new Error("Unexpected none")
  expect(both.right.a).toBe("aa")
  expect(both.right.b).toBe("bb")
  const inputBoth2 = chainTaskTransformers<A>(
    fieldReplacer("b", fakeselect()),
    fieldReplacer("a", fakeselect("aa")),
    fieldReplacer("a", fakeselect("b"), isFalsey)
  )(base)
  const both2 = await inputBoth2()
  if (isRight(both2)) fail("Unexpected right")
  expect(isLeft(both2) && both2.left).toBe(none)
  const inputBoth3 = chainTaskTransformers<A>(
    fieldReplacer(
      "b",
      fakeselect("c", () => Promise.reject(new Error("foo")))
    ),
    fieldReplacer("a", fakeselect("aa")),
    fieldReplacer("a", fakeselect("b"))
  )(base)
  const both3 = await inputBoth3()
  if (isRight(both3)) fail("Unexpected right")
  else expect(both3.left.toString()).toBe("Error: foo")
})
